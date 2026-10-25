// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20}          from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}        from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard}  from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ChainConfig}      from "./ChainConfig.sol";

interface ISlotFactoryStats {
    function recordCollect(address collector, uint256 gross) external;
}

/// @title Slot
/// @notice A minimal deposit-address clone in the Arc Slot system.
///
///         Arc specifics honoured throughout:
///         - USDC is the native gas token AND an ERC-20.  We use ONLY the
///           6-decimal ERC-20 view; msg.value is never read.
///         - Transfers to address(0) revert on Arc, so all zero-address
///           paths are rejected at initialisation time.
///         - No SELFDESTRUCT anywhere (would drain the contract's native
///           balance and leave a broken address).
///         - Nothing is payable.
///         - Stranger reimbursement is capped per slot (maxReimbursement);
///           Arc gas can swing 1000x, so above the cap sweep() reverts.
///
///         The implementation is deployed once; SlotFactory deploys EIP-1167
///         minimal proxies and calls initialize() on each clone.  USDC, TIP,
///         and MIN_SWEEP are supplied at initialisation time so the factory
///         can be configured per-operator without redeploying the
///         implementation.
contract Slot is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Constants ─────────────────────────────────────────────────────────────

    /// @dev Gas sweep() spends outside the measured window: intrinsic 21 000,
    ///      calldata, proxy hop, and the payout transfers that run after the
    ///      reimbursement is computed. Arc USDC transfers go through the native
    ///      precompile and cost ~40k each to a fresh recipient, so the overhead
    ///      scales with the number of transfers. Calibrated on an Arc mainnet
    ///      fork (contracts/test-integration), worst case = fresh recipients.
    uint256 internal constant GAS_BASE_OVERHEAD = 55_000;
    uint256 internal constant GAS_PER_TRANSFER  = 42_000;
    /// @dev A collector's reward (gas refund + tip) never exceeds 10% of a sweep.
    uint256 internal constant MAX_REWARD_BPS    = 1_000;

    // ─── Initialisation-time configuration ────────────────────────────────────
    //
    //     These are stored at clone initialisation (not compile time) so that
    //     a single implementation can serve different chains / operators.

    /// @notice ERC-20 USDC token for this slot (6-decimal interface only).
    IERC20  public usdc;

    /// @notice Flat caller tip in 6-decimal USDC units added on top of the
    ///         gas reimbursement.  Set by SlotFactory at initialisation.
    uint256 public tip;

    /// @notice Minimum gross balance (6-decimal USDC) required before
    ///         sweep() will distribute funds.  Prevents dust sweeps.
    uint256 public minSweep;

    /// @notice Hard cap (6-decimal USDC) on what a stranger sweeper may be
    ///         reimbursed. If gas + tip exceeds it, sweep() reverts GasTooHigh
    ///         rather than letting a ceiling-gas sweep eat the payment.
    uint256 public maxReimbursement;

    // ─── Slot storage ──────────────────────────────────────────────────────────

    address public merchant;
    bytes32 public payRef;
    uint16  public feeBps;
    address public feeRecipient;

    bool private _initialised;

    /// @notice The factory that deployed this slot (records collector stats).
    address public factory;

    /// @dev Set when sweep() finds the merchant blacklisted (or the blacklist
    ///      probe fails). Funds stay frozen in the slot — nobody can redirect
    ///      them — until a later sweep succeeds, which clears it.
    bool public quarantined;

    /// @notice Gross USDC this slot has paid out across all sweeps (6-decimal).
    ///         Lets a payer or merchant see a request was paid even after the
    ///         balance has been collected.
    uint256 public totalCollected;
    /// @notice Timestamp of the last successful sweep.
    uint64  public lastCollectedAt;

    /// @notice Fees owed to a fee recipient that was blacklisted at sweep time,
    ///         held in this slot until releaseHeldFees() can pay them out.
    uint256 public heldFees;

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

    event FeeHeld(address indexed slot, bytes32 indexed payRef_, address indexed feeRecipient, uint256 amount);
    event HeldFeesReleased(address indexed slot, address indexed feeRecipient, uint256 amount);
    event Rescued(address indexed token, address indexed merchant, uint256 amount);

    // ─── Errors ────────────────────────────────────────────────────────────────

    error AlreadyInitialised();
    error ZeroMerchant();
    error ZeroFeeRecipient();
    error ZeroUSDC();
    error FeeBpsTooHigh();
    error NothingToSweep();
    error BelowMinSweep();
    error ZeroRewardTo();
    error GasTooHigh();
    error NotRewardRecipient();
    error NativeNotAccepted();
    error CannotRescueUsdc();
    error FeeRecipientBlocked();

    // ─── Initialiser ───────────────────────────────────────────────────────────

    /// @notice Called exactly once by SlotFactory immediately after cloning.
    /// @param _usdc         ERC-20 USDC token address (non-zero).
    /// @param _tip          Flat caller bonus in 6-decimal USDC units.
    /// @param _minSweep     Minimum gross balance required to trigger a sweep.
    /// @param _maxReimbursement Cap on a stranger sweeper's reimbursement.
    /// @param _merchant     Merchant payout address (non-zero).
    /// @param _payRef       Off-chain payment reference (bytes32).
    /// @param _feeBps       Fee in basis points (0-1000).
    /// @param _feeRecipient Fee recipient (non-zero when _feeBps > 0).
    function initialize(
        address _usdc,
        uint256 _tip,
        uint256 _minSweep,
        uint256 _maxReimbursement,
        address _merchant,
        bytes32 _payRef,
        uint16  _feeBps,
        address _feeRecipient
    ) external {
        if (_initialised)                                revert AlreadyInitialised();
        if (_usdc    == address(0))                      revert ZeroUSDC();
        if (_merchant == address(0))                     revert ZeroMerchant();
        if (_feeBps > 1000)                              revert FeeBpsTooHigh();
        if (_feeBps > 0 && _feeRecipient == address(0)) revert ZeroFeeRecipient();

        _initialised  = true;
        factory       = msg.sender;
        usdc          = IERC20(_usdc);
        tip           = _tip;
        minSweep      = _minSweep;
        maxReimbursement = _maxReimbursement;
        merchant      = _merchant;
        payRef        = _payRef;
        feeBps        = _feeBps;
        feeRecipient  = _feeRecipient;
    }

    // ─── Views ─────────────────────────────────────────────────────────────────

    /// @notice ERC-20 USDC balance of this slot (6-decimal units).
    function balance() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    // ─── Sweep ─────────────────────────────────────────────────────────────────

    /// @notice Permissionless sweep. Forwards USDC to merchant and feeRecipient,
    ///         reimbursing the caller for gas (in USDC) plus a flat tip.
    ///
    ///         Checks-Effects-Interactions order:
    ///           1. Checks       : balance, minSweep, blacklist probes
    ///           2. Effects      : quarantine flag written if needed
    ///           3. Interactions : SafeERC20 transfers, then event
    ///
    ///         ReentrancyGuard prevents a reentrant call between transfers.
    function sweep() external nonReentrant {
        _sweep(msg.sender);
    }

    /// @notice Sweep and send the collector reward to `rewardTo`. Lets batchers
    ///         (e.g. SlotFactory.sweepMany) and bots route rewards to the real
    ///         collector instead of the calling contract.
    function sweepFor(address rewardTo) external nonReentrant {
        if (rewardTo == address(0)) revert ZeroRewardTo();
        // Only claim for yourself (the factory's sweepMany names its real caller):
        // stops griefing collectors via sweepFor(merchant) and leaderboard spoofing.
        if (rewardTo != msg.sender && msg.sender != factory) revert NotRewardRecipient();
        _sweep(rewardTo);
    }

    function _sweep(address rewardTo) internal {
        // ── Step 1: snapshot gas at entry ──────────────────────────────────────
        uint256 g0 = gasleft();

        // ── Step 2: read balance and enforce minimum ───────────────────────────
        IERC20  _usdc  = usdc;
        uint256 held   = heldFees;
        uint256 gross  = _usdc.balanceOf(address(this)) - held;
        if (gross == 0)         revert NothingToSweep();
        // Off Arc a Slot only recovers wrong-chain payments: no minimum.
        if (gross < minSweep && ChainConfig.isArc()) revert BelowMinSweep();

        // ── Step 3: blacklist check (fail-closed on probe failure) ─────────────
        address _merchant     = merchant;
        address _feeRecipient = feeRecipient;
        uint16  _feeBps       = feeBps;
        bytes32 _payRef       = payRef;

        // A blacklisted (or unverifiable) merchant freezes the slot: the funds
        // stay here and no one can redirect them.
        (BlacklistResult m,) = _probeBlacklist(address(_usdc), _merchant);
        if (m != BlacklistResult.Clear) {
            quarantined = true;
            if (m == BlacklistResult.CallFailed) emit QuarantinedCheckFailed(address(this), _payRef);
            else emit Quarantined(address(this), _payRef, _merchant);
            return;
        }
        // A blacklisted fee wallet must not block the merchant: hold its fee.
        bool holdFee;
        if (_feeBps > 0) {
            (BlacklistResult f,) = _probeBlacklist(address(_usdc), _feeRecipient);
            holdFee = f != BlacklistResult.Clear;
        }

        // ── Step 4: fee split ──────────────────────────────────────────────────
        uint256 fee = (gross * _feeBps) / 10_000;
        uint256 net = gross - fee;

        // Effects before interactions, and before the gas snapshot below so the
        // collector is refunded for these storage writes too.
        totalCollected  += gross;
        lastCollectedAt  = uint64(block.timestamp);
        if (holdFee) heldFees = held + fee;
        if (quarantined) quarantined = false;

        // ── Step 5: caller reimbursement ───────────────────────────────────────
        //    The merchant sweeping their own slot is not reimbursed (it would
        //    only pay themselves), so they can always sweep — even at ceiling
        //    gas — and funds can never be locked by GasTooHigh.
        uint256 reimbursement;
        //    Off Arc gas is not USDC, so there is no USDC gas refund there.
        if (rewardTo != _merchant && ChainConfig.isArc()) {
            // Record for the public collector leaderboard. Done before the gas
            // measurement ends, so the collector is refunded for it too.
            ISlotFactoryStats(factory).recordCollect(rewardTo, gross);
            reimbursement = _gasRefund6(g0, fee > 0 && !holdFee ? 3 : 2) + tip;

            // Never pay out short: refuse the sweep until gas drops. Both caps
            // bind: the merchant's own limit and 10% of this payment.
            if (reimbursement > maxReimbursement) revert GasTooHigh();
            if (reimbursement * 10_000 > gross * MAX_REWARD_BPS) revert GasTooHigh();

            // Taken from net (never from fee), so fee integrity is preserved.
            if (reimbursement > net) reimbursement = net;
            net -= reimbursement;
        }

        // ── Step 6: SafeERC20 transfers (Interactions) ─────────────────────────
        if (reimbursement > 0) {
            _usdc.safeTransfer(rewardTo, reimbursement);
        }
        if (fee > 0) {
            if (holdFee) emit FeeHeld(address(this), _payRef, _feeRecipient, fee);
            else _usdc.safeTransfer(_feeRecipient, fee);
        }
        if (net > 0) {
            _usdc.safeTransfer(_merchant, net);
        }

        // ── Step 7: event ──────────────────────────────────────────────────────
        emit Received(_payRef, gross, net, fee, reimbursement, rewardTo);
    }

    // ─── Held fees, stray tokens, native USDC ───────────────────────────────────

    /// @notice Pay fees held for a fee recipient that was blacklisted at sweep
    ///         time, once it no longer is. Anyone may call; it only ever pays
    ///         the fee recipient fixed at creation.
    function releaseHeldFees() external nonReentrant {
        uint256 amount = heldFees;
        if (amount == 0) revert NothingToSweep();
        (BlacklistResult f,) = _probeBlacklist(address(usdc), feeRecipient);
        if (f != BlacklistResult.Clear) revert FeeRecipientBlocked();
        heldFees = 0;
        usdc.safeTransfer(feeRecipient, amount);
        emit HeldFeesReleased(address(this), feeRecipient, amount);
    }

    /// @notice Send any non-USDC token that landed here to the merchant. Anyone
    ///         may call; it can only ever pay the merchant fixed at creation.
    function rescueToken(address token) external nonReentrant {
        if (token == address(usdc)) revert CannotRescueUsdc();
        uint256 amount = IERC20(token).balanceOf(address(this));
        if (amount == 0) revert NothingToSweep();
        IERC20(token).safeTransfer(merchant, amount);
        emit Rescued(token, merchant, amount);
    }

    /// @notice On Arc, native USDC is the same balance as the ERC-20, so a plain
    ///         wallet "send" pays the slot. Elsewhere native coins would be
    ///         stranded, so they are refused.
    receive() external payable {
        if (!ChainConfig.isArc()) revert NativeNotAccepted();
    }

    // ─── Internal helpers ──────────────────────────────────────────────────────

    /// @dev Gas spent so far plus the unmeasured overhead, in 6-decimal USDC.
    ///      Priced at the network base fee, not the sweeper's chosen priority
    ///      tip — otherwise an overpaying wallet trips GasTooHigh and the
    ///      merchant funds the sweeper's tip. TIP covers a normal priority fee.
    function _gasRefund6(uint256 g0, uint256 transfers) internal view returns (uint256) {
        uint256 price    = tx.gasprice < block.basefee ? tx.gasprice : block.basefee;
        uint256 overhead = GAS_BASE_OVERHEAD + GAS_PER_TRANSFER * transfers;
        return ((g0 - gasleft() + overhead) * price) / 1e12;
    }

    enum BlacklistResult { Clear, Blacklisted, CallFailed }

    /// @dev Probes isBlacklisted(address) on the USDC contract via staticcall.
    ///      Returns (CallFailed, false) if the call reverts or returns short data
    ///      — the caller must treat this as a quarantine trigger (fail-closed).
    function _probeBlacklist(address _usdcAddr, address who)
        internal
        view
        returns (BlacklistResult result, bool blacklisted_)
    {
        (bool ok, bytes memory ret) = _usdcAddr.staticcall(
            abi.encodeWithSignature("isBlacklisted(address)", who)
        );
        if (!ok || ret.length < 32) return (BlacklistResult.CallFailed, false);
        bool flag = abi.decode(ret, (bool));
        return flag
            ? (BlacklistResult.Blacklisted, true)
            : (BlacklistResult.Clear, false);
    }
}
