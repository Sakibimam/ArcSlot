// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test}         from "forge-std/Test.sol";
import {VmSafe}       from "forge-std/Vm.sol";
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

    // Match the constructor args used in the real deployment:
    //   arc-forge create SlotFactory ... --constructor-args <IMPL> 0x3600... 2000 100000
    uint256 internal constant TIP       = 2_000;    // 0.002 USDC
    uint256 internal constant MIN_SWEEP = 100_000;  // 0.1 USDC
    uint256 internal constant MAX_R     = 50_000;   // 0.05 USDC default per-slot cap

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
        // After etch we interact through the etched address;
        // storage lives at ARC_USDC, not at the original MockUSDC address.
        usdc = MockUSDC(ARC_USDC);

        // Deploy implementation, then factory with configurable params.
        Slot impl = new Slot();
        factory   = new SlotFactory(address(impl), ARC_USDC, TIP, MIN_SWEEP);
    }

    function _fund(address to, uint256 amount) internal {
        usdc.mint(to, amount);
    }

    // Convenience: deploy a slot. Funds are added separately.
    function _slot(uint16 feeBps_) internal returns (address) {
        address fp = feeBps_ > 0 ? feeRecipient : address(0);
        return factory.createSlot(merchant, ref1, feeBps_, fp, MAX_R);
    }

    // Convenience: deploy and fund a slot above the MIN_SWEEP threshold.
    function _slotFunded(uint16 feeBps_, uint256 amount) internal returns (address) {
        address s = _slot(feeBps_);
        _fund(s, amount);
        return s;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Predict / createSlot
// ═══════════════════════════════════════════════════════════════════════════════

contract PredictTest is SlotTestBase {
    function test_PredictMatchesDeployed() public {
        address predicted = factory.predict(merchant, ref1);
        address deployed  = factory.createSlot(merchant, ref1, 100, feeRecipient, MAX_R);
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
        factory.createSlot(address(0), ref1, 0, address(0), MAX_R);
    }

    function test_RevertFeeBpsTooHigh() public {
        vm.expectRevert(SlotFactory.FeeBpsTooHigh.selector);
        factory.createSlot(merchant, ref1, 1001, feeRecipient, MAX_R);
    }

    function test_RevertZeroFeeRecipientWhenFeeNonZero() public {
        vm.expectRevert(SlotFactory.ZeroFeeRecipient.selector);
        factory.createSlot(merchant, ref1, 100, address(0), MAX_R);
    }

    function test_RevertDuplicateReference() public {
        factory.createSlot(merchant, ref1, 0, address(0), MAX_R);
        vm.expectRevert(SlotFactory.ReferenceAlreadyUsed.selector);
        factory.createSlot(merchant, ref1, 0, address(0), MAX_R);
    }

    function test_SameRefDifferentMerchantIsAllowed() public {
        factory.createSlot(merchant, ref1, 0, address(0), MAX_R);
        factory.createSlot(makeAddr("m2"), ref1, 0, address(0), MAX_R);
    }
}

contract InitialiseGuardTest is SlotTestBase {
    function test_InitialiseCannotBeCalledTwice() public {
        address slot = factory.createSlot(merchant, ref1, 0, address(0), MAX_R);
        vm.expectRevert(Slot.AlreadyInitialised.selector);
        Slot(slot).initialize(ARC_USDC, TIP, MIN_SWEEP, MAX_R, merchant, ref1, 0, address(0));
    }

    function test_InitialiseCannotBeCalledByStranger() public {
        address slot = factory.createSlot(merchant, ref1, 0, address(0), MAX_R);
        vm.prank(makeAddr("attacker"));
        vm.expectRevert(Slot.AlreadyInitialised.selector);
        Slot(slot).initialize(ARC_USDC, TIP, MIN_SWEEP, MAX_R, makeAddr("attacker"), ref1, 0, address(0));
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sweep: caller reimbursement
// ═══════════════════════════════════════════════════════════════════════════════

contract SweepReimbursementTest is SlotTestBase {
    /// A stranger who calls sweep must end up net positive in USDC.
    function test_StrangerIsNetPositive() public {
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

    /// Reimbursement never exceeds gross or the per-slot cap. When the base
    /// fee is too high the sweep must revert GasTooHigh and leave the slot untouched.
    function testFuzz_ReimbursementNeverExceedsGross(uint256 gross, uint256 gasPrice) public {
        // gross must be >= MIN_SWEEP so sweep() does not revert BelowMinSweep
        gross    = bound(gross,    MIN_SWEEP, 1e15);
        gasPrice = bound(gasPrice, 0,         500 gwei);
        vm.fee(gasPrice);
        vm.txGasPrice(gasPrice);

        address slot = _slotFunded(0, gross);

        uint256 merchantBefore = usdc.balanceOf(merchant);
        uint256 strangerBefore = usdc.balanceOf(stranger);

        vm.prank(stranger);
        (bool ok, bytes memory ret) = slot.call(abi.encodeCall(Slot.sweep, ()));

        if (!ok) {
            assertEq(bytes4(ret), Slot.GasTooHigh.selector, "unexpected revert");
            assertEq(Slot(slot).balance(), gross, "slot touched on GasTooHigh");
            return;
        }

        uint256 strangerGot = usdc.balanceOf(stranger) - strangerBefore;
        assertLe(strangerGot, gross, "reimbursement exceeded gross");
        assertLe(strangerGot, MAX_R, "reimbursement exceeded cap");
        assertEq(Slot(slot).balance(), 0, "slot not empty");
        uint256 merchantGot = usdc.balanceOf(merchant) - merchantBefore;
        assertEq(strangerGot + merchantGot, gross, "gross not conserved");
    }

    /// When gross == MIN_SWEEP (minimum valid balance), sweep must not revert.
    function test_ReimbursementCappedAtGross() public {
        address slot = _slotFunded(0, MIN_SWEEP);

        uint256 merchantBefore = usdc.balanceOf(merchant);
        vm.prank(stranger);
        Slot(slot).sweep();

        uint256 strangerGot = usdc.balanceOf(stranger);
        uint256 merchantGot = usdc.balanceOf(merchant) - merchantBefore;

        assertLe(strangerGot, MIN_SWEEP, "reimbursement > gross");
        assertEq(strangerGot + merchantGot, MIN_SWEEP, "gross not conserved");
    }

    /// Balance below MIN_SWEEP reverts BelowMinSweep (not NothingToSweep).
    function test_BelowMinSweepReverts() public {
        address slot = _slot(0);
        _fund(slot, MIN_SWEEP - 1);
        vm.expectRevert(Slot.BelowMinSweep.selector);
        Slot(slot).sweep();
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sweep: fee arithmetic
// ═══════════════════════════════════════════════════════════════════════════════

contract SweepFeeTest is SlotTestBase {
    /// fee + net + reimbursement == gross (no dust).
    function testFuzz_FeeArithmeticNoDust(uint256 gross, uint16 feeBps_) public {
        gross   = bound(gross,   MIN_SWEEP, 1e15);
        feeBps_ = uint16(bound(feeBps_, 0, 1000));

        address fp   = feeBps_ > 0 ? feeRecipient : address(0);
        address slot = factory.createSlot(merchant, ref1, feeBps_, fp, MAX_R);
        _fund(slot, gross);

        uint256 mBefore = usdc.balanceOf(merchant);
        uint256 fBefore = usdc.balanceOf(feeRecipient);
        uint256 sBefore = usdc.balanceOf(stranger);

        vm.prank(stranger);
        Slot(slot).sweep();

        uint256 merchantGot = usdc.balanceOf(merchant)     - mBefore;
        uint256 feeGot      = usdc.balanceOf(feeRecipient) - fBefore;
        uint256 reimburse   = usdc.balanceOf(stranger)     - sBefore;

        assertEq(merchantGot + feeGot + reimburse, gross, "dust left");
        assertEq(feeGot, (gross * feeBps_) / 10_000, "fee formula wrong");
    }

    /// Zero-fee slot: feeRecipient receives nothing.
    function test_ZeroFeeSlot() public {
        address slot = _slotFunded(0, 5_000_000);

        uint256 fBefore = usdc.balanceOf(feeRecipient);
        vm.prank(stranger);
        Slot(slot).sweep();

        assertEq(usdc.balanceOf(feeRecipient) - fBefore, 0, "feeRecipient got something");
    }

    /// Fee is taken from gross before reimbursement is deducted from net.
    function test_FeeNotReducedByReimbursement() public {
        address slot = _slotFunded(1000, 100_000_000); // 100 USDC, 10% fee

        uint256 fBefore = usdc.balanceOf(feeRecipient);
        vm.prank(stranger);
        Slot(slot).sweep();

        uint256 feeGot = usdc.balanceOf(feeRecipient) - fBefore;
        assertEq(feeGot, 10_000_000, "fee not 10%");
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sweep: basic behaviour
// ═══════════════════════════════════════════════════════════════════════════════

contract SweepBasicTest is SlotTestBase {
    function test_SweepRevertsWhenEmpty() public {
        address slot = _slot(0);
        vm.expectRevert(Slot.NothingToSweep.selector);
        Slot(slot).sweep();
    }

    function test_SweepTwiceReverts() public {
        address slot = _slotFunded(0, 1_000_000);
        Slot(slot).sweep();
        vm.expectRevert(Slot.NothingToSweep.selector);
        Slot(slot).sweep();
    }

    function test_SlotDrainedAfterSweep() public {
        address slot = _slotFunded(0, 2_000_000);
        Slot(slot).sweep();
        assertEq(Slot(slot).balance(), 0);
    }

    function test_EmitsReceived() public {
        address slot = _slotFunded(0, 5_000_000);
        vm.expectEmit(false, false, false, false);
        emit Slot.Received(ref1, 0, 0, 0, 0, address(0));
        Slot(slot).sweep();
    }

    function test_MultipleSweepRounds() public {
        address slot = factory.createSlot(merchant, ref1, 0, address(0), MAX_R);

        _fund(slot, 1_000_000);
        Slot(slot).sweep();
        uint256 r1 = usdc.balanceOf(merchant);
        assertGt(r1, 0);

        _fund(slot, 2_000_000);
        Slot(slot).sweep();
        uint256 r2 = usdc.balanceOf(merchant);
        assertGt(r2, r1);
    }

    /// Factory immutables are forwarded correctly to every clone.
    function test_CloneInheritsFactoryConfig() public {
        address slot = factory.createSlot(merchant, ref1, 0, address(0), MAX_R);
        assertEq(address(Slot(slot).usdc()),     ARC_USDC,  "usdc mismatch");
        assertEq(Slot(slot).tip(),               TIP,       "tip mismatch");
        assertEq(Slot(slot).minSweep(),          MIN_SWEEP, "minSweep mismatch");
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sweep: blacklist / quarantine
// ═══════════════════════════════════════════════════════════════════════════════

contract QuarantineTest is SlotTestBase {
    function test_BlacklistedMerchantQuarantines() public {
        address slot = _slotFunded(0, 5_000_000);

        usdc.setBlacklisted(merchant, true);

        uint256 mBefore = usdc.balanceOf(merchant);
        uint256 sBefore = usdc.balanceOf(slot);

        vm.expectEmit(true, true, true, false);
        emit Slot.Quarantined(slot, ref1, merchant);
        Slot(slot).sweep();

        assertEq(usdc.balanceOf(slot),     sBefore, "funds moved on quarantine");
        assertEq(usdc.balanceOf(merchant), mBefore, "merchant received on quarantine");
        assertTrue(Slot(slot).quarantined(), "quarantined flag not set");
    }

    function test_BlacklistedFeeRecipientQuarantines() public {
        address slot = _slotFunded(500, 5_000_000);

        usdc.setBlacklisted(feeRecipient, true);

        vm.expectEmit(true, true, true, false);
        emit Slot.Quarantined(slot, ref1, feeRecipient);
        Slot(slot).sweep();

        assertTrue(Slot(slot).quarantined());
    }

    function test_ResolveQuarantineOnlyMerchant() public {
        address slot = _slotFunded(0, 5_000_000);
        usdc.setBlacklisted(merchant, true);
        Slot(slot).sweep();

        vm.prank(stranger);
        vm.expectRevert(Slot.NotMerchant.selector);
        Slot(slot).resolveQuarantine(makeAddr("newMerchant"), address(0), 0);
    }

    function test_ResolveQuarantineRequiresQuarantined() public {
        address slot = _slot(0);
        vm.prank(merchant);
        vm.expectRevert(Slot.NotQuarantined.selector);
        Slot(slot).resolveQuarantine(makeAddr("newMerchant"), address(0), 0);
    }

    function test_ResolveQuarantineRejectsZeroMerchant() public {
        address slot = _slotFunded(0, 5_000_000);
        usdc.setBlacklisted(merchant, true);
        Slot(slot).sweep();

        vm.prank(merchant);
        vm.expectRevert(Slot.ZeroMerchant.selector);
        Slot(slot).resolveQuarantine(address(0), address(0), 0);
    }

    function test_ResolveQuarantineRejectsHighFeeBps() public {
        address slot = _slotFunded(0, 5_000_000);
        usdc.setBlacklisted(merchant, true);
        Slot(slot).sweep();

        vm.prank(merchant);
        vm.expectRevert(Slot.FeeBpsTooHigh.selector);
        Slot(slot).resolveQuarantine(makeAddr("newMerchant"), address(0), 1001);
    }

    function test_ResolveQuarantineRejectsZeroFeeRecipientWithFee() public {
        address slot = _slotFunded(0, 5_000_000);
        usdc.setBlacklisted(merchant, true);
        Slot(slot).sweep();

        vm.prank(merchant);
        vm.expectRevert(Slot.ZeroFeeRecipient.selector);
        Slot(slot).resolveQuarantine(makeAddr("newMerchant"), address(0), 500);
    }

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

    /// Critical fix: resolveQuarantine can also replace feeRecipient.
    function test_ResolveQuarantineThenSweepSucceeds_FeeRecipientBlacklisted() public {
        address slot            = _slotFunded(500, 5_000_000);
        address newFeeRecipient = makeAddr("newFeeRecipient");

        usdc.setBlacklisted(feeRecipient, true);
        Slot(slot).sweep();

        assertTrue(Slot(slot).quarantined(), "not quarantined");

        vm.prank(merchant);
        Slot(slot).resolveQuarantine(merchant, newFeeRecipient, 500);

        assertFalse(Slot(slot).quarantined(), "still quarantined");
        assertEq(Slot(slot).feeRecipient(), newFeeRecipient, "feeRecipient not updated");

        uint256 fBefore = usdc.balanceOf(newFeeRecipient);
        uint256 mBefore = usdc.balanceOf(merchant);
        Slot(slot).sweep();
        assertGt(usdc.balanceOf(newFeeRecipient) - fBefore, 0, "new feeRecipient got nothing");
        assertGt(usdc.balanceOf(merchant)        - mBefore, 0, "merchant got nothing");
        assertEq(Slot(slot).balance(), 0);
    }

    /// resolveQuarantine can zero out the fee to bypass a bad feeRecipient.
    function test_ResolveQuarantineCanZeroOutFee() public {
        address slot = _slotFunded(500, 5_000_000);
        usdc.setBlacklisted(feeRecipient, true);
        Slot(slot).sweep();

        vm.prank(merchant);
        Slot(slot).resolveQuarantine(merchant, address(0), 0);

        assertEq(Slot(slot).feeBps(), 0, "feeBps not zeroed");

        uint256 fBefore = usdc.balanceOf(feeRecipient);
        Slot(slot).sweep();
        assertEq(usdc.balanceOf(feeRecipient) - fBefore, 0, "feeRecipient received fee after zeroing");
        assertEq(Slot(slot).balance(), 0);
    }

    /// resolveQuarantine is the ONLY path to change merchant/feeRecipient.
    function test_MerchantOnlyChangedViaResolveQuarantine() public {
        address slot = factory.createSlot(merchant, ref1, 0, address(0), MAX_R);
        assertEq(Slot(slot).merchant(), merchant);

        vm.expectRevert(Slot.AlreadyInitialised.selector);
        Slot(slot).initialize(ARC_USDC, TIP, MIN_SWEEP, MAX_R, makeAddr("x"), ref1, 0, address(0));

        vm.prank(merchant);
        vm.expectRevert(Slot.NotQuarantined.selector);
        Slot(slot).resolveQuarantine(makeAddr("x"), address(0), 0);

        assertEq(Slot(slot).merchant(), merchant, "merchant changed without quarantine");
    }

    /// High fix: if isBlacklisted staticcall fails, sweep quarantines fail-closed.
    function test_BlacklistCallFailureQuarantinesFailClosed() public {
        StrippedMockUSDC stripped = new StrippedMockUSDC();
        vm.etch(ARC_USDC, address(stripped).code);

        Slot  impl2    = new Slot();
        SlotFactory f2 = new SlotFactory(address(impl2), ARC_USDC, TIP, MIN_SWEEP);
        address slot   = f2.createSlot(merchant, ref1, 0, address(0), MAX_R);
        StrippedMockUSDC(ARC_USDC).mint(slot, 1_000_000);

        vm.expectEmit(true, true, false, false);
        emit Slot.QuarantinedCheckFailed(slot, ref1);
        Slot(slot).sweep();

        assertTrue(Slot(slot).quarantined(), "not quarantined on probe failure");
        assertEq(StrippedMockUSDC(ARC_USDC).balanceOf(slot), 1_000_000, "funds moved");
    }
}

/// @dev USDC mock without isBlacklisted -- used to test fail-closed staticcall.
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
    function test_ReentrancyOnSweepFails() public {
        address slot = _slotFunded(0, 10_000_000);

        usdc.setReentrantTarget(slot);

        uint256 mBefore = usdc.balanceOf(merchant);
        Slot(slot).sweep();
        uint256 mAfter  = usdc.balanceOf(merchant);

        assertEq(Slot(slot).balance(), 0, "slot not empty");
        assertGt(mAfter, mBefore, "merchant received nothing");

        uint256 totalOut = (mAfter - mBefore) + usdc.balanceOf(address(this));
        assertLe(totalOut, 10_000_000, "double-drained");
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// sweepMany
// ═══════════════════════════════════════════════════════════════════════════════

contract SweepManyTest is SlotTestBase {
    function test_SweepManySkipsFailingSlot() public {
        address s1 = factory.createSlot(merchant, ref1, 0, address(0), MAX_R);
        address s2 = factory.createSlot(merchant, ref2, 0, address(0), MAX_R);

        _fund(s1, 3_000_000);
        // s2 empty -- will revert NothingToSweep, which sweepMany swallows.

        address[] memory arr = new address[](2);
        arr[0] = s1;
        arr[1] = s2;

        uint256 mBefore = usdc.balanceOf(merchant);
        factory.sweepMany(arr);

        assertEq(Slot(s1).balance(), 0, "s1 not swept");
        assertEq(Slot(s2).balance(), 0, "s2 had balance somehow");
        assertGt(usdc.balanceOf(merchant) - mBefore, 0, "merchant got nothing");
    }

    function test_SweepManyAllFunded() public {
        address s1 = factory.createSlot(merchant, ref1, 0, address(0), MAX_R);
        address s2 = factory.createSlot(merchant, ref2, 0, address(0), MAX_R);

        _fund(s1, 1_000_000);
        _fund(s2, 2_000_000);

        address[] memory arr = new address[](2);
        arr[0] = s1;
        arr[1] = s2;

        factory.sweepMany(arr);

        assertEq(Slot(s1).balance(), 0);
        assertEq(Slot(s2).balance(), 0);
    }

    function test_SweepManyEmptyArray() public {
        address[] memory arr = new address[](0);
        factory.sweepMany(arr);
    }

    function test_SweepManySkipsZeroAddress() public {
        address s1 = factory.createSlot(merchant, ref1, 0, address(0), MAX_R);
        _fund(s1, 1_000_000);

        address[] memory arr = new address[](2);
        arr[0] = address(0);
        arr[1] = s1;

        factory.sweepMany(arr);
        assertEq(Slot(s1).balance(), 0);
    }

    function test_SweepManyBelowMinSweepSlotDoesNotBlockOthers() public {
        address s1 = factory.createSlot(merchant, ref1, 0, address(0), MAX_R);
        address s2 = factory.createSlot(merchant, ref2, 0, address(0), MAX_R);

        // s1 below MIN_SWEEP -- will revert BelowMinSweep
        _fund(s1, MIN_SWEEP - 1);
        _fund(s2, 4_000_000);

        address[] memory arr = new address[](2);
        arr[0] = s1;
        arr[1] = s2;

        uint256 mBefore = usdc.balanceOf(merchant);
        factory.sweepMany(arr);

        // s2 swept, s1 still holds its dust.
        assertEq(Slot(s2).balance(), 0, "s2 not swept");
        assertGt(Slot(s1).balance(), 0, "s1 unexpectedly swept");
        assertGt(usdc.balanceOf(merchant) - mBefore, 0, "merchant got nothing");
    }

    function test_SweepManyBlacklistedSlotDoesNotBlockOthers() public {
        address s1    = factory.createSlot(merchant, ref1, 0, address(0), MAX_R);
        address m2    = makeAddr("m2");
        address slot3 = factory.createSlot(m2, ref1, 0, address(0), MAX_R);

        _fund(s1,    5_000_000);
        _fund(slot3, 3_000_000);

        usdc.setBlacklisted(merchant, true);

        address[] memory arr = new address[](2);
        arr[0] = s1;
        arr[1] = slot3;

        uint256 m2Before = usdc.balanceOf(m2);
        factory.sweepMany(arr);

        assertTrue(Slot(s1).quarantined(), "s1 not quarantined");
        assertEq(Slot(slot3).balance(), 0, "slot3 not swept");
        assertGt(usdc.balanceOf(m2) - m2Before, 0, "m2 got nothing");
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Arc safety
// ═══════════════════════════════════════════════════════════════════════════════

contract ArcSafetyTest is SlotTestBase {
    function test_SlotNotPayable() public {
        address slot = factory.createSlot(merchant, ref1, 0, address(0), MAX_R);
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

// ═══════════════════════════════════════════════════════════════════════════════
// Sweep: per-slot reimbursement cap (production constants)
//
//   TIP = 2_000 (0.002 USDC), MIN_SWEEP = 100_000 (0.10 USDC),
//   maxReimbursement default = 50_000 (0.05 USDC).
//   Arc gas floor ~20 gwei, ceiling ~20_000 gwei (1000x swing).
// ═══════════════════════════════════════════════════════════════════════════════

contract ReimbursementCapTest is SlotTestBase {
    uint256 internal constant PROD_TIP       = 2_000;
    uint256 internal constant PROD_MIN_SWEEP = 100_000;

    function setUp() public override {
        super.setUp();
        Slot impl = new Slot();
        factory = new SlotFactory(address(impl), ARC_USDC, PROD_TIP, PROD_MIN_SWEEP);
    }

    function _sweepAs(address who, address slot) internal returns (uint256 got, uint256 gasCost6) {
        uint256 before = usdc.balanceOf(who);
        uint256 g0 = gasleft();
        vm.prank(who);
        Slot(slot).sweep();
        gasCost6 = ((g0 - gasleft() + 21_000) * tx.gasprice) / 1e12;
        got = usdc.balanceOf(who) - before;
    }

    /// At Arc's floor (20 gwei + 1 gwei tip) the sweeper earns more than the gas they burn.
    function test_SweeperNetPositiveAt21Gwei() public {
        vm.fee(20 gwei);
        vm.txGasPrice(21 gwei);
        address slot = _slotFunded(0, 1_000_000); // 1 USDC

        (uint256 got, uint256 gasCost6) = _sweepAs(stranger, slot);

        assertGt(got, gasCost6, "sweeper not net positive at 21 gwei");
        assertGe(got, PROD_TIP, "tip not paid");
        assertLe(got, MAX_R, "reimbursement exceeded cap");
    }

    /// At Arc's ceiling (20_000 gwei) a stranger sweep reverts instead of draining the payment.
    function test_SweepRevertsGasTooHighAtCeiling() public {
        vm.fee(20_000 gwei);
        vm.txGasPrice(20_000 gwei);
        address slot = _slotFunded(0, 100_000); // exactly MIN_SWEEP

        vm.prank(stranger);
        vm.expectRevert(Slot.GasTooHigh.selector);
        Slot(slot).sweep();

        assertEq(Slot(slot).balance(), 100_000, "payment was touched");
    }

    /// reimbursement == gasCost6 + TIP when under the cap, and never more than gross.
    function test_ReimbursementIsGasPlusTip() public {
        vm.fee(20 gwei);
        vm.txGasPrice(21 gwei);
        address slot = _slotFunded(0, 1_000_000);

        vm.recordLogs();
        vm.prank(stranger);
        Slot(slot).sweep();
        VmSafe.Log[] memory logs = vm.getRecordedLogs();

        (uint256 gross, uint256 net, uint256 fee, uint256 reimbursement) =
            abi.decode(logs[logs.length - 1].data, (uint256, uint256, uint256, uint256));
        assertEq(gross, 1_000_000);
        assertEq(fee, 0);
        assertGt(reimbursement, PROD_TIP, "gas component missing");
        assertLe(reimbursement, MAX_R, "over cap");
        assertEq(net + reimbursement, gross, "not conserved");
    }

    /// The merchant can always sweep their own slot, even at ceiling gas:
    /// they pay no reimbursement to themselves, so funds can never be locked.
    function test_MerchantSweepBypassesGasCap() public {
        vm.txGasPrice(20_000 gwei);
        address slot = _slotFunded(0, 1_000_000);

        uint256 before = usdc.balanceOf(merchant);
        vm.prank(merchant);
        Slot(slot).sweep();

        assertEq(usdc.balanceOf(merchant) - before, 1_000_000, "merchant did not get full gross");
        assertEq(Slot(slot).balance(), 0, "slot not drained");
    }

    /// Merchant self-sweep still pays the fee recipient.
    function test_MerchantSweepStillPaysFee() public {
        vm.txGasPrice(20_000 gwei);
        address slot = _slotFunded(500, 1_000_000); // 5% fee

        vm.prank(merchant);
        Slot(slot).sweep();

        assertEq(usdc.balanceOf(feeRecipient), 50_000, "fee not paid");
        assertEq(usdc.balanceOf(merchant), 950_000, "merchant net wrong");
    }

    /// Below MIN_SWEEP (e.g. 0.05 USDC) sweep reverts BelowMinSweep.
    function test_BelowMinSweepReverts() public {
        address slot = _slotFunded(0, 50_000);
        vm.prank(stranger);
        vm.expectRevert(Slot.BelowMinSweep.selector);
        Slot(slot).sweep();
    }

    /// maxReimbursement is stored per slot.
    function test_MaxReimbursementStoredPerSlot() public {
        address s1 = factory.createSlot(merchant, ref1, 0, address(0), 50_000);
        address s2 = factory.createSlot(merchant, ref2, 0, address(0), 20_000);
        assertEq(Slot(s1).maxReimbursement(), 50_000);
        assertEq(Slot(s2).maxReimbursement(), 20_000);
    }

    /// A cap below the tip would make every stranger sweep revert — reject it.
    function test_CreateSlotRevertsMaxReimbursementBelowTip() public {
        vm.expectRevert(SlotFactory.MaxReimbursementBelowTip.selector);
        factory.createSlot(merchant, ref1, 0, address(0), PROD_TIP - 1);
    }

    /// Fuzz over the full Arc gas range: a stranger sweep either succeeds with
    /// reimbursement <= cap and gross conserved, or reverts GasTooHigh untouched.
    function testFuzz_CapHoldsAcrossGasRange(uint256 gasPrice, uint256 gross, uint256 cap) public {
        gasPrice = bound(gasPrice, 20 gwei, 20_000 gwei);
        gross    = bound(gross, PROD_MIN_SWEEP, 1e12);
        cap      = bound(cap, PROD_TIP, 1_000_000);
        vm.fee(gasPrice);
        vm.txGasPrice(gasPrice);

        address slot = factory.createSlot(merchant, ref1, 0, address(0), cap);
        _fund(slot, gross);

        vm.prank(stranger);
        (bool ok, bytes memory ret) = slot.call(abi.encodeCall(Slot.sweep, ()));

        if (!ok) {
            assertEq(bytes4(ret), Slot.GasTooHigh.selector, "unexpected revert");
            assertEq(Slot(slot).balance(), gross, "slot touched on GasTooHigh");
            return;
        }
        uint256 got = usdc.balanceOf(stranger);
        assertLe(got, cap, "over cap");
        assertEq(got + usdc.balanceOf(merchant), gross, "not conserved");
    }

    function _reimbursementAt(uint256 baseFee, uint256 gasPrice, bytes32 ref) internal returns (uint256) {
        vm.fee(baseFee);
        vm.txGasPrice(gasPrice);
        address slot = factory.createSlot(merchant, ref, 0, address(0), MAX_R);
        _fund(slot, 1_000_000);
        uint256 before = usdc.balanceOf(stranger);
        vm.prank(stranger);
        Slot(slot).sweep();
        return usdc.balanceOf(stranger) - before;
    }

    /// Found live on Arc testnet: tooling sent a 575 gwei priority tip on a
    /// 20 gwei base fee and the sweep reverted GasTooHigh. Reimbursement must
    /// follow the network base fee, not the sweeper's chosen tip.
    function test_PriorityTipDoesNotInflateReimbursement() public {
        uint256 normal   = _reimbursementAt(20 gwei, 21 gwei,  ref1);
        uint256 inflated = _reimbursementAt(20 gwei, 600 gwei, ref2);
        assertApproxEqAbs(inflated, normal, 50, "priority tip inflated reimbursement");
    }

    /// A sweeper overpaying the tip still succeeds when the network is cheap.
    function test_HighPriorityTipStillSweepsWhenBaseFeeLow() public {
        vm.fee(20 gwei);
        vm.txGasPrice(600 gwei);
        address slot = _slotFunded(0, 150_000);
        vm.prank(stranger);
        Slot(slot).sweep();
        assertEq(Slot(slot).balance(), 0, "sweep did not complete");
    }
}
