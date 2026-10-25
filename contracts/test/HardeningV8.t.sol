// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {SlotTestBase, MockUSDC} from "./Slot.t.sol";
import {SlotFactory}            from "../SlotFactory.sol";
import {Slot}                   from "../Slot.sol";

// v8: every attack from the v7 independent review, as a test that must now FAIL.

contract OtherToken {
    mapping(address => uint256) public balanceOf;
    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function transfer(address to, uint256 a) external returns (bool) {
        balanceOf[msg.sender] -= a; balanceOf[to] += a; return true;
    }
}

// ─── A-1 / A-2: blacklist freeze, fee escrow, no payout rewrites ─────────────

contract BlacklistFreezeTest is SlotTestBase {
    address internal platform = makeAddr("platform");
    address internal fresh    = makeAddr("fresh-wallet");

    function test_BlacklistedMerchantFundsStayFrozen() public {
        address slot = _slotFunded(0, 50e6);
        usdc.setBlacklisted(merchant, true);
        Slot(payable(slot)).sweep();
        assertTrue(Slot(payable(slot)).quarantined());
        assertEq(usdc.balanceOf(slot), 50e6, "frozen funds moved");

        // The v7 escape hatch is gone: no way to rewrite the payout.
        vm.prank(merchant);
        (bool ok,) = slot.call(abi.encodeWithSignature("resolveQuarantine(address,address,uint16)", fresh, address(0), uint16(0)));
        assertFalse(ok, "payout rewrite still possible");
        vm.prank(merchant);
        Slot(payable(slot)).sweep();
        assertEq(usdc.balanceOf(fresh), 0);
        assertEq(usdc.balanceOf(slot), 50e6);
    }

    function test_UnfreezesWhenCircleClearsMerchant() public {
        address slot = _slotFunded(0, 5e6);
        usdc.setBlacklisted(merchant, true);
        Slot(payable(slot)).sweep();
        usdc.setBlacklisted(merchant, false);
        vm.prank(merchant);
        Slot(payable(slot)).sweep();
        assertFalse(Slot(payable(slot)).quarantined(), "quarantine not cleared");
        assertEq(usdc.balanceOf(merchant), 5e6);
    }

    function test_BlacklistedFeeRecipient_MerchantPaid_FeeHeld() public {
        vm.prank(platform);
        address slot = factory.createSlot(merchant, ref1, 1000, platform, MAX_R);
        _fund(slot, 10e6);
        usdc.setBlacklisted(platform, true);
        vm.prank(merchant);
        Slot(payable(slot)).sweep();
        assertFalse(Slot(payable(slot)).quarantined(), "merchant should not be blocked by the fee wallet");
        assertEq(usdc.balanceOf(merchant), 9e6, "merchant gets net");
        assertEq(Slot(payable(slot)).heldFees(), 1e6, "fee escrowed");
        assertEq(usdc.balanceOf(slot), 1e6);
        assertEq(usdc.balanceOf(platform), 0);
    }

    function test_HeldFeeIsNotSweptToMerchant() public {
        vm.prank(platform);
        address slot = factory.createSlot(merchant, ref1, 1000, platform, MAX_R);
        _fund(slot, 10e6);
        usdc.setBlacklisted(platform, true);
        vm.prank(merchant);
        Slot(payable(slot)).sweep();
        vm.prank(merchant);
        vm.expectRevert(Slot.NothingToSweep.selector);
        Slot(payable(slot)).sweep();
        assertEq(usdc.balanceOf(slot), 1e6);
    }

    function test_HeldFeeReleasedOnceCleared() public {
        vm.prank(platform);
        address slot = factory.createSlot(merchant, ref1, 1000, platform, MAX_R);
        _fund(slot, 10e6);
        usdc.setBlacklisted(platform, true);
        vm.prank(merchant);
        Slot(payable(slot)).sweep();

        vm.expectRevert(Slot.FeeRecipientBlocked.selector);
        Slot(payable(slot)).releaseHeldFees();

        usdc.setBlacklisted(platform, false);
        vm.prank(stranger);
        Slot(payable(slot)).releaseHeldFees();
        assertEq(usdc.balanceOf(platform), 1e6);
        assertEq(Slot(payable(slot)).heldFees(), 0);
    }

    function test_ReleaseWithNothingHeldReverts() public {
        address slot = _slot(0);
        vm.expectRevert(Slot.NothingToSweep.selector);
        Slot(payable(slot)).releaseHeldFees();
    }
}

// ─── H-2: native USDC on Arc ─────────────────────────────────────────────────

contract NativeReceiveTest is SlotTestBase {
    function test_AcceptsNativeValueOnArc() public {
        address slot = _slot(0);
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        (bool ok,) = slot.call{value: 1 ether}("");
        assertTrue(ok, "native USDC send to a slot must work on Arc");
    }

    function test_RejectsNativeValueOffArc() public {
        vm.chainId(11155111);
        address sepoliaUsdc = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
        vm.etch(sepoliaUsdc, address(usdc).code);
        address slot = factory.createSlot(merchant, ref1, 0, address(0), MAX_R);
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        (bool ok,) = slot.call{value: 1 ether}("");
        assertFalse(ok, "ETH would be stuck: must be refused off Arc");
    }
}

// ─── A-3: stuck tokens ───────────────────────────────────────────────────────

contract RescueTest is SlotTestBase {
    function test_RescueSendsOtherTokenToMerchant() public {
        address slot = _slot(0);
        OtherToken t = new OtherToken();
        t.mint(slot, 1_000e6);
        vm.prank(stranger);
        Slot(payable(slot)).rescueToken(address(t));
        assertEq(t.balanceOf(merchant), 1_000e6);
        assertEq(t.balanceOf(stranger), 0);
    }

    function test_CannotRescueUsdc() public {
        address slot = _slotFunded(0, 1e6);
        vm.expectRevert(Slot.CannotRescueUsdc.selector);
        Slot(payable(slot)).rescueToken(address(usdc));
    }

    function test_RescueEmptyReverts() public {
        address slot = _slot(0);
        OtherToken t = new OtherToken();
        vm.expectRevert(Slot.NothingToSweep.selector);
        Slot(payable(slot)).rescueToken(address(t));
    }
}

// ─── A-4: recovery no longer depends on the creator ─────────────────────────

contract RecoverSlotTest is SlotTestBase {
    address internal platform = makeAddr("platform");
    address internal constant SEPOLIA_USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    function test_CreatorIsRecorded() public {
        vm.prank(platform);
        address slot = factory.createSlot(merchant, ref1, 0, address(0), MAX_R);
        assertEq(factory.creatorOf(slot), platform);
    }

    function test_AnyoneRedeploysAtTheCreatorsAddressOffArc() public {
        address onArc = factory.predict(platform, merchant, ref1);
        vm.chainId(11155111);
        vm.etch(SEPOLIA_USDC, address(usdc).code);
        MockUSDC(SEPOLIA_USDC).mint(onArc, 50_000); // paid on the wrong chain
        vm.prank(merchant); // the platform is gone; the merchant recovers
        address slot = factory.recoverSlot(platform, merchant, ref1);
        assertEq(slot, onArc, "same address as on Arc");
        assertEq(Slot(payable(slot)).feeBps(), 0, "recovery slots never take a fee");
        Slot(payable(slot)).sweep();
        assertEq(MockUSDC(SEPOLIA_USDC).balanceOf(merchant), 50_000);
    }

    function test_RecoverSlotRefusedOnArc() public {
        vm.expectRevert(SlotFactory.OnlyOffArc.selector);
        factory.recoverSlot(platform, merchant, ref1);
    }

    function test_RecoverSlotRefusesBlacklistedMerchant() public {
        vm.chainId(11155111);
        vm.etch(SEPOLIA_USDC, address(usdc).code);
        MockUSDC(SEPOLIA_USDC).setBlacklisted(merchant, true);
        vm.expectRevert(SlotFactory.BlacklistedPayout.selector);
        factory.recoverSlot(platform, merchant, ref1);
    }
}

// ─── A-5 / A-6: collectors can only claim for themselves ────────────────────

contract CollectorRulesTest is SlotTestBase {
    address internal collector = makeAddr("collector");

    function test_StrangerCannotSweepForMerchantToGriefCollectors() public {
        address slot = _slotFunded(0, 1e6);
        vm.prank(stranger);
        vm.expectRevert(Slot.NotRewardRecipient.selector);
        Slot(payable(slot)).sweepFor(merchant);
    }

    function test_CannotCreditAnotherAddressOnTheLeaderboard() public {
        address slot = _slotFunded(0, 1e6);
        vm.prank(stranger);
        vm.expectRevert(Slot.NotRewardRecipient.selector);
        Slot(payable(slot)).sweepFor(makeAddr("vitalik.eth"));
    }

    function test_SweepForSelfWorks() public {
        address slot = _slotFunded(0, 1e6);
        vm.prank(collector);
        Slot(payable(slot)).sweepFor(collector);
        assertGt(usdc.balanceOf(collector), 0);
    }

    function test_SweepManyStillPaysTheRealCaller() public {
        address slot = _slotFunded(0, 1e6);
        address[] memory list = new address[](1);
        list[0] = slot;
        vm.prank(collector);
        factory.sweepMany(list);
        assertGt(usdc.balanceOf(collector), 0);
        (uint64 n,) = factory.collectorStats(collector);
        assertEq(n, 1);
    }
}

// ─── A-7: a collector never takes more than 10% of a payment ────────────────

contract RewardCapTest is SlotTestBase {
    address internal collector = makeAddr("collector");

    function test_SmallPaymentAtHighGasWaitsForCheaperGas() public {
        address slot = _slotFunded(0, 100_000); // 0.1 USDC
        vm.fee(140 gwei);
        vm.txGasPrice(140 gwei);
        vm.prank(collector);
        vm.expectRevert(Slot.GasTooHigh.selector);
        Slot(payable(slot)).sweep();
        vm.prank(merchant); // the merchant can always take it all
        Slot(payable(slot)).sweep();
        assertEq(usdc.balanceOf(merchant), 100_000);
    }

    function testFuzz_RewardWithinTenPercent(uint256 gross, uint256 baseFee) public {
        gross   = bound(gross, MIN_SWEEP, 1_000e6);
        baseFee = bound(baseFee, 1 gwei, 500 gwei);
        address slot = _slotFunded(0, gross);
        vm.fee(baseFee);
        vm.txGasPrice(baseFee);
        vm.prank(collector);
        try Slot(payable(slot)).sweep() {
            assertLe(usdc.balanceOf(collector) * 10, gross, "reward above 10% of the payment");
        } catch {}
    }
}
