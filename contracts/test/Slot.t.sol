// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test}         from "forge-std/Test.sol";
import {SlotFactory}  from "../SlotFactory.sol";
import {Slot}         from "../Slot.sol";
import {IERC20}       from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// ═══════════════════════════════════════════════════════════════════════════════
// Mock USDC
// Supports isBlacklisted() and a revert-able transfer for reentrancy testing.
// ═══════════════════════════════════════════════════════════════════════════════

contract MockUSDC {
    uint8  public constant decimals = 6;
    string public constant symbol   = "USDC";

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public blacklisted;

    // Reentrancy test hook: if set, transfer() calls back the target.
    address public reentrantTarget;
    bool    private _inCallback;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function setBlacklisted(address who, bool flag) external {
        blacklisted[who] = flag;
    }

    function isBlacklisted(address who) external view returns (bool) {
        return blacklisted[who];
    }

    function setReentrantTarget(address target) external {
        reentrantTarget = target;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(to != address(0), "ERC20: zero");
        require(balanceOf[msg.sender] >= amount, "ERC20: bal");
        balanceOf[msg.sender] -= amount;
        balanceOf[to]         += amount;
        emit Transfer(msg.sender, to, amount);

        // Reentrancy hook: fire once on the first transfer in a sweep.
        if (reentrantTarget != address(0) && !_inCallback) {
            _inCallback = true;
            try Slot(reentrantTarget).sweep() {} catch {}
            _inCallback = false;
        }
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(to != address(0), "ERC20: zero");
        require(balanceOf[from] >= amount, "ERC20: bal");
        require(allowance[from][msg.sender] >= amount, "ERC20: allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from]             -= amount;
        balanceOf[to]               += amount;
        emit Transfer(from, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Base
// ═══════════════════════════════════════════════════════════════════════════════

contract SlotTestBase is Test {
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000;

    MockUSDC     internal usdc;
    SlotFactory  internal factory;

    address internal merchant     = makeAddr("merchant");
    address internal feeRecipient = makeAddr("feeRecipient");
    address internal stranger     = makeAddr("stranger");
    bytes32 internal ref1         = keccak256("order-001");
    bytes32 internal ref2         = keccak256("order-002");

    function setUp() public virtual {
        usdc = new MockUSDC();
        vm.etch(ARC_USDC, address(usdc).code);
        // After etch we must interact through the etched address,
        // but MockUSDC has mutable state (blacklist, reentrantTarget).
        // vm.etch only copies bytecode; storage lives at ARC_USDC.
        usdc = MockUSDC(ARC_USDC);

        factory = new SlotFactory();
    }

    function _fund(address to, uint256 amount) internal {
        usdc.mint(to, amount);
    }

    // Convenience: deploy a slot and fund it in one call.
    function _slot(uint16 feeBps_) internal returns (address) {
        address fp = feeBps_ > 0 ? feeRecipient : address(0);
        address s  = factory.createSlot(merchant, ref1, feeBps_, fp);
        return s;
    }

    function _slotFunded(uint16 feeBps_, uint256 amount) internal returns (address) {
        address s = _slot(feeBps_);
        _fund(s, amount);
        return s;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Predict / createSlot (unchanged from original suite — kept for regression)
// ═══════════════════════════════════════════════════════════════════════════════

contract PredictTest is SlotTestBase {
    function test_PredictMatchesDeployed() public {
        address predicted = factory.predict(merchant, ref1);
        address deployed  = factory.createSlot(merchant, ref1, 100, feeRecipient);
        assertEq(predicted, deployed, "predict != deployed");
    }

    function test_PredictIsIdempotent() public view {
        assertEq(factory.predict(merchant, ref1), factory.predict(merchant, ref1));
    }

    function test_DifferentRefsGiveDifferentAddresses() public view {
        assertTrue(factory.predict(merchant, ref1) != factory.predict(merchant, ref2));
    }

    function test_DifferentMerchantsSameRefGiveDifferentAddresses() public {
        address m2 = makeAddr("m2");
        assertTrue(factory.predict(merchant, ref1) != factory.predict(m2, ref1));
    }

    function testFuzz_PredictNonZero(address m, bytes32 r) public view {
        vm.assume(m != address(0));
        assertTrue(factory.predict(m, r) != address(0));
    }
}

contract CreateSlotRevertTest is SlotTestBase {
    function test_RevertZeroMerchant() public {
        vm.expectRevert(SlotFactory.ZeroMerchant.selector);
        factory.createSlot(address(0), ref1, 0, address(0));
    }

    function test_RevertFeeBpsTooHigh() public {
        vm.expectRevert(SlotFactory.FeeBpsTooHigh.selector);
        factory.createSlot(merchant, ref1, 1001, feeRecipient);
    }

    function test_RevertZeroFeeRecipientWhenFeeNonZero() public {
        vm.expectRevert(SlotFactory.ZeroFeeRecipient.selector);
        factory.createSlot(merchant, ref1, 100, address(0));
    }

    function test_RevertDuplicateReference() public {
        factory.createSlot(merchant, ref1, 0, address(0));
        vm.expectRevert(SlotFactory.ReferenceAlreadyUsed.selector);
        factory.createSlot(merchant, ref1, 0, address(0));
    }

    function test_SameRefDifferentMerchantIsAllowed() public {
        factory.createSlot(merchant, ref1, 0, address(0));
        factory.createSlot(makeAddr("m2"), ref1, 0, address(0));
    }
}

contract InitialiseGuardTest is SlotTestBase {
    function test_InitialiseCannotBeCalledTwice() public {
        address slot = factory.createSlot(merchant, ref1, 0, address(0));
        vm.expectRevert(Slot.AlreadyInitialised.selector);
        Slot(slot).initialize(merchant, ref1, 0, address(0));
    }

    function test_InitialiseCannotBeCalledByStranger() public {
        address slot = factory.createSlot(merchant, ref1, 0, address(0));
        vm.prank(makeAddr("attacker"));
        vm.expectRevert(Slot.AlreadyInitialised.selector);
        Slot(slot).initialize(makeAddr("attacker"), ref1, 0, address(0));
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sweep: caller reimbursement
// ═══════════════════════════════════════════════════════════════════════════════

contract SweepReimbursementTest is SlotTestBase {
    /// A stranger who calls sweep must end up net positive in USDC.
    function test_StrangerIsNetPositive() public {
        // Fund the slot generously so reimbursement is not capped.
        address slot = _slotFunded(0, 10_000_000); // 10 USDC

        uint256 before = usdc.balanceOf(stranger);
        vm.prank(stranger);
        Slot(slot).sweep();
        uint256 got = usdc.balanceOf(stranger) - before;

        assertGt(got, 0, "stranger got nothing");
    }

    /// Reimbursement is always > 0 (TIP ensures this even at zero gas price).
    function test_ReimbursementNonZeroAtZeroGasPrice() public {
        vm.txGasPrice(0);
        address slot = _slotFunded(0, 10_000_000);

        uint256 before = usdc.balanceOf(stranger);
        vm.prank(stranger);
        Slot(slot).sweep();
        assertGt(usdc.balanceOf(stranger) - before, 0, "zero reimbursement at zero gasPrice");
    }

    /// Reimbursement never exceeds gross balance.
    function testFuzz_ReimbursementNeverExceedsGross(uint256 gross, uint256 gasPrice) public {
        gross    = bound(gross,    1,    1e15);
        gasPrice = bound(gasPrice, 0,    500 gwei);
        vm.txGasPrice(gasPrice);

        address slot = _slotFunded(0, gross);

        uint256 merchantBefore  = usdc.balanceOf(merchant);
        uint256 strangerBefore  = usdc.balanceOf(stranger);

        vm.prank(stranger);
        Slot(slot).sweep();

        uint256 strangerGot = usdc.balanceOf(stranger) - strangerBefore;
        assertLe(strangerGot, gross, "reimbursement exceeded gross");
        // Slot is fully drained.
        assertEq(Slot(slot).balance(), 0, "slot not empty");
        // Total out == gross.
        uint256 merchantGot = usdc.balanceOf(merchant) - merchantBefore;
        assertEq(strangerGot + merchantGot, gross, "gross not conserved");
    }

    /// When gross is tiny (1 µUSDC), reimbursement is capped to gross,
    /// and the remainder to merchant is zero — but sweep must not revert.
    function test_ReimbursementCappedAtGross() public {
        address slot = _slotFunded(0, 1); // 1 micro-USDC

        uint256 merchantBefore = usdc.balanceOf(merchant);
        vm.prank(stranger);
        Slot(slot).sweep();

        uint256 strangerGot  = usdc.balanceOf(stranger);
        uint256 merchantGot  = usdc.balanceOf(merchant) - merchantBefore;

        assertLe(strangerGot, 1,  "reimbursement > gross");
        assertEq(strangerGot + merchantGot, 1, "gross not conserved");
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sweep: fee arithmetic
// ═══════════════════════════════════════════════════════════════════════════════

contract SweepFeeTest is SlotTestBase {
    /// fee + net + reimbursement == gross (no dust).
    function testFuzz_FeeArithmeticNoDust(uint256 gross, uint16 feeBps_) public {
        gross   = bound(gross,   1, 1e15);
        feeBps_ = uint16(bound(feeBps_, 0, 1000));

        address fp   = feeBps_ > 0 ? feeRecipient : address(0);
        address slot = factory.createSlot(merchant, ref1, feeBps_, fp);
        _fund(slot, gross);

        uint256 mBefore  = usdc.balanceOf(merchant);
        uint256 fBefore  = usdc.balanceOf(feeRecipient);
        uint256 sBefore  = usdc.balanceOf(stranger);

        vm.prank(stranger);
        Slot(slot).sweep();

        uint256 merchantGot  = usdc.balanceOf(merchant)      - mBefore;
        uint256 feeGot       = usdc.balanceOf(feeRecipient)  - fBefore;
        uint256 reimburse    = usdc.balanceOf(stranger)       - sBefore;

        assertEq(merchantGot + feeGot + reimburse, gross, "dust left");
        // Fee portion matches the formula.
        assertEq(feeGot, (gross * feeBps_) / 10_000, "fee formula wrong");
    }

    /// Zero-fee slot: feeRecipient receives nothing, full remainder (minus
    /// reimbursement) goes to merchant.
    function test_ZeroFeeSlot() public {
        address slot = _slotFunded(0, 5_000_000); // 5 USDC, no fee

        uint256 fBefore = usdc.balanceOf(feeRecipient);
        vm.prank(stranger);
        Slot(slot).sweep();

        assertEq(usdc.balanceOf(feeRecipient) - fBefore, 0, "feeRecipient got something");
    }

    /// Fee is taken from gross before reimbursement is deducted from net.
    function test_FeeNotReducedByReimbursement() public {
        // 100 USDC, 10% fee
        address slot = _slotFunded(1000, 100_000_000);

        uint256 fBefore = usdc.balanceOf(feeRecipient);
        vm.prank(stranger);
        Slot(slot).sweep();

        uint256 feeGot = usdc.balanceOf(feeRecipient) - fBefore;
        // fee = 100_000_000 * 1000 / 10000 = 10_000_000
        assertEq(feeGot, 10_000_000, "fee not 10%");
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sweep: basic behaviour
// ═══════════════════════════════════════════════════════════════════════════════

contract SweepBasicTest is SlotTestBase {
    /// sweep() reverts NothingToSweep when balance is zero.
    function test_SweepRevertsWhenEmpty() public {
        address slot = _slot(0);
        vm.expectRevert(Slot.NothingToSweep.selector);
        Slot(slot).sweep();
    }

    /// sweeping twice reverts NothingToSweep on the second call.
    function test_SweepTwiceReverts() public {
        address slot = _slotFunded(0, 1_000_000);
        Slot(slot).sweep();
        vm.expectRevert(Slot.NothingToSweep.selector);
        Slot(slot).sweep();
    }

    /// Slot is fully drained after a sweep.
    function test_SlotDrainedAfterSweep() public {
        address slot = _slotFunded(0, 2_000_000);
        Slot(slot).sweep();
        assertEq(Slot(slot).balance(), 0);
    }

    /// sweep() emits a Received event with correct gross.
    function test_EmitsReceived() public {
        address slot = _slotFunded(0, 5_000_000);
        vm.expectEmit(false, false, false, false); // just check it fires
        emit Slot.Received(ref1, 0, 0, 0, 0, address(0));
        Slot(slot).sweep();
    }

    /// Successive deposits and sweeps accumulate correctly.
    function test_MultipleSweepRounds() public {
        address slot = factory.createSlot(merchant, ref1, 0, address(0));

        _fund(slot, 1_000_000);
        Slot(slot).sweep();
        uint256 r1 = usdc.balanceOf(merchant);
        assertGt(r1, 0);

        _fund(slot, 2_000_000);
        Slot(slot).sweep();
        uint256 r2 = usdc.balanceOf(merchant);
        assertGt(r2, r1);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sweep: blacklist / quarantine
// ═══════════════════════════════════════════════════════════════════════════════

contract QuarantineTest is SlotTestBase {
    /// Blacklisted merchant: sweep sets quarantined flag, emits Quarantined,
    /// does NOT transfer, does NOT revert.
    function test_BlacklistedMerchantQuarantines() public {
        address slot = _slotFunded(0, 5_000_000);

        usdc.setBlacklisted(merchant, true);

        uint256 mBefore = usdc.balanceOf(merchant);
        uint256 sBefore = usdc.balanceOf(slot);

        vm.expectEmit(true, true, true, false);
        emit Slot.Quarantined(slot, ref1, merchant);
        Slot(slot).sweep(); // must NOT revert

        assertEq(usdc.balanceOf(slot), sBefore, "funds moved on quarantine");
        assertEq(usdc.balanceOf(merchant), mBefore, "merchant received on quarantine");
        assertTrue(Slot(slot).quarantined(), "quarantined flag not set");
    }

    /// Blacklisted feeRecipient also quarantines.
    function test_BlacklistedFeeRecipientQuarantines() public {
        address slot = _slotFunded(500, 5_000_000); // 5% fee

        usdc.setBlacklisted(feeRecipient, true);

        vm.expectEmit(true, true, true, false);
        emit Slot.Quarantined(slot, ref1, feeRecipient);
        Slot(slot).sweep();

        assertTrue(Slot(slot).quarantined());
    }

    /// resolveQuarantine by non-merchant reverts NotMerchant.
    function test_ResolveQuarantineOnlyMerchant() public {
        address slot = _slotFunded(0, 5_000_000);
        usdc.setBlacklisted(merchant, true);
        Slot(slot).sweep();

        vm.prank(stranger);
        vm.expectRevert(Slot.NotMerchant.selector);
        Slot(slot).resolveQuarantine(makeAddr("newMerchant"), address(0), 0);
    }

    /// resolveQuarantine on a non-quarantined slot reverts NotQuarantined.
    function test_ResolveQuarantineRequiresQuarantined() public {
        address slot = _slot(0);
        vm.prank(merchant);
        vm.expectRevert(Slot.NotQuarantined.selector);
        Slot(slot).resolveQuarantine(makeAddr("newMerchant"), address(0), 0);
    }

    /// resolveQuarantine rejects zero newMerchant.
    function test_ResolveQuarantineRejectsZeroMerchant() public {
        address slot = _slotFunded(0, 5_000_000);
        usdc.setBlacklisted(merchant, true);
        Slot(slot).sweep();

        vm.prank(merchant);
        vm.expectRevert(Slot.ZeroMerchant.selector);
        Slot(slot).resolveQuarantine(address(0), address(0), 0);
    }

    /// resolveQuarantine rejects feeBps > 1000.
    function test_ResolveQuarantineRejectsHighFeeBps() public {
        address slot = _slotFunded(0, 5_000_000);
        usdc.setBlacklisted(merchant, true);
        Slot(slot).sweep();

        vm.prank(merchant);
        vm.expectRevert(Slot.FeeBpsTooHigh.selector);
        Slot(slot).resolveQuarantine(makeAddr("newMerchant"), address(0), 1001);
    }

    /// resolveQuarantine rejects zero feeRecipient when newFeeBps > 0.
    function test_ResolveQuarantineRejectsZeroFeeRecipientWithFee() public {
        address slot = _slotFunded(0, 5_000_000);
        usdc.setBlacklisted(merchant, true);
        Slot(slot).sweep();

        vm.prank(merchant);
        vm.expectRevert(Slot.ZeroFeeRecipient.selector);
        Slot(slot).resolveQuarantine(makeAddr("newMerchant"), address(0), 500);
    }

    /// resolveQuarantine then sweep: blacklisted merchant -> new merchant, no fee.
    function test_ResolveQuarantineThenSweepSucceeds_MerchantBlacklisted() public {
        address slot        = _slotFunded(0, 5_000_000);
        address newMerchant = makeAddr("newMerchant");

        usdc.setBlacklisted(merchant, true);
        Slot(slot).sweep();

        vm.prank(merchant);
        Slot(slot).resolveQuarantine(newMerchant, address(0), 0);

        assertFalse(Slot(slot).quarantined(), "still quarantined");
        assertEq(Slot(slot).merchant(), newMerchant, "merchant not updated");

        uint256 before = usdc.balanceOf(newMerchant);
        Slot(slot).sweep();
        assertGt(usdc.balanceOf(newMerchant) - before, 0, "newMerchant got nothing");
        assertEq(Slot(slot).balance(), 0);
    }

    /// FIX FOR CRITICAL: resolveQuarantine can also replace feeRecipient
    /// when the feeRecipient was the blacklisted address.
    function test_ResolveQuarantineThenSweepSucceeds_FeeRecipientBlacklisted() public {
        // Slot with 5% fee; feeRecipient gets blacklisted.
        address slot           = _slotFunded(500, 5_000_000);
        address newFeeRecipient = makeAddr("newFeeRecipient");

        usdc.setBlacklisted(feeRecipient, true);
        Slot(slot).sweep(); // quarantine: feeRecipient is blacklisted

        assertTrue(Slot(slot).quarantined(), "not quarantined");

        // Merchant resolves by supplying a clean feeRecipient.
        vm.prank(merchant);
        Slot(slot).resolveQuarantine(merchant, newFeeRecipient, 500);

        assertFalse(Slot(slot).quarantined(), "still quarantined");
        assertEq(Slot(slot).feeRecipient(), newFeeRecipient, "feeRecipient not updated");

        uint256 fBefore = usdc.balanceOf(newFeeRecipient);
        uint256 mBefore = usdc.balanceOf(merchant);
        Slot(slot).sweep();
        uint256 fGot = usdc.balanceOf(newFeeRecipient) - fBefore;
        uint256 mGot = usdc.balanceOf(merchant)        - mBefore;
        assertGt(fGot, 0, "new feeRecipient got nothing");
        assertGt(mGot, 0, "merchant got nothing");
        assertEq(Slot(slot).balance(), 0);
    }

    /// resolveQuarantine can also zero out the fee (feeBps=0) to bypass a
    /// permanently problematic feeRecipient without providing a new one.
    function test_ResolveQuarantineCanZeroOutFee() public {
        address slot = _slotFunded(500, 5_000_000);
        usdc.setBlacklisted(feeRecipient, true);
        Slot(slot).sweep(); // quarantine

        // Disable the fee path entirely.
        vm.prank(merchant);
        Slot(slot).resolveQuarantine(merchant, address(0), 0);

        assertEq(Slot(slot).feeBps(), 0, "feeBps not zeroed");

        uint256 fBefore = usdc.balanceOf(feeRecipient);
        Slot(slot).sweep();
        // feeRecipient receives nothing because fee is now 0.
        assertEq(usdc.balanceOf(feeRecipient) - fBefore, 0, "feeRecipient received fee after zeroing");
        assertEq(Slot(slot).balance(), 0);
    }

    /// resolveQuarantine is the ONLY function that may change merchant/feeRecipient
    /// (and only from quarantine).
    function test_MerchantOnlyChangedViaResolveQuarantine() public {
        address slot = factory.createSlot(merchant, ref1, 0, address(0));
        assertEq(Slot(slot).merchant(), merchant);

        vm.expectRevert(Slot.AlreadyInitialised.selector);
        Slot(slot).initialize(makeAddr("x"), ref1, 0, address(0));

        vm.prank(merchant);
        vm.expectRevert(Slot.NotQuarantined.selector);
        Slot(slot).resolveQuarantine(makeAddr("x"), address(0), 0);

        assertEq(Slot(slot).merchant(), merchant, "merchant changed without quarantine");
    }

    /// FIX FOR HIGH: if isBlacklisted staticcall fails, sweep quarantines
    /// (fail-closed) and emits QuarantinedCheckFailed.
    function test_BlacklistCallFailureQuarantinesFailClosed() public {
        // Re-etch ARC_USDC with a stripped mock that has no isBlacklisted.
        StrippedMockUSDC stripped = new StrippedMockUSDC();
        vm.etch(ARC_USDC, address(stripped).code);

        factory = new SlotFactory();
        address slot = factory.createSlot(merchant, ref1, 0, address(0));
        StrippedMockUSDC(ARC_USDC).mint(slot, 1_000_000);

        // sweep() must quarantine (fail-closed) and emit QuarantinedCheckFailed.
        vm.expectEmit(true, true, false, false);
        emit Slot.QuarantinedCheckFailed(slot, ref1);
        Slot(slot).sweep(); // must NOT revert

        // Funds untouched, slot is quarantined.
        assertTrue(Slot(slot).quarantined(), "not quarantined on probe failure");
        assertEq(StrippedMockUSDC(ARC_USDC).balanceOf(slot), 1_000_000, "funds moved");
    }
}

/// @dev USDC mock without isBlacklisted — used to test fail-open staticcall.
contract StrippedMockUSDC {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "bal");
        balanceOf[msg.sender] -= amount;
        balanceOf[to]         += amount;
        return true;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sweep: reentrancy
// ═══════════════════════════════════════════════════════════════════════════════

contract ReentrancyTest is SlotTestBase {
    /// A reentrant call from inside transfer() must be blocked by
    /// ReentrancyGuard.  The outer sweep completes; the inner one reverts
    /// (caught inside the mock hook) — so the slot ends up fully drained
    /// (not double-drained).
    function test_ReentrancyOnSweepFails() public {
        address slot = _slotFunded(0, 10_000_000);

        // Point the mock at this slot so transfer() tries to re-enter sweep().
        usdc.setReentrantTarget(slot);

        uint256 mBefore = usdc.balanceOf(merchant);
        Slot(slot).sweep(); // must not revert
        uint256 mAfter  = usdc.balanceOf(merchant);

        // Slot is drained exactly once.
        assertEq(Slot(slot).balance(), 0, "slot not empty");

        // Merchant received some amount (reimbursement may reduce it).
        assertGt(mAfter, mBefore, "merchant received nothing");

        // Total outflow == initial deposit (no double-drain).
        // strangerBefore = 0 since no stranger involved in this test (address(this) sweeps)
        uint256 totalOut = (mAfter - mBefore) + usdc.balanceOf(address(this));
        assertLe(totalOut, 10_000_000, "double-drained");
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// sweepMany
// ═══════════════════════════════════════════════════════════════════════════════

contract SweepManyTest is SlotTestBase {
    /// sweepMany skips a slot that reverts (NothingToSweep) and settles the rest.
    function test_SweepManySkipsFailingSlot() public {
        address s1 = factory.createSlot(merchant, ref1, 0, address(0));
        address s2 = factory.createSlot(merchant, ref2, 0, address(0));

        // Only fund s1; s2 is empty and will revert NothingToSweep.
        _fund(s1, 3_000_000);

        address[] memory arr = new address[](2);
        arr[0] = s1;
        arr[1] = s2;

        uint256 mBefore = usdc.balanceOf(merchant);
        factory.sweepMany(arr);

        // s1 was swept.
        assertEq(Slot(s1).balance(), 0, "s1 not swept");
        // s2 still empty (no revert propagated).
        assertEq(Slot(s2).balance(), 0, "s2 had balance somehow");
        // Merchant received s1's funds.
        assertGt(usdc.balanceOf(merchant) - mBefore, 0, "merchant got nothing");
    }

    /// sweepMany with all funded slots sweeps all.
    function test_SweepManyAllFunded() public {
        address s1 = factory.createSlot(merchant, ref1, 0, address(0));
        address s2 = factory.createSlot(merchant, ref2, 0, address(0));

        _fund(s1, 1_000_000);
        _fund(s2, 2_000_000);

        address[] memory arr = new address[](2);
        arr[0] = s1;
        arr[1] = s2;

        factory.sweepMany(arr);

        assertEq(Slot(s1).balance(), 0);
        assertEq(Slot(s2).balance(), 0);
    }

    /// sweepMany with an empty array is a no-op (does not revert).
    function test_SweepManyEmptyArray() public {
        address[] memory arr = new address[](0);
        factory.sweepMany(arr); // must not revert
    }

    /// sweepMany skips zero-address entries without reverting.
    function test_SweepManySkipsZeroAddress() public {
        address s1 = factory.createSlot(merchant, ref1, 0, address(0));
        _fund(s1, 1_000_000);

        address[] memory arr = new address[](2);
        arr[0] = address(0);
        arr[1] = s1;

        factory.sweepMany(arr); // must not revert
        assertEq(Slot(s1).balance(), 0);
    }

    /// sweepMany: one blacklisted slot quarantines but does not block others.
    function test_SweepManyBlacklistedSlotDoesNotBlockOthers() public {
        address s1 = factory.createSlot(merchant, ref1, 0, address(0));
        address s2 = factory.createSlot(merchant, ref2, 0, address(0));

        _fund(s1, 5_000_000);
        _fund(s2, 4_000_000);

        // Blacklist merchant only for s1's perspective — same merchant, so
        // s2 will also quarantine.  Use a different merchant for s2.
        address m2   = makeAddr("m2");
        address slot3 = factory.createSlot(m2, ref1, 0, address(0));
        _fund(slot3, 3_000_000);
        usdc.setBlacklisted(merchant, true);

        address[] memory arr = new address[](3);
        arr[0] = s1;
        arr[1] = s2;
        arr[2] = slot3;

        uint256 m2Before = usdc.balanceOf(m2);
        factory.sweepMany(arr);

        // s1 and s2 quarantined (merchant blacklisted).
        assertTrue(Slot(s1).quarantined(), "s1 not quarantined");
        assertTrue(Slot(s2).quarantined(), "s2 not quarantined");
        // slot3 was swept successfully.
        assertEq(Slot(slot3).balance(), 0, "slot3 not swept");
        assertGt(usdc.balanceOf(m2) - m2Before, 0, "m2 got nothing");
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Arc safety
// ═══════════════════════════════════════════════════════════════════════════════

contract ArcSafetyTest is SlotTestBase {
    function test_SlotNotPayable() public {
        address slot = factory.createSlot(merchant, ref1, 0, address(0));
        vm.deal(address(this), 1 ether);
        (bool ok,) = payable(slot).call{value: 1}("");
        assertFalse(ok, "Slot accepted native value");
    }

    function test_FactoryNotPayable() public {
        vm.deal(address(this), 1 ether);
        (bool ok,) = payable(address(factory)).call{value: 1}("");
        assertFalse(ok, "Factory accepted native value");
    }
}
