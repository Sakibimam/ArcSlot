// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {SlotTestBase} from "./Slot.t.sol";
import {SlotFactory}  from "../SlotFactory.sol";
import {Slot}         from "../Slot.sol";

// ─── Slot remembers what it collected ───────────────────────────────────────

contract SlotCollectedTest is SlotTestBase {
    /// Without this, a paid-then-collected request looks unpaid to the payer.
    function test_TotalCollectedSurvivesTheSweep() public {
        address slot = _slotFunded(0, 1_000_000);
        assertEq(Slot(slot).totalCollected(), 0);
        vm.warp(1_800_000_000);
        Slot(slot).sweep();
        assertEq(Slot(slot).balance(), 0);
        assertEq(Slot(slot).totalCollected(), 1_000_000, "gross recorded");
        assertEq(Slot(slot).lastCollectedAt(), 1_800_000_000);
    }

    function test_TotalCollectedAccumulatesAcrossRounds() public {
        address slot = _slotFunded(0, 1_000_000);
        Slot(slot).sweep();
        _fund(slot, 500_000);
        Slot(slot).sweep();
        assertEq(Slot(slot).totalCollected(), 1_500_000);
    }

    function test_QuarantinedSweepCollectsNothing() public {
        address slot = _slotFunded(0, 1_000_000);
        usdc.setBlacklisted(merchant, true);
        Slot(slot).sweep();
        assertTrue(Slot(slot).quarantined());
        assertEq(Slot(slot).totalCollected(), 0);
    }
}

// ─── Requests stored on-chain ───────────────────────────────────────────────

contract SlotRequestTest is SlotTestBase {
    address internal creator = makeAddr("creator");

    function _request(address m, bytes32 ref, uint256 amount, string memory label, uint64 expiresAt)
        internal returns (address)
    {
        vm.prank(creator);
        return factory.createRequest(m, ref, 0, address(0), MAX_R, amount, label, expiresAt);
    }

    function test_StoresAmountLabelExpiryAndCreator() public {
        vm.warp(1_800_000_000);
        address slot = _request(merchant, ref1, 1_500_000, "Invoice #42", 1_800_086_400);
        SlotFactory.Request memory r = factory.requestOf(slot);
        assertEq(r.creator, creator);
        assertEq(r.merchant, merchant);
        assertEq(r.amount, 1_500_000);
        assertEq(r.label, "Invoice #42");
        assertEq(r.createdAt, 1_800_000_000);
        assertEq(r.expiresAt, 1_800_086_400);
        assertTrue(r.exists);
    }

    function test_DeploysTheSameSlotAsPredict() public {
        address predicted = factory.predict(creator, merchant, ref1);
        assertEq(_request(merchant, ref1, 1, "x", 0), predicted);
        assertEq(Slot(predicted).merchant(), merchant);
        assertEq(Slot(predicted).maxReimbursement(), MAX_R);
    }

    function test_IndexesRequestsByCreatorNewestLast() public {
        address a = _request(merchant, ref1, 1, "first", 0);
        address b = _request(merchant, ref2, 2, "second", 0);
        assertEq(factory.requestCount(creator), 2);
        address[] memory page = factory.requestsOf(creator, 0, 10);
        assertEq(page.length, 2);
        assertEq(page[0], a);
        assertEq(page[1], b);
    }

    function test_PaginationClampsToRange() public {
        _request(merchant, ref1, 1, "a", 0);
        _request(merchant, ref2, 1, "b", 0);
        _request(merchant, keccak256("ref3"), 1, "c", 0);
        address[] memory page = factory.requestsOf(creator, 1, 10);
        assertEq(page.length, 2);
        assertEq(factory.requestsOf(creator, 5, 10).length, 0);
        assertEq(factory.requestsOf(creator, 0, 1).length, 1);
    }

    function test_RejectsOverlongLabel() public {
        vm.expectRevert(SlotFactory.LabelTooLong.selector);
        _request(merchant, ref1, 1, string(new bytes(81)), 0);
    }

    function test_RejectsExpiryInThePast() public {
        vm.warp(1_800_000_000);
        vm.expectRevert(SlotFactory.BadExpiry.selector);
        _request(merchant, ref1, 1, "late", 1_799_999_999);
    }

    function test_SameValidationAsCreateSlot() public {
        vm.expectRevert(SlotFactory.ZeroMerchant.selector);
        _request(address(0), ref1, 1, "x", 0);
        _request(merchant, ref1, 1, "x", 0);
        vm.expectRevert(SlotFactory.ReferenceAlreadyUsed.selector);
        _request(merchant, ref1, 1, "again", 0);
    }

    function test_PlainCreateSlotHasNoRequestInfo() public {
        address slot = factory.createSlot(merchant, ref1, 0, address(0), MAX_R);
        assertFalse(factory.requestOf(slot).exists);
        assertEq(factory.requestCount(address(this)), 0);
    }

    function test_EmitsRequestCreated() public {
        address predicted = factory.predict(creator, merchant, ref1);
        vm.expectEmit(true, true, true, true, address(factory));
        emit SlotFactory.RequestCreated(predicted, creator, merchant, 1_000_000, "Coffee", 0);
        _request(merchant, ref1, 1_000_000, "Coffee", 0);
    }
}
