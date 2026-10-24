// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Slot}   from "./Slot.sol";

/// @title SlotFactory
/// @notice Deploys EIP-1167 minimal-proxy Slot instances deterministically.
///         No owner, no admin, no pause, no upgrade path.
contract SlotFactory {
    using Clones for address;

    // ─── State ─────────────────────────────────────────────────────────────────

    address public immutable implementation;

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

    error ZeroMerchant();
    error ZeroFeeRecipient();
    error FeeBpsTooHigh();
    error ReferenceAlreadyUsed();

    // ─── Constructor ───────────────────────────────────────────────────────────

    constructor() {
        implementation = address(new Slot());
    }

    // ─── Public interface ──────────────────────────────────────────────────────

    /// @notice Deploy a new Slot clone for (merchant, payRef).
    /// @param merchant      Address that will receive swept USDC.
    /// @param payRef        Off-chain payment reference; unique per merchant.
    /// @param feeBps        Fee in basis points (0-1000, i.e. 0-10%).
    /// @param feeRecipient  Receives the fee portion; must be non-zero when feeBps > 0.
    /// @return slot         Address of the newly-deployed Slot clone.
    function createSlot(
        address merchant,
        bytes32 payRef,
        uint16  feeBps,
        address feeRecipient
    ) external returns (address slot) {
        if (merchant == address(0))                   revert ZeroMerchant();
        if (feeBps > 1000)                            revert FeeBpsTooHigh();
        if (feeBps > 0 && feeRecipient == address(0)) revert ZeroFeeRecipient();
        if (slots[merchant][payRef] != address(0))    revert ReferenceAlreadyUsed();

        bytes32 salt = _salt(merchant, payRef);
        slot = implementation.cloneDeterministic(salt);

        // Record before external call (CEI).
        slots[merchant][payRef] = slot;

        Slot(slot).initialize(merchant, payRef, feeBps, feeRecipient);

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
            // Skip zero addresses defensively.
            if (slotAddresses[i] == address(0)) continue;
            try Slot(slotAddresses[i]).sweep() {
                // success — nothing extra to do
            } catch {
                // swallow the revert so the remaining slots are still swept
            }
        }
    }

    // ─── Internal ──────────────────────────────────────────────────────────────

    function _salt(address merchant, bytes32 payRef) internal pure returns (bytes32) {
        return keccak256(abi.encode(merchant, payRef));
    }
}
