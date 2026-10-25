// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {SlotTestBase} from "./Slot.t.sol";
import {SlotFactory}  from "../SlotFactory.sol";
import {Slot}         from "../Slot.sol";

contract CollectorRewardsTest is SlotTestBase {
    address internal collector = makeAddr("collector");

    function setUp() public override {
        super.setUp();
        vm.fee(20 gwei);
        vm.txGasPrice(21 gwei);
    }

    /// Bug found in review: through sweepMany, msg.sender inside the slot is the
    /// factory, so the reward went to the factory and was stuck there forever.
    function test_SweepManyPaysTheCallerNotTheFactory() public {
        address s1 = factory.createSlot(merchant, ref1, 0, address(0), MAX_R);
        address s2 = factory.createSlot(merchant, ref2, 0, address(0), MAX_R);
        _fund(s1, 1_000_000);
        _fund(s2, 1_000_000);
        address[] memory list = new address[](2);
        list[0] = s1; list[1] = s2;

        vm.prank(collector);
        factory.sweepMany(list);

        assertGt(usdc.balanceOf(collector), 0, "collector got nothing");
        assertEq(usdc.balanceOf(address(factory)), 0, "reward stuck in factory");
    }

    /// v8: a reward can only be claimed by the address that collects it.
    function test_SweepForCannotNameAnotherAddress() public {
        address slot = _slotFunded(0, 1_000_000);
        vm.prank(collector);
        vm.expectRevert(Slot.NotRewardRecipient.selector);
        Slot(payable(slot)).sweepFor(makeAddr("collector-payout"));
    }

    function test_MerchantSweepForSelfTakesNoReward() public {
        address slot = _slotFunded(0, 1_000_000);
        vm.prank(merchant);
        Slot(payable(slot)).sweepFor(merchant);
        assertEq(usdc.balanceOf(merchant), 1_000_000, "merchant should get everything");
    }
}

contract CollectorStatsTest is SlotTestBase {
    address internal alice = makeAddr("alice-collector");
    address internal bob   = makeAddr("bob-collector");

    function setUp() public override {
        super.setUp();
        vm.fee(20 gwei);
        vm.txGasPrice(21 gwei);
    }

    function _paidSlot(bytes32 ref, uint256 amount) internal returns (address s) {
        s = factory.createSlot(merchant, ref, 0, address(0), MAX_R);
        _fund(s, amount);
    }

    function test_RecordsCollectionsAndUsdcDelivered() public {
        address s1 = _paidSlot(ref1, 1_000_000);
        address s2 = _paidSlot(ref2, 2_000_000);
        vm.prank(alice); Slot(payable(s1)).sweep();
        vm.prank(alice); Slot(payable(s2)).sweep();

        (uint64 collections, uint192 delivered) = factory.collectorStats(alice);
        assertEq(collections, 2);
        assertEq(delivered, 3_000_000, "gross USDC delivered");
        assertEq(factory.totalCollections(), 2);
        assertEq(factory.totalDelivered(), 3_000_000);
    }

    function test_ListsCollectorsOnce() public {
        // Create first: vm.prank applies to the next call only.
        address s1 = _paidSlot(ref1, 1_000_000);
        address s2 = _paidSlot(ref2, 1_000_000);
        address s3 = _paidSlot(keccak256("r3"), 1_000_000);
        vm.prank(alice); Slot(payable(s1)).sweep();
        vm.prank(alice); Slot(payable(s2)).sweep();
        vm.prank(bob);   Slot(payable(s3)).sweep();

        assertEq(factory.collectorCount(), 2);
        (address[] memory who, SlotFactory.CollectorStats[] memory stats) = factory.collectorsPage(0, 10);
        assertEq(who.length, 2);
        assertEq(who[0], alice);
        assertEq(stats[0].collections, 2);
        assertEq(who[1], bob);
        assertEq(stats[1].collections, 1);
    }

    function test_MerchantCollectingOwnSlotIsNotACollector() public {
        address s = _paidSlot(ref1, 1_000_000);
        vm.prank(merchant);
        Slot(payable(s)).sweep();
        assertEq(factory.collectorCount(), 0);
        assertEq(factory.totalCollections(), 0);
    }

    function test_OnlyItsOwnSlotsCanRecord() public {
        vm.prank(alice);
        vm.expectRevert(SlotFactory.NotSlot.selector);
        factory.recordCollect(alice, 1_000_000);
    }

    function test_QuarantinedSweepIsNotRecorded() public {
        address s = _paidSlot(ref1, 1_000_000);
        usdc.setBlacklisted(merchant, true);
        vm.prank(alice);
        Slot(payable(s)).sweep();
        assertEq(factory.totalCollections(), 0);
    }
}

contract SlotRegistryTest is SlotTestBase {
    function test_EnumeratesEverySlot() public {
        address a = factory.createSlot(merchant, ref1, 0, address(0), MAX_R);
        vm.prank(makeAddr("someone"));
        address b = factory.createRequest(merchant, ref2, 0, address(0), MAX_R, 1, "x", 0);
        assertEq(factory.slotCount(), 2);
        address[] memory page = factory.slotsPage(0, 10);
        assertEq(page.length, 2);
        assertEq(page[0], a);
        assertEq(page[1], b);
        assertTrue(factory.isSlot(a));
        assertFalse(factory.isSlot(address(0xBEEF)));
    }

    function test_SlotsPagePaginates() public {
        factory.createSlot(merchant, ref1, 0, address(0), MAX_R);
        factory.createSlot(merchant, ref2, 0, address(0), MAX_R);
        factory.createSlot(merchant, keccak256("r3"), 0, address(0), MAX_R);
        assertEq(factory.slotsPage(1, 1).length, 1);
        assertEq(factory.slotsPage(2, 10).length, 1);
        assertEq(factory.slotsPage(3, 10).length, 0);
    }
}
