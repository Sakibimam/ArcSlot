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
///           are rejected at initialisation and quarantine-resolution time.
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

    /// @dev Set when sweep() detects a blacklisted payout address or a
    ///      failed isBlacklisted probe. Cleared by resolveQuarantine().
    bool public quarantined;

    // ─── Events ────────────────────────────────────────────────────────────────

    /// @param payRef_        Payment reference for this slot.
    /// @param gross          Total USDC balance swept.
    /// @param net            Amount forwarded to merchant.
    /// @param fee            Amount forwarded to feeRecipient.
    /// @param reimbursement  Amount forwarded to the caller (gas refund + tip).
    /// @param sweeper        Address that called sweep().
    event Received(
        bytes32 indexed payRef_,
        uint256 gross,
        uint256 net,
        uint256 fee,
        uint256 reimbursement,
        address indexed sweeper
    );

    /// @param slot    Address of this Slot clone.
    /// @param payRef_ Payment reference.
    /// @param who     The blacklisted address that triggered quarantine
    ///                (address(0) when the quarantine was triggered by a
    ///                probe failure rather than a confirmed blacklisting).
    event Quarantined(
        address indexed slot,
        bytes32 indexed payRef_,
        address indexed who
    );

    /// @param slot    Address of this Slot clone.
    /// @param payRef_ Payment reference.
    /// @dev   Emitted when the isBlacklisted() probe itself fails (call-level
    ///        error or unexpected return data). The slot is quarantined fail-
    ///        closed rather than proceeding as if the addresses were clear.
    event QuarantinedCheckFailed(
        address indexed slot,
        bytes32 indexed payRef_
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
    ///           1. Checks       : balance, blacklist probes
    ///           2. Effects      : quarantine flag written if needed
    ///           3. Interactions : SafeERC20 transfers, then event
    ///
    ///         ReentrancyGuard prevents a reentrant call between transfers.
    function sweep() external nonReentrant {
        // ── Step 1: snapshot gas at entry ──────────────────────────────────────
        uint256 g0 = gasleft();

        // ── Step 2: read balance ───────────────────────────────────────────────
        uint256 gross = USDC.balanceOf(address(this));
        if (gross == 0) revert NothingToSweep();

        // ── Step 3: blacklist check (fail-closed on probe failure) ─────────────
        address _merchant     = merchant;
        address _feeRecipient = feeRecipient;
        uint16  _feeBps       = feeBps;
        bytes32 _payRef       = payRef;

        {
            // _checkBlacklist returns:
            //   (blacklisted=true,  who=non-zero) → confirmed blacklisted address
            //   (blacklisted=true,  who=zero)     → probe call failed (fail-closed)
            //   (blacklisted=false, who=zero)     → all clear
            (bool isBlocked, address who) =
                _checkBlacklist(_merchant, _feeRecipient, _feeBps);

            if (isBlocked) {
                quarantined = true;
                if (who == address(0)) {
                    // Probe failure — emit distinct event so operators know why.
                    emit QuarantinedCheckFailed(address(this), _payRef);
                } else {
                    emit Quarantined(address(this), _payRef, who);
                }
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
        uint256 gasCost18     = (g0 - gasleft() + FIXED_OVERHEAD) * tx.gasprice;
        uint256 reimbursement = gasCost18 / 1e12 + TIP;

        // Cap: reimbursement cannot exceed the gross balance.
        // It is taken from net (never from fee), so fee integrity is preserved.
        if (reimbursement > gross) reimbursement = gross;
        if (reimbursement > net)   reimbursement = net;
        net -= reimbursement;

        // ── Step 6: SafeERC20 transfers (Interactions) ─────────────────────────
        if (reimbursement > 0) {
            USDC.safeTransfer(msg.sender, reimbursement);
        }
        if (fee > 0) {
            USDC.safeTransfer(_feeRecipient, fee);
        }
        if (net > 0) {
            USDC.safeTransfer(_merchant, net);
        }

        // ── Step 7: event ──────────────────────────────────────────────────────
        emit Received(_payRef, gross, net, fee, reimbursement, msg.sender);
    }

    // ─── Quarantine resolution ─────────────────────────────────────────────────

    /// @notice Called by the current merchant to resolve a quarantine.
    ///         Allows replacing BOTH the merchant and the feeRecipient so that
    ///         a subsequent sweep can succeed regardless of which address caused
    ///         the quarantine. This is the ONLY function that may change merchant
    ///         or feeRecipient, and only from the quarantined state.
    ///
    ///         Validation mirrors initialize():
    ///         - newMerchant must be non-zero.
    ///         - If newFeeBps > 0 then newFeeRecipient must be non-zero.
    ///         - newFeeBps must be <= 1000.
    ///
    /// @param newMerchant      Replacement merchant address (non-zero).
    /// @param newFeeRecipient  Replacement fee recipient (zero is valid when
    ///                         newFeeBps == 0, disabling the fee path entirely).
    /// @param newFeeBps        Replacement fee in basis points (0-1000).
    function resolveQuarantine(
        address newMerchant,
        address newFeeRecipient,
        uint16  newFeeBps
    ) external {
        if (msg.sender != merchant)                          revert NotMerchant();
        if (!quarantined)                                    revert NotQuarantined();
        if (newMerchant == address(0))                       revert ZeroMerchant();
        if (newFeeBps > 1000)                                revert FeeBpsTooHigh();
        if (newFeeBps > 0 && newFeeRecipient == address(0)) revert ZeroFeeRecipient();

        quarantined   = false;
        merchant      = newMerchant;
        feeRecipient  = newFeeRecipient;
        feeBps        = newFeeBps;
    }

    // ─── Internal helpers ──────────────────────────────────────────────────────

    /// @dev Returns (true, who) if a blacklisted address is found, where `who`
    ///      is the blacklisted address.
    ///      Returns (true, address(0)) if the isBlacklisted probe itself failed
    ///      (fail-closed: treat as quarantine-worthy).
    ///      Returns (false, address(0)) if both addresses are confirmed clear.
    function _checkBlacklist(
        address _merchant,
        address _feeRecipient,
        uint16  _feeBps
    ) internal view returns (bool isBlocked, address who) {
        // Probe merchant.
        (BlacklistResult merchantResult, bool merchantBlocked) = _probeBlacklist(_merchant);
        if (merchantResult == BlacklistResult.CallFailed) return (true, address(0));
        if (merchantBlocked) return (true, _merchant);

        // Probe feeRecipient only when there is a fee.
        if (_feeBps > 0) {
            (BlacklistResult feeResult, bool feeBlocked) = _probeBlacklist(_feeRecipient);
            if (feeResult == BlacklistResult.CallFailed) return (true, address(0));
            if (feeBlocked) return (true, _feeRecipient);
        }

        return (false, address(0));
    }

    enum BlacklistResult { Clear, Blacklisted, CallFailed }

    /// @dev Probes isBlacklisted(address) on the USDC contract via staticcall.
    ///      Returns (CallFailed, false) if the call reverts or returns short data
    ///      — the caller must treat this as a quarantine trigger (fail-closed).
    function _probeBlacklist(address who)
        internal
        view
        returns (BlacklistResult result, bool blacklisted_)
    {
        (bool ok, bytes memory ret) = address(USDC).staticcall(
            abi.encodeWithSignature("isBlacklisted(address)", who)
        );
        if (!ok || ret.length < 32) return (BlacklistResult.CallFailed, false);
        bool flag = abi.decode(ret, (bool));
        return flag
            ? (BlacklistResult.Blacklisted, true)
            : (BlacklistResult.Clear, false);
    }
}
