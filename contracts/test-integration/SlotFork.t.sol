// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test}        from "forge-std/Test.sol";
import {IERC20}      from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SlotFactory} from "../SlotFactory.sol";
import {Slot}        from "../Slot.sol";

/// Integration tests against a fork of Arc (real USDC at 0x3600..., real blocklist).
///   bun run contracts:test:fork
contract SlotForkTest is Test {
    IERC20  internal constant USDC = IERC20(0x3600000000000000000000000000000000000000);
    uint256 internal constant TIP       = 2_000;
    uint256 internal constant MIN_SWEEP = 100_000;
    uint256 internal constant MAX_R     = 50_000;

    SlotFactory internal factory;
    address internal merchant = makeAddr("fork-merchant");
    address internal payer    = makeAddr("fork-payer");
    address internal stranger = makeAddr("fork-stranger");

    function setUp() public {
        factory = new SlotFactory(address(new Slot()), TIP, MIN_SWEEP);
        // On Arc, native gas balance IS USDC (18-dec native view of the 6-dec ERC-20).
        vm.deal(payer, 10 ether); // 10 USDC
    }

    function _pay(address slot, uint256 amount6) internal {
        vm.prank(payer);
        assertTrue(USDC.transfer(slot, amount6), "USDC transfer failed");
    }

    /// White-hat: starve the real USDC blacklist probe of gas (63/64 rule) so
    /// it "fails" and fail-closed quarantine freezes a clean slot. Must not work.
    function testFuzz_Fork_GasStarvedProbeCannotQuarantine(uint256 gasLimit) public {
        address slot = factory.createSlot(merchant, keccak256("fork-grief"), 0, address(0), MAX_R);
        _pay(slot, 1_000_000);
        gasLimit = bound(gasLimit, 5_000, 400_000);
        vm.prank(stranger);
        (bool ok,) = slot.call{gas: gasLimit}(abi.encodeCall(Slot.sweepFor, (stranger)));
        assertFalse(Slot(payable(slot)).quarantined(), "clean slot quarantined by gas griefing");
        if (!ok) assertEq(USDC.balanceOf(slot), 1_000_000, "failed sweep moved funds");
    }

    /// White-hat (re Studio AUDIT-v6 C-1): real Arc USDC is a plain ERC-20 with
    /// no receiver hooks, so contracts, precompiles and fresh addresses all
    /// receive sweeps fine. What it does refuse is blacklisted addresses — and
    /// Circle blacklists the USDC contract itself, which as a payout would lock
    /// the slot in quarantine forever. The factory now rejects that up front.
    function test_Fork_RealUsdcAcceptsAnyNonBlacklistedPayout() public {
        address[3] memory payouts = [
            address(new RevertingFallback()),            // contract that rejects every call
            0x1800000000000000000000000000000000000004, // Arc PQ precompile
            makeAddr("fresh-eoa")
        ];
        for (uint256 i; i < payouts.length; ++i) {
            address slot = factory.createSlot(payouts[i], keccak256(abi.encode("payout", i)), 0, address(0), MAX_R);
            _pay(slot, 1_000_000);
            uint256 before = USDC.balanceOf(payouts[i]);
            vm.prank(stranger);
            Slot(payable(slot)).sweep();
            assertEq(USDC.balanceOf(slot), 0, "slot not emptied");
            assertGt(USDC.balanceOf(payouts[i]), before, "payout not credited");
        }
    }

    function test_Fork_RejectsUsdcContractAsPayout() public {
        vm.expectRevert(SlotFactory.BlacklistedPayout.selector);
        factory.createSlot(address(USDC), keccak256("usdc-payout"), 0, address(0), MAX_R);
    }

    /// v8 (audit H-2): a wallet's plain native-USDC send pays a slot on real
    /// Arc, shows up in the ERC-20 balance, and sweeps to the merchant.
    function test_Fork_NativeUsdcSendPaysSlot() public {
        address slot = factory.createSlot(merchant, keccak256("fork-native"), 0, address(0), MAX_R);
        vm.prank(payer);
        (bool ok,) = payable(slot).call{value: 1 ether}(""); // 1 USDC, 18-dec native
        assertTrue(ok, "native send to slot reverted on Arc");
        assertEq(USDC.balanceOf(slot), 1_000_000, "native send not visible as ERC-20");
        vm.prank(merchant);
        Slot(payable(slot)).sweep();
        assertEq(USDC.balanceOf(merchant), 1_000_000);
    }

    /// Native sends finer than 1e-6 USDC: what does the ERC-20 view show, and
    /// is any of it left behind after a sweep?
    function test_Fork_NativeDustBehaviour() public {
        address slot = factory.createSlot(merchant, keccak256("fork-dust"), 0, address(0), MAX_R);
        vm.prank(payer);
        (bool ok,) = payable(slot).call{value: 1 ether + 123_456_789}(""); // 1.000000000123456789
        assertTrue(ok);
        emit log_named_uint("erc20 view (6-dec)", USDC.balanceOf(slot));
        emit log_named_uint("native (18-dec)   ", slot.balance);
        vm.prank(merchant);
        Slot(payable(slot)).sweep();
        emit log_named_uint("native left after sweep (wei)", slot.balance);
        assertLt(slot.balance, 1e12, "more than sub-micro dust left behind");
    }

    function test_Fork_UsdcIsSixDecimals() public view {
        (bool ok, bytes memory ret) = address(USDC).staticcall(abi.encodeWithSignature("decimals()"));
        assertTrue(ok);
        assertEq(abi.decode(ret, (uint8)), 6);
    }

    function test_Fork_NativeDealShowsAsErc20() public view {
        assertEq(USDC.balanceOf(payer), 10_000_000, "native/ERC-20 views disagree");
    }

    function test_Fork_PredictCreateFundSweep() public {
        bytes32 ref = keccak256("fork-order-1");
        address predicted = factory.predict(address(this), merchant, ref);
        address slot = factory.createSlot(merchant, ref, 0, address(0), MAX_R);
        assertEq(slot, predicted, "predict != deployed on fork");

        _pay(slot, 1_000_000); // 1 USDC
        assertEq(Slot(payable(slot)).balance(), 1_000_000);

        vm.txGasPrice(21 gwei);
        vm.prank(stranger);
        Slot(payable(slot)).sweep();

        uint256 got = USDC.balanceOf(stranger);
        assertGe(got, TIP, "sweeper not paid");
        assertLe(got, MAX_R, "over cap");
        assertEq(USDC.balanceOf(merchant) + got, 1_000_000, "not conserved");
        assertEq(Slot(payable(slot)).balance(), 0, "slot not drained");
        assertFalse(Slot(payable(slot)).quarantined(), "real blocklist probe failed");
    }

    /// Regression for the live testnet failure: overpaid priority tip on a
    /// real Arc base fee must not trip GasTooHigh.
    function test_Fork_OverpaidPriorityTipStillSweeps() public {
        address slot = factory.createSlot(merchant, keccak256("fork-order-5"), 0, address(0), MAX_R);
        _pay(slot, 150_000);
        vm.txGasPrice(block.basefee + 575 gwei);
        vm.prank(stranger);
        Slot(payable(slot)).sweep();
        assertEq(Slot(payable(slot)).balance(), 0, "not swept");
        assertLe(USDC.balanceOf(stranger), MAX_R, "over cap");
    }

    function test_Fork_FeeSplitOnRealUsdc() public {
        address feeTo = makeAddr("fork-fee");
        address slot = factory.createSlot(merchant, keccak256("fork-order-2"), 250, feeTo, MAX_R);
        _pay(slot, 2_000_000);

        vm.prank(merchant); // self-sweep: no reimbursement
        Slot(payable(slot)).sweep();

        assertEq(USDC.balanceOf(feeTo), 50_000, "2.5% fee wrong");
        assertEq(USDC.balanceOf(merchant), 1_950_000, "merchant net wrong");
    }

    function test_Fork_GasTooHighAtCeiling() public {
        address slot = factory.createSlot(merchant, keccak256("fork-order-3"), 0, address(0), MAX_R);
        _pay(slot, MIN_SWEEP);

        vm.fee(20_000 gwei);
        vm.txGasPrice(20_000 gwei);
        vm.prank(stranger);
        vm.expectRevert(Slot.GasTooHigh.selector);
        Slot(payable(slot)).sweep();
        assertEq(Slot(payable(slot)).balance(), MIN_SWEEP, "payment touched");
    }

    function test_Fork_BelowMinimumReverts() public {
        address slot = factory.createSlot(merchant, keccak256("fork-order-4"), 0, address(0), MAX_R);
        _pay(slot, 50_000);
        vm.expectRevert(Slot.BelowMinSweep.selector);
        Slot(payable(slot)).sweep();
    }

    /// Found live on testnet: FIXED_OVERHEAD was calibrated against mock
    /// transfers; real Arc USDC transfers cost far more, so a stranger was
    /// under-reimbursed. At base fee, the gas refund must cover the real
    /// full-tx gas (execution + 21k intrinsic + calldata), with and without fee.
    function _assertGasCovered(uint16 feeBps, address feeTo, bytes32 ref) internal {
        address slot = factory.createSlot(merchant, ref, feeBps, feeTo, MAX_R);
        _pay(slot, 1_000_000);
        vm.txGasPrice(block.basefee); // zero priority: isolate the gas refund

        uint256 g0 = gasleft();
        vm.prank(stranger);
        Slot(payable(slot)).sweep();
        uint256 txGas = g0 - gasleft() + 21_000 + 64; // + intrinsic + 4-byte calldata

        uint256 cost6 = (txGas * block.basefee) / 1e12;
        uint256 refund = USDC.balanceOf(stranger) - TIP;
        emit log_named_uint("full tx gas", txGas);
        emit log_named_uint("gas cost (6-dec)", cost6);
        emit log_named_uint("gas refund (6-dec)", refund);
        assertGe(refund, cost6, "gas refund below real cost");
        assertLe(refund, cost6 * 115 / 100, "gas refund >15% above real cost");
    }

    function test_Fork_GasRefundCoversRealCost_NoFee() public {
        _assertGasCovered(0, address(0), keccak256("fork-gas-1"));
    }

    function test_Fork_GasRefundCoversRealCost_WithFee() public {
        _assertGasCovered(250, makeAddr("fork-fee2"), keccak256("fork-gas-2"));
    }
}

contract RevertingFallback {
    fallback() external payable { revert("no"); }
}
