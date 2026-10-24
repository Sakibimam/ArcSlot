// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20}          from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}        from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard}  from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Slot
/// @notice A minimal deposit-address clone in the Arc Slot system.
///
///         Arc specifics honoured throughout:
///         - USDC is the native gas token AND an ERC-20 at ARC_USDC_ADDRESS.
///           We use ONLY the 6-decimal ERC-20 view; msg.value is never read.
///         - Transfers to address(0) revert on Arc, so all zero-address paths
///           are rejected at initialisation time.
///         - No SELFDESTRUCT anywhere (would drain the contract's native
///           balance and leave a broken address).
///         - Nothing is payable.
contract Slot is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Constants ─────────────────────────────────────────────────────────────

    /// @dev ERC-20 USDC on Arc (6 decimals). Only this interface is used.
    IERC20 internal constant USDC =
        IERC20(0x3600000000000000000000000000000000000000);

    /// @dev Covers intrinsic gas (21 000) + calldata + the bookkeeping inside
    ///      sweep() that runs before and after the gasleft() snapshot.
    ///      Calibrated conservatively high so callers are never under-paid.
    uint256 internal constant FIXED_OVERHEAD = 80_000;

    /// @dev Flat bonus added on top of the gas reimbursement (6-decimal USDC).
    ///      0.01 USDC — large enough that integer-division truncation in
    ///      gasCost18 / 1e12 can never eat the caller's surplus.
    uint256 internal constant TIP = 10_000;

    // ─── Storage ───────────────────────────────────────────────────────────────

    address public merchant;
    bytes32 public payRef;
    uint16  public feeBps;
    address public feeRecipient;

    bool private _initialised;

    /// @dev Set when sweep() detects a blacklisted merchant or feeRecipient.
    ///      Cleared by resolveQuarantine().
    bool public quarantined;

    // ─── Events ────────────────────────────────────────────────────────────────

    /// @param payRef_      Payment reference for this slot.
    /// @param gross        Total USDC balance swept.
    /// @param net          Amount forwarded to merchant.
    /// @param fee          Amount forwarded to feeRecipient.
    /// @param reimbursement Amount forwarded to the caller (gas refund + tip).
    /// @param sweeper      Address that called sweep().
    event Received(
        bytes32 indexed payRef_,
        uint256 gross,
        uint256 net,
        uint256 fee,
        uint256 reimbursement,
        address indexed sweeper
    );

    /// @param slot  Address of this Slot clone.
    /// @param payRef_ Payment reference.
    /// @param who   The blacklisted address that triggered quarantine.
    event Quarantined(
        address indexed slot,
        bytes32 indexed payRef_,
        address indexed who
    );

    // ─── Errors ────────────────────────────────────────────────────────────────

    error AlreadyInitialised();
    error ZeroMerchant();
    error ZeroFeeRecipient();
    error FeeBpsTooHigh();
    error NothingToSweep();
    error NotMerchant();
    error NotQuarantined();

    // ─── Initialiser ───────────────────────────────────────────────────────────

    /// @notice Called exactly once by SlotFactory immediately after cloning.
    function initialize(
        address _merchant,
        bytes32 _payRef,
        uint16  _feeBps,
        address _feeRecipient
    ) external {
        if (_initialised)                                revert AlreadyInitialised();
        if (_merchant == address(0))                     revert ZeroMerchant();
        if (_feeBps > 1000)                              revert FeeBpsTooHigh();
        if (_feeBps > 0 && _feeRecipient == address(0)) revert ZeroFeeRecipient();

        _initialised  = true;
        merchant      = _merchant;
        payRef        = _payRef;
        feeBps        = _feeBps;
        feeRecipient  = _feeRecipient;
    }

    // ─── Views ─────────────────────────────────────────────────────────────────

    /// @notice ERC-20 USDC balance of this slot (6-decimal units).
    function balance() external view returns (uint256) {
        return USDC.balanceOf(address(this));
    }

    // ─── Sweep ─────────────────────────────────────────────────────────────────

    /// @notice Permissionless sweep. Forwards USDC to merchant and feeRecipient,
    ///         reimbursing the caller for gas (in USDC) plus a flat tip.
    ///
    ///         Checks-Effects-Interactions order:
    ///           1. Checks  : balance, blacklist
    ///           2. Effects : (quarantine flag written if needed)
    ///           3. Interactions : SafeERC20 transfers
    ///
    ///         ReentrancyGuard prevents a reentrant call between transfers.
    function sweep() external nonReentrant {
        // ── Step 1: snapshot gas at entry ──────────────────────────────────────
        uint256 g0 = gasleft();

        // ── Step 2: read balance ───────────────────────────────────────────────
        uint256 gross = USDC.balanceOf(address(this));
        if (gross == 0) revert NothingToSweep();

        // ── Step 3: blacklist check (staticcall; failure treated as clear) ─────
        address _merchant      = merchant;
        address _feeRecipient  = feeRecipient;
        uint16  _feeBps        = feeBps;
        bytes32 _payRef        = payRef;

        {
            address blacklisted = _checkBlacklist(_merchant, _feeRecipient, _feeBps);
            if (blacklisted != address(0)) {
                // Effects before any event/interaction.
                quarantined = true;
                emit Quarantined(address(this), _payRef, blacklisted);
                return; // do NOT transfer; do NOT revert
            }
        }

        // ── Step 4: fee split ──────────────────────────────────────────────────
        uint256 fee = (gross * _feeBps) / 10_000;
        uint256 net = gross - fee;

        // ── Step 5: caller reimbursement ───────────────────────────────────────
        // gasCost18 is in 18-decimal "wei-of-USDC-gas"; divide by 1e12 to get
        // 6-decimal USDC units.  TIP ensures the caller is always net-positive
        // even when integer division truncates to zero.
        uint256 gasCost18      = (g0 - gasleft() + FIXED_OVERHEAD) * tx.gasprice;
        uint256 reimbursement  = gasCost18 / 1e12 + TIP;

        // Cap: reimbursement cannot exceed the gross balance.
        // It is taken from net (never from fee), so fee integrity is preserved.
        if (reimbursement > gross) reimbursement = gross;
        if (reimbursement > net)   reimbursement = net;
        net -= reimbursement;

        // ── Step 6: SafeERC20 transfers (Interactions) ─────────────────────────
        // Reimbursement to sweeper.
        if (reimbursement > 0) {
            USDC.safeTransfer(msg.sender, reimbursement);
        }
        // Fee to feeRecipient.
        if (fee > 0) {
            USDC.safeTransfer(_feeRecipient, fee);
        }
        // Remainder to merchant.
        if (net > 0) {
            USDC.safeTransfer(_merchant, net);
        }

        // ── Step 7: event ──────────────────────────────────────────────────────
        emit Received(_payRef, gross, net, fee, reimbursement, msg.sender);
    }

    // ─── Quarantine resolution ─────────────────────────────────────────────────

    /// @notice Called by the original merchant to resolve a quarantine.
    ///         `newMerchant` replaces the current merchant so that a
    ///         subsequently clean sweep can succeed. This is the ONLY function
    ///         that may change the merchant, and only from the quarantined state.
    /// @param newMerchant Non-zero replacement merchant address.
    function resolveQuarantine(address newMerchant) external {
        if (msg.sender != merchant)    revert NotMerchant();
        if (!quarantined)              revert NotQuarantined();
        if (newMerchant == address(0)) revert ZeroMerchant();

        quarantined = false;
        merchant    = newMerchant;
    }

    // ─── Internal helpers ──────────────────────────────────────────────────────

    /// @dev Try an isBlacklisted(address) staticcall on the USDC contract.
    ///      Returns the first blacklisted address found, or address(0) if both
    ///      are clear or if the call itself fails (fail-open: treat as clear).
    function _checkBlacklist(
        address _merchant,
        address _feeRecipient,
        uint16  _feeBps
    ) internal view returns (address) {
        if (_isBlacklisted(_merchant))                       return _merchant;
        if (_feeBps > 0 && _isBlacklisted(_feeRecipient))   return _feeRecipient;
        return address(0);
    }

    /// @dev Staticcall isBlacklisted(address) on the USDC contract.
    ///      Returns false on any call failure (fail-open).
    function _isBlacklisted(address who) internal view returns (bool) {
        (bool ok, bytes memory ret) = address(USDC).staticcall(
            abi.encodeWithSignature("isBlacklisted(address)", who)
        );
        if (!ok || ret.length < 32) return false;
        return abi.decode(ret, (bool));
    }
}
