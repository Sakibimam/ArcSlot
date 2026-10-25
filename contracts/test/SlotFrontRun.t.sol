// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {SlotTestBase} from "./Slot.t.sol";
import {SlotFactory}  from "../SlotFactory.sol";
import {Slot}         from "../Slot.sol";

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT H-1: a slot's address commits to its creator, so copying a pending
// createSlot/createRequest with attacker-chosen fees lands somewhere else.
// ═══════════════════════════════════════════════════════════════════════════════

contract SlotFrontRunTest is SlotTestBase {
    address internal creator  = makeAddr("creator");
    address internal attacker = makeAddr("attacker");

    function test_PredictBindsCreator() public view {
        assertTrue(
            factory.predict(creator, merchant, ref1) != factory.predict(attacker, merchant, ref1),
            "different creators must get different addresses"
        );
    }

    function test_PredictMatchesDeployedForCaller() public {
        address predicted = factory.predict(creator, merchant, ref1);
        vm.prank(creator);
        address deployed = factory.createSlot(merchant, ref1, 100, feeRecipient, MAX_R);
        assertEq(deployed, predicted, "predict != deployed");
    }

    function test_FrontRunCreateSlotCannotHijackFees() public {
        address expected = factory.predict(creator, merchant, ref1);

        // Attacker copies (merchant, payRef) with a 10% fee to themselves.
        vm.prank(attacker);
        address hijack = factory.createSlot(merchant, ref1, 1000, attacker, MAX_R);
        assertTrue(hijack != expected, "front-run must not land on the merchant's address");

        // The merchant's own transaction still succeeds, with their terms.
        vm.prank(creator);
        address slot = factory.createSlot(merchant, ref1, 0, address(0), MAX_R);
        assertEq(slot, expected);
        assertEq(Slot(slot).feeBps(), 0);
        assertEq(Slot(slot).feeRecipient(), address(0));
    }

    function test_FrontRunCreateRequestCannotHijackTerms() public {
        address expected = factory.predict(creator, merchant, ref1);

        vm.prank(attacker);
        factory.createRequest(merchant, ref1, 1000, attacker, MAX_R, 999e6, "scam", 0);

        vm.prank(creator);
        address slot = factory.createRequest(merchant, ref1, 0, address(0), MAX_R, 25e6, "Invoice 7", 0);
        assertEq(slot, expected);
        SlotFactory.Request memory r = factory.requestOf(slot);
        assertEq(r.creator, creator);
        assertEq(r.amount, 25e6);
        assertEq(r.label, "Invoice 7");
        assertEq(Slot(slot).feeBps(), 0);
    }

    function test_SameCreatorCannotReuseReference() public {
        vm.startPrank(creator);
        factory.createSlot(merchant, ref1, 0, address(0), MAX_R);
        vm.expectRevert(SlotFactory.ReferenceAlreadyUsed.selector);
        factory.createSlot(merchant, ref1, 0, address(0), MAX_R);
        vm.stopPrank();
    }

    function test_SlotCreatedEmitsCreator() public {
        address expected = factory.predict(creator, merchant, ref1);
        vm.expectEmit(true, true, true, true, address(factory));
        emit SlotFactory.SlotCreated(expected, merchant, ref1, creator, 0, address(0));
        vm.prank(creator);
        factory.createSlot(merchant, ref1, 0, address(0), MAX_R);
    }

    function testFuzz_NoOtherCreatorReachesTheAddress(address other) public view {
        vm.assume(other != creator);
        assertTrue(factory.predict(other, merchant, ref1) != factory.predict(creator, merchant, ref1));
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT L-1: resolveQuarantine is observable on-chain.
// ═══════════════════════════════════════════════════════════════════════════════

contract QuarantineResolvedEventTest is SlotTestBase {
    function test_ResolveQuarantineEmitsEvent() public {
        address slot = _slot(0);
        usdc.setBlacklisted(merchant, true);
        _fund(slot, 1e6);
        Slot(slot).sweep(); // quarantines: merchant is blacklisted
        assertTrue(Slot(slot).quarantined());

        address newMerchant = makeAddr("newMerchant");
        vm.expectEmit(true, true, false, true, slot);
        emit Slot.QuarantineResolved(slot, ref1, newMerchant, address(0), 0);
        vm.prank(merchant);
        Slot(slot).resolveQuarantine(newMerchant, address(0), 0);
    }
}
