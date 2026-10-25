// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {SlotTestBase, MockUSDC} from "./Slot.t.sol";
import {SlotFactory}            from "../SlotFactory.sol";
import {Slot}                   from "../Slot.sol";

// ═══════════════════════════════════════════════════════════════════════════════
// White-hat attack attempts against v6. Each test either proves an attack
// fails, or (PoC) shows what an attacker can do so the app must defend.
// ═══════════════════════════════════════════════════════════════════════════════

/// Answers everything the pay page reads from a Slot, but keeps the money.
contract FakeSlot {
    address public immutable merchant;
    address internal immutable thief;
    uint256 public constant totalCollected = 0;

    constructor(address impersonated) { merchant = impersonated; thief = msg.sender; }

    function steal(MockUSDC usdc) external {
        usdc.transfer(thief, usdc.balanceOf(address(this)));
    }
}

/// Answers pqKey()/owner() like a SlotVault, with none of its protections.
contract FakeVault {
    bytes32 public constant pqKey = keccak256("looks-quantum-safe");
    address public immutable owner;
    constructor() { owner = msg.sender; }
}

contract WhiteHatTest is SlotTestBase {
    address internal thief = makeAddr("thief");
    address internal payer = makeAddr("payer");

    // ── PoC: why the pay page must check factory.isSlot ────────────────────

    function test_PoC_FakeSlotImpersonatesMerchantAndKeepsPayment() public {
        vm.prank(thief);
        FakeSlot fake = new FakeSlot(merchant);
        assertEq(fake.merchant(), merchant, "fake answers merchant() like a real slot");
        assertEq(fake.totalCollected(), 0);

        usdc.mint(payer, 5e6);
        vm.prank(payer);
        usdc.transfer(address(fake), 5e6); // the pay page's only action: a USDC transfer

        vm.prank(thief);
        fake.steal(usdc);
        assertEq(usdc.balanceOf(thief), 5e6, "thief keeps the payment");
        assertEq(usdc.balanceOf(merchant), 0, "merchant never gets it");
        // The on-chain check that tells them apart:
        assertFalse(factory.isSlot(address(fake)), "factory does not recognise it");
    }

    function test_PoC_FakeVaultAnswersPqKey() public {
        FakeVault v = new FakeVault();
        assertTrue(v.pqKey() != bytes32(0), "a non-vault can claim a PQ key");
    }

    // ── Attacks that must fail ─────────────────────────────────────────────

    /// Re-initialising a deployed slot to redirect its funds.
    function test_Attack_ReinitialiseSlot() public {
        address slot = _slot(0);
        vm.prank(thief);
        vm.expectRevert(Slot.AlreadyInitialised.selector);
        Slot(slot).initialize(address(usdc), 0, 0, type(uint256).max, thief, ref1, 0, address(0));
    }

    /// Initialising the shared implementation directly must not affect clones.
    function test_Attack_InitialiseImplementationDoesNotTouchClones() public {
        address slot = _slotFunded(0, 1e6);
        Slot impl = Slot(factory.implementation());
        vm.prank(thief);
        try impl.initialize(address(usdc), 0, 0, type(uint256).max, thief, ref1, 0, address(0)) {} catch {}
        Slot(slot).sweepFor(stranger);
        assertEq(Slot(slot).merchant(), merchant);
        assertGt(usdc.balanceOf(merchant), 0, "merchant still paid");
        assertEq(usdc.balanceOf(thief), 0);
    }

    /// Only the merchant can resolve a quarantine (i.e. change payout).
    function test_Attack_StrangerCannotRedirectQuarantinedFunds() public {
        address slot = _slotFunded(0, 1e6);
        usdc.setBlacklisted(merchant, true);
        Slot(slot).sweep();
        vm.prank(thief);
        vm.expectRevert(Slot.NotMerchant.selector);
        Slot(slot).resolveQuarantine(thief, address(0), 0);
    }

    /// Quarantine by starving the blacklist probe of gas (63/64 rule): with
    /// any gas limit, a sweep either reverts or never quarantines a clean slot.
    function testFuzz_Attack_GasStarvedProbeCannotQuarantine(uint256 gasLimit) public {
        address slot = _slotFunded(0, 1e6);
        gasLimit = bound(gasLimit, 5_000, 400_000);
        vm.prank(thief);
        (bool ok,) = slot.call{gas: gasLimit}(abi.encodeCall(Slot.sweepFor, (thief)));
        assertFalse(Slot(slot).quarantined(), "clean slot quarantined by gas griefing");
        if (!ok) assertEq(usdc.balanceOf(slot), 1e6, "failed sweep moved funds");
    }

    /// A sweeper overpaying the priority fee is refunded at base fee only.
    function test_Attack_HighGasPriceDoesNotInflateRefund() public {
        address a = _slotFunded(0, 1e6);
        vm.fee(1 gwei);
        vm.txGasPrice(1 gwei);
        vm.prank(stranger);
        Slot(a).sweep();
        uint256 normal = usdc.balanceOf(stranger);

        vm.prank(stranger);
        address b = factory.createSlot(merchant, ref2, 0, address(0), MAX_R);
        _fund(b, 1e6);
        vm.txGasPrice(1000 gwei); // tries to make the merchant pay a huge "gas" bill
        vm.prank(thief);
        Slot(b).sweep();
        // 1000x the gas price buys no extra refund (small diffs are warm/cold storage).
        assertLe(usdc.balanceOf(thief), normal + 100, "refund not capped at base fee");
    }

    /// Merchant funds can never be locked by expensive gas: the merchant can
    /// always sweep their own slot (no reimbursement, no GasTooHigh).
    function test_Attack_HighBaseFeeCannotLockMerchantFunds() public {
        address slot = _slotFunded(0, 1e6);
        vm.fee(100_000 gwei);
        vm.txGasPrice(100_000 gwei);
        vm.prank(stranger);
        vm.expectRevert(Slot.GasTooHigh.selector);
        Slot(slot).sweep();
        vm.prank(merchant);
        Slot(slot).sweep();
        assertEq(usdc.balanceOf(merchant), 1e6);
    }

    /// Fake leaderboard entries: only factory slots can record collections.
    function test_Attack_ForgeCollectorStats() public {
        vm.prank(thief);
        vm.expectRevert(SlotFactory.NotSlot.selector);
        factory.recordCollect(thief, 1_000_000e6);
    }

    /// Calling sweepMany with a malicious "slot" cannot hijack the batch.
    function test_Attack_SweepManyWithHostileEntries() public {
        address slot = _slotFunded(0, 1e6);
        address[] memory list = new address[](3);
        list[0] = address(new FakeVault()); // no sweepFor: reverts, swallowed
        list[1] = address(0);
        list[2] = slot;
        vm.prank(stranger);
        factory.sweepMany(list);
        assertEq(usdc.balanceOf(slot), 0, "real slot still swept");
        assertGt(usdc.balanceOf(merchant), 0);
    }

    /// Fee bound: a creator can't set a fee above 10%, even on their own slot.
    function test_Attack_FeeAboveCap() public {
        vm.expectRevert(SlotFactory.FeeBpsTooHigh.selector);
        factory.createSlot(merchant, ref2, 1001, thief, MAX_R);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Found by the white-hat fork test: Circle blacklists the USDC contract itself,
// so a slot paying out to it (or to any blacklisted address that can't call
// resolveQuarantine) quarantines forever. Refuse such payouts up front.
// ═══════════════════════════════════════════════════════════════════════════════

contract BlacklistedPayoutTest is SlotTestBase {
    function test_RejectsBlacklistedMerchant() public {
        usdc.setBlacklisted(merchant, true);
        vm.expectRevert(SlotFactory.BlacklistedPayout.selector);
        factory.createSlot(merchant, ref1, 0, address(0), MAX_R);
    }

    function test_RejectsUsdcContractAsMerchant() public {
        usdc.setBlacklisted(address(usdc), true); // as on real Arc USDC
        vm.expectRevert(SlotFactory.BlacklistedPayout.selector);
        factory.createSlot(address(usdc), ref1, 0, address(0), MAX_R);
    }

    function test_RejectsBlacklistedFeeRecipient() public {
        usdc.setBlacklisted(feeRecipient, true);
        vm.expectRevert(SlotFactory.BlacklistedPayout.selector);
        factory.createSlot(merchant, ref1, 100, feeRecipient, MAX_R);
    }

    function test_IgnoresUnusedFeeRecipient() public {
        usdc.setBlacklisted(feeRecipient, true);
        factory.createSlot(merchant, ref1, 0, feeRecipient, MAX_R); // no fee: not paid, not checked
    }

    function test_RequestRejectsBlacklistedMerchant() public {
        usdc.setBlacklisted(merchant, true);
        vm.expectRevert(SlotFactory.BlacklistedPayout.selector);
        factory.createRequest(merchant, ref1, 0, address(0), MAX_R, 1e6, "x", 0);
    }

    /// Resolving a quarantine onto the USDC contract would lock the slot for good.
    function test_ResolveQuarantineRejectsUsdcAsNewMerchant() public {
        address slot = _slotFunded(0, 1e6);
        usdc.setBlacklisted(merchant, true);
        Slot(slot).sweep();
        vm.prank(merchant);
        vm.expectRevert(Slot.BadPayout.selector);
        Slot(slot).resolveQuarantine(address(usdc), address(0), 0);
    }

    function test_ResolveQuarantineRejectsUsdcAsNewFeeRecipient() public {
        address slot = _slotFunded(0, 1e6);
        usdc.setBlacklisted(merchant, true);
        Slot(slot).sweep();
        vm.prank(merchant);
        vm.expectRevert(Slot.BadPayout.selector);
        Slot(slot).resolveQuarantine(makeAddr("m2"), address(usdc), 100);
    }
}
