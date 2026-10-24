// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title Slot
/// @notice Deposit-address clone for the Arc Slot system.
///         USDC is treated exclusively via the ERC-20 interface at ARC_USDC.
///         Nothing here is payable; no SELFDESTRUCT is used anywhere.
contract Slot {
    // ─── Arc USDC ──────────────────────────────────────────────────────────────
    /// @dev ERC-20 USDC on Arc mainnet/testnet (6 decimals).
    ///      This is the ONLY token interface used; msg.value is never touched.
    IERC20 internal constant USDC =
        IERC20(0x3600000000000000000000000000000000000000);

    // ─── Storage ───────────────────────────────────────────────────────────────
    address public merchant;
    bytes32 public reference;
    uint16  public feeBps;
    address public feeRecipient;

    /// @dev Initialisation guard. Packed into a single slot with the booleans.
    bool private _initialised;

    // ─── Events ────────────────────────────────────────────────────────────────
    event Swept(
        address indexed merchant,
        bytes32 indexed reference,
        uint256 merchantAmount,
        uint256 feeAmount
    );

    // ─── Errors ────────────────────────────────────────────────────────────────
    error AlreadyInitialised();
    error ZeroMerchant();
    error ZeroFeeRecipient();
    error FeeBpsTooHigh();
    error NothingToSweep();

    // ─── Initialiser ───────────────────────────────────────────────────────────

    /// @notice Called exactly once by SlotFactory immediately after cloning.
    /// @param _merchant      Funds are forwarded here after fees.
    /// @param _reference     Off-chain payment reference (immutable after init).
    /// @param _feeBps        Fee in basis points (0–1000).
    /// @param _feeRecipient  Receives the fee; must be non-zero when feeBps > 0.
    function initialize(
        address _merchant,
        bytes32 _reference,
        uint16  _feeBps,
        address _feeRecipient
    ) external {
        if (_initialised)        revert AlreadyInitialised();
        if (_merchant == address(0))  revert ZeroMerchant();
        if (_feeBps > 1000)      revert FeeBpsTooHigh();
        if (_feeBps > 0 && _feeRecipient == address(0)) revert ZeroFeeRecipient();

        _initialised  = true;
        merchant      = _merchant;
        reference     = _reference;
        feeBps        = _feeBps;
        feeRecipient  = _feeRecipient;
    }

    // ─── Views ─────────────────────────────────────────────────────────────────

    /// @notice ERC-20 USDC balance held by this slot (6-decimal units).
    function balance() external view returns (uint256) {
        return USDC.balanceOf(address(this));
    }

    // ─── Sweep ─────────────────────────────────────────────────────────────────

    /// @notice Permissionless: anyone may call sweep to forward accumulated
    ///         USDC to the merchant (and optionally the fee recipient).
    ///         Uses the ERC-20 interface exclusively — never msg.value.
    function sweep() external {
        uint256 total = USDC.balanceOf(address(this));
        if (total == 0) revert NothingToSweep();

        uint256 fee = (total * feeBps) / 10_000;
        uint256 merchantAmount = total - fee;

        // Transfer fee first (zero-value transfer is a no-op for feeBps == 0)
        if (fee > 0) {
            USDC.transfer(feeRecipient, fee);
        }
        USDC.transfer(merchant, merchantAmount);

        emit Swept(merchant, reference, merchantAmount, fee);
    }
}
