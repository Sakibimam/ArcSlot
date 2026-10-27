// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {SlotTestBase, MockUSDC} from "./Slot.t.sol";
import {SlotFactory}            from "../SlotFactory.sol";
import {Slot}                   from "../Slot.sol";

// v9: M-1 fix — the Slot implementation must be locked at construction time so
// no caller can initialise it.  Tests run against the *pre-fix* contract to
// confirm they catch the vulnerability, then pass once the fix is in.

// ─── M-1: implementation must reject initialize() from any caller ────────────

contract ImplLockedTest is SlotTestBase {
    // Test 1: the bare implementation (not a clone) must revert AlreadyInitialised
    // on the very first call to initialize(), from any caller including address(this).
    function test_ImplRejectsInitializeFromAnyCaller() public {
        // Deploy a fresh implementation directly — same as setUp() does internally.
        Slot impl = new Slot();

        // Without the M-1 fix, this succeeds; with the fix it must revert.
        vm.expectRevert(Slot.AlreadyInitialised.selector);
        impl.initialize(
            address(usdc),   // _usdc
            TIP,             // _tip
            MIN_SWEEP,       // _minSweep
            MAX_R,           // _maxReimbursement
            merchant,        // _merchant
            keccak256("m1"), // _payRef
            0,               // _feeBps
            address(0)       // _feeRecipient
        );
    }

    // Test 2: clones created through the factory are completely unaffected —
    // they still initialise correctly, accept a payment, and sweep it to the merchant.
    function test_ClonesAreUnaffected() public {
        // Deploy and fund a clone through the factory.
        address slot = factory.createSlot(merchant, ref1, 0, address(0), MAX_R);
        usdc.mint(slot, 1e6); // 1 USDC

        // Slot must have been initialised with the right merchant.
        assertEq(Slot(payable(slot)).merchant(), merchant);

        // sweep() must pay the merchant and leave nothing in the slot.
        uint256 before = usdc.balanceOf(merchant);
        vm.prank(merchant);
        Slot(payable(slot)).sweep();
        assertGt(usdc.balanceOf(merchant), before, "merchant not paid");
        assertEq(usdc.balanceOf(slot), 0, "slot not empty after sweep");
    }

    // Test 3: the v8 removal of resolveQuarantine is still in place — a low-level
    // call with that selector on a deployed clone must fail.  This guards against
    // accidentally re-adding the function in a future patch.
    function test_ResolveQuarantineDoesNotExistOnClone() public {
        address slot = factory.createSlot(merchant, ref1, 0, address(0), MAX_R);

        // Build the call: resolveQuarantine(address,address,uint16)
        address fresh = makeAddr("fresh");
        bytes memory data = abi.encodeWithSignature(
            "resolveQuarantine(address,address,uint16)",
            fresh,
            address(0),
            uint16(0)
        );
        vm.prank(merchant);
        (bool ok,) = slot.call(data);
        assertFalse(ok, "resolveQuarantine must not exist on a Slot clone");
    }
}
