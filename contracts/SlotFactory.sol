// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Slot}   from "./Slot.sol";

/// @title SlotFactory
/// @notice Deploys EIP-1167 minimal-proxy Slot instances deterministically.
///         No owner, no admin, no pause, no upgrade path.
///
///         Constructor parameters are operator-configurable at deploy time,
///         so the same implementation can be reused across chains and
///         operators without redeploying the Slot logic.
contract SlotFactory {
    using Clones for address;

    // ─── Immutable configuration ────────────────────────────────────────────────

    /// @notice EIP-1167 implementation address.  All clones proxy to this.
    address public immutable implementation;

    /// @notice ERC-20 USDC token address forwarded to every clone.
    address public immutable usdc;

    /// @notice Flat caller tip (6-decimal USDC) forwarded to every clone.
    uint256 public immutable tip;

    /// @notice Minimum gross balance (6-decimal USDC) required to sweep,
    ///         forwarded to every clone.
    uint256 public immutable minSweep;

    // ─── State ─────────────────────────────────────────────────────────────────

    /// @dev merchant => payRef => slot address (non-zero once deployed).
    mapping(address => mapping(bytes32 => address)) public slots;

    // ─── Events ────────────────────────────────────────────────────────────────

    event SlotCreated(
        address indexed slot,
        address indexed merchant,
        bytes32 indexed payRef,
        uint16  feeBps,
        address feeRecipient
    );

    // ─── Errors ────────────────────────────────────────────────────────────────

    error ZeroImplementation();
    error ZeroUSDC();
    error ZeroMerchant();
    error ZeroFeeRecipient();
    error FeeBpsTooHigh();
    error ReferenceAlreadyUsed();
    error MaxReimbursementBelowTip();
    error LabelTooLong();
    error BadExpiry();

    // ─── Requests (on-chain amount, label, expiry, creator) ───────────────────

    uint256 public constant MAX_LABEL_BYTES = 80;

    struct Request {
        bool    exists;
        address creator;
        address merchant;
        uint256 amount;     // requested amount, 6-decimal USDC (0 = payer chooses)
        uint64  createdAt;
        uint64  expiresAt;  // 0 = never
        string  label;
    }

    mapping(address => Request)   internal _requests;   // slot => request
    mapping(address => address[]) internal _byCreator;  // creator => slots

    event RequestCreated(
        address indexed slot,
        address indexed creator,
        address indexed merchant,
        uint256 amount,
        string  label,
        uint64  expiresAt
    );

    // ─── Constructor ───────────────────────────────────────────────────────────

    /// @param _implementation  Address of the deployed Slot implementation.
    /// @param _usdc            ERC-20 USDC token address (non-zero).
    /// @param _tip             Flat caller bonus in 6-decimal USDC units.
    /// @param _minSweep        Minimum gross balance required to trigger sweep.
    constructor(
        address _implementation,
        address _usdc,
        uint256 _tip,
        uint256 _minSweep
    ) {
        if (_implementation == address(0)) revert ZeroImplementation();
        if (_usdc           == address(0)) revert ZeroUSDC();

        implementation = _implementation;
        usdc           = _usdc;
        tip            = _tip;
        minSweep       = _minSweep;
    }

    // ─── Public interface ──────────────────────────────────────────────────────

    /// @notice Deploy a new Slot clone for (merchant, payRef).
    /// @param merchant      Address that will receive swept USDC.
    /// @param payRef        Off-chain payment reference; unique per merchant.
    /// @param feeBps        Fee in basis points (0-1000, i.e. 0-10%).
    /// @param feeRecipient  Receives the fee portion; must be non-zero when feeBps > 0.
    /// @param maxReimbursement Cap on a stranger sweeper's gas refund + tip
    ///                      (6-decimal USDC); must be >= tip.
    /// @return slot         Address of the newly-deployed Slot clone.
    function createSlot(
        address merchant,
        bytes32 payRef,
        uint16  feeBps,
        address feeRecipient,
        uint256 maxReimbursement
    ) external returns (address slot) {
        slot = _deploy(merchant, payRef, feeBps, feeRecipient, maxReimbursement);
    }

    /// @notice Create a payment request: deploy the Slot and record the amount,
    ///         label and expiry on-chain, attributed to msg.sender. Payment links
    ///         then only need the slot address, so they can't be edited.
    function createRequest(
        address merchant,
        bytes32 payRef,
        uint16  feeBps,
        address feeRecipient,
        uint256 maxReimbursement,
        uint256 amount,
        string calldata label,
        uint64  expiresAt
    ) external returns (address slot) {
        if (bytes(label).length > MAX_LABEL_BYTES)               revert LabelTooLong();
        if (expiresAt != 0 && expiresAt <= block.timestamp)      revert BadExpiry();
        slot = _deploy(merchant, payRef, feeBps, feeRecipient, maxReimbursement);
        _requests[slot] = Request({
            exists:    true,
            creator:   msg.sender,
            merchant:  merchant,
            amount:    amount,
            createdAt: uint64(block.timestamp),
            expiresAt: expiresAt,
            label:     label
        });
        _byCreator[msg.sender].push(slot);
        emit RequestCreated(slot, msg.sender, merchant, amount, label, expiresAt);
    }

    function requestOf(address slot) external view returns (Request memory) {
        return _requests[slot];
    }

    function requestCount(address creator) external view returns (uint256) {
        return _byCreator[creator].length;
    }

    /// @notice Slots created by `creator`, oldest first, paginated.
    function requestsOf(address creator, uint256 offset, uint256 limit)
        external view returns (address[] memory page)
    {
        address[] storage all = _byCreator[creator];
        if (offset >= all.length) return new address[](0);
        uint256 end = offset + limit > all.length ? all.length : offset + limit;
        page = new address[](end - offset);
        for (uint256 i = offset; i < end; ++i) page[i - offset] = all[i];
    }

    function _deploy(
        address merchant,
        bytes32 payRef,
        uint16  feeBps,
        address feeRecipient,
        uint256 maxReimbursement
    ) internal returns (address slot) {
        if (merchant == address(0))                   revert ZeroMerchant();
        if (feeBps > 1000)                            revert FeeBpsTooHigh();
        if (feeBps > 0 && feeRecipient == address(0)) revert ZeroFeeRecipient();
        if (maxReimbursement < tip)                   revert MaxReimbursementBelowTip();
        if (slots[merchant][payRef] != address(0))    revert ReferenceAlreadyUsed();

        bytes32 salt_ = _salt(merchant, payRef);
        slot = implementation.cloneDeterministic(salt_);

        // Record before external call (CEI).
        slots[merchant][payRef] = slot;

        Slot(slot).initialize(
            usdc,
            tip,
            minSweep,
            maxReimbursement,
            merchant,
            payRef,
            feeBps,
            feeRecipient
        );

        emit SlotCreated(slot, merchant, payRef, feeBps, feeRecipient);
    }

    /// @notice Predict the deterministic address for (merchant, payRef)
    ///         without deploying. Returns the same address createSlot would produce.
    function predict(address merchant, bytes32 payRef)
        external
        view
        returns (address)
    {
        return implementation.predictDeterministicAddress(_salt(merchant, payRef));
    }

    /// @notice Sweep a batch of Slot addresses. Each slot's sweep() is called
    ///         in a try/catch so one failing slot cannot block the rest.
    /// @param slotAddresses Array of Slot clone addresses to sweep.
    function sweepMany(address[] calldata slotAddresses) external {
        uint256 n = slotAddresses.length;
        for (uint256 i; i < n; ++i) {
            if (slotAddresses[i] == address(0)) continue;
            try Slot(slotAddresses[i]).sweep() {
                // success
            } catch {
                // swallow: one bad slot cannot block the rest
            }
        }
    }

    // ─── Internal ──────────────────────────────────────────────────────────────

    function _salt(address merchant, bytes32 payRef) internal pure returns (bytes32) {
        return keccak256(abi.encode(merchant, payRef));
    }
}
