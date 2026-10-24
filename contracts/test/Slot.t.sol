// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test}         from "forge-std/Test.sol";
import {SlotFactory}  from "../SlotFactory.sol";
import {Slot}         from "../Slot.sol";
import {IERC20}       from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Minimal mock of the Arc USDC ERC-20 (6 decimals).
///      Deployed at the Arc USDC address via vm.etch so contracts that
///      reference the hardcoded address work without a fork.
contract MockUSDC {
    uint8  public constant decimals = 6;
    string public constant symbol   = "USDC";

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(to != address(0), "ERC20: transfer to zero");
        require(balanceOf[msg.sender] >= amount, "ERC20: insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to]         += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(to != address(0), "ERC20: transfer to zero");
        require(balanceOf[from] >= amount, "ERC20: insufficient");
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

// ─── Helpers ───────────────────────────────────────────────────────────────────

contract SlotTestBase is Test {
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000;

    MockUSDC     internal usdc;
    SlotFactory  internal factory;

    address internal merchant     = makeAddr("merchant");
    address internal feeRecipient = makeAddr("feeRecipient");
    bytes32 internal ref1         = keccak256("order-001");
    bytes32 internal ref2         = keccak256("order-002");

    function setUp() public virtual {
        // Etch MockUSDC at the Arc USDC address so all Slot.USDC calls hit it.
        usdc = new MockUSDC();
        vm.etch(ARC_USDC, address(usdc).code);
        // Alias for convenience; the etched address IS the mock.
        usdc = MockUSDC(ARC_USDC);

        factory = new SlotFactory();
    }

    /// @dev Give `to` some mock USDC (6-decimal units).
    function _fund(address to, uint256 amount) internal {
        usdc.mint(to, amount);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Predict
// ═══════════════════════════════════════════════════════════════════════════════

contract PredictTest is SlotTestBase {
    /// The predicted address must match the actually-deployed address exactly.
    function test_PredictMatchesDeployed() public {
        address predicted = factory.predict(merchant, ref1);
        address deployed  = factory.createSlot(merchant, ref1, 100, feeRecipient);
        assertEq(predicted, deployed, "predict != deployed");
    }

    /// Prediction is pure (no state change) and stable across repeated calls.
    function test_PredictIsIdempotent() public view {
        address a = factory.predict(merchant, ref1);
        address b = factory.predict(merchant, ref1);
        assertEq(a, b, "predict not idempotent");
    }

    /// Different references for the same merchant predict different addresses.
    function test_DifferentRefsGiveDifferentAddresses() public view {
        address a = factory.predict(merchant, ref1);
        address b = factory.predict(merchant, ref2);
        assertTrue(a != b, "same address for different refs");
    }

    /// Different merchants with the same reference predict different addresses.
    function test_DifferentMerchantsSameRefGiveDifferentAddresses() public view {
        address merchant2 = makeAddr("merchant2");
        address a = factory.predict(merchant,  ref1);
        address b = factory.predict(merchant2, ref1);
        assertTrue(a != b, "same address for different merchants");
    }

    /// Fuzz: predict always returns a non-zero address for non-zero merchants.
    function testFuzz_PredictNonZero(address m, bytes32 r) public view {
        vm.assume(m != address(0));
        address predicted = factory.predict(m, r);
        assertTrue(predicted != address(0), "predicted zero address");
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// createSlot — happy path
// ═══════════════════════════════════════════════════════════════════════════════

contract CreateSlotTest is SlotTestBase {
    /// createSlot emits SlotCreated with correct parameters.
    function test_EmitsSlotCreated() public {
        address predicted = factory.predict(merchant, ref1);
        vm.expectEmit(true, true, true, true);
        emit SlotFactory.SlotCreated(predicted, merchant, ref1, 100, feeRecipient);
        factory.createSlot(merchant, ref1, 100, feeRecipient);
    }

    /// Slot is recorded in the factory mapping.
    function test_SlotRecordedInMapping() public {
        address slot = factory.createSlot(merchant, ref1, 100, feeRecipient);
        assertEq(factory.slots(merchant, ref1), slot, "slot not in mapping");
    }

    /// Slot fields are correctly initialised.
    function test_SlotFieldsInitialised() public {
        address slot = factory.createSlot(merchant, ref1, 100, feeRecipient);
        Slot s = Slot(slot);
        assertEq(s.merchant(),      merchant,      "merchant mismatch");
        assertEq(s.reference(),     ref1,           "reference mismatch");
        assertEq(s.feeBps(),        100,            "feeBps mismatch");
        assertEq(s.feeRecipient(),  feeRecipient,   "feeRecipient mismatch");
    }

    /// Zero feeBps with zero feeRecipient is valid (no fee path).
    function test_ZeroFeeNoRecipientRequired() public {
        address slot = factory.createSlot(merchant, ref1, 0, address(0));
        assertEq(Slot(slot).feeBps(), 0);
    }

    /// Two different references under the same merchant produce distinct slots.
    function test_TwoRefsGiveTwoSlots() public {
        address s1 = factory.createSlot(merchant, ref1, 0, address(0));
        address s2 = factory.createSlot(merchant, ref2, 0, address(0));
        assertTrue(s1 != s2, "duplicate address");
        assertEq(Slot(s1).reference(), ref1);
        assertEq(Slot(s2).reference(), ref2);
    }

    /// Maximum allowed feeBps (1000 = 10 %) is accepted.
    function test_MaxFeeBpsAccepted() public {
        address slot = factory.createSlot(merchant, ref1, 1000, feeRecipient);
        assertEq(Slot(slot).feeBps(), 1000);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// createSlot — revert cases
// ═══════════════════════════════════════════════════════════════════════════════

contract CreateSlotRevertTest is SlotTestBase {
    function test_RevertZeroMerchant() public {
        vm.expectRevert(SlotFactory.ZeroMerchant.selector);
        factory.createSlot(address(0), ref1, 0, address(0));
    }

    function test_RevertFeeBpsTooHigh() public {
        vm.expectRevert(SlotFactory.FeeBpsTooHigh.selector);
        factory.createSlot(merchant, ref1, 1001, feeRecipient);
    }

    function test_RevertFeeBpsMaxPlusOne() public {
        vm.expectRevert(SlotFactory.FeeBpsTooHigh.selector);
        factory.createSlot(merchant, ref1, 1001, feeRecipient);
    }

    function test_RevertZeroFeeRecipientWhenFeeNonZero() public {
        vm.expectRevert(SlotFactory.ZeroFeeRecipient.selector);
        factory.createSlot(merchant, ref1, 100, address(0));
    }

    /// Same (merchant, reference) pair reverts on the second call.
    function test_RevertDuplicateReference() public {
        factory.createSlot(merchant, ref1, 0, address(0));
        vm.expectRevert(SlotFactory.ReferenceAlreadyUsed.selector);
        factory.createSlot(merchant, ref1, 0, address(0));
    }

    /// Duplicate check is per-merchant: another merchant may reuse the same ref.
    function test_SameRefDifferentMerchantIsAllowed() public {
        address merchant2 = makeAddr("merchant2");
        factory.createSlot(merchant,  ref1, 0, address(0));
        factory.createSlot(merchant2, ref1, 0, address(0)); // must not revert
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Slot.initialize — cannot be called twice
// ═══════════════════════════════════════════════════════════════════════════════

contract InitialiseGuardTest is SlotTestBase {
    /// initialize reverts with AlreadyInitialised when called a second time.
    function test_InitialiseCannotBeCalledTwice() public {
        address slot = factory.createSlot(merchant, ref1, 0, address(0));
        vm.expectRevert(Slot.AlreadyInitialised.selector);
        Slot(slot).initialize(merchant, ref1, 0, address(0));
    }

    /// Even a different caller cannot re-initialise.
    function test_InitialiseCannotBeCalledByStranger() public {
        address slot = factory.createSlot(merchant, ref1, 0, address(0));
        address attacker = makeAddr("attacker");
        vm.prank(attacker);
        vm.expectRevert(Slot.AlreadyInitialised.selector);
        Slot(slot).initialize(attacker, ref1, 0, address(0));
    }

    /// The bare implementation itself can be initialised, but only once.
    function test_ImplementationInitialiseOnce() public {
        Slot impl = Slot(factory.implementation());
        impl.initialize(merchant, ref1, 0, address(0));
        vm.expectRevert(Slot.AlreadyInitialised.selector);
        impl.initialize(merchant, ref1, 0, address(0));
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Merchant immutability: no path to change merchant post-creation
// ═══════════════════════════════════════════════════════════════════════════════

contract MerchantImmutabilityTest is SlotTestBase {
    /// After createSlot, merchant is set and cannot be changed via initialize
    /// (AlreadyInitialised) or by any other public function on the Slot.
    function test_NoPublicFunctionChangesMerchant() public {
        address slot     = factory.createSlot(merchant, ref1, 0, address(0));
        address original = Slot(slot).merchant();

        // Attempt re-init as a different merchant.
        address attacker = makeAddr("attacker");
        vm.expectRevert(Slot.AlreadyInitialised.selector);
        Slot(slot).initialize(attacker, ref1, 0, address(0));

        // Merchant is unchanged.
        assertEq(Slot(slot).merchant(), original, "merchant changed");
    }

    /// Confirm there is no setter for merchant by checking the function selectors
    /// that exist. The only state-changing external functions should be
    /// initialize and sweep — neither changes merchant post-init.
    function test_SlotHasNoMerchantSetter() public {
        address slot = factory.createSlot(merchant, ref1, 0, address(0));

        // setMerchant(address) selector must not exist (call should revert).
        bytes4 sel = bytes4(keccak256("setMerchant(address)"));
        (bool ok,) = slot.call(abi.encodeWithSelector(sel, makeAddr("x")));
        assertFalse(ok, "setMerchant(address) should not exist");

        // changeMerchant(address) also must not exist.
        bytes4 sel2 = bytes4(keccak256("changeMerchant(address)"));
        (bool ok2,) = slot.call(abi.encodeWithSelector(sel2, makeAddr("x")));
        assertFalse(ok2, "changeMerchant(address) should not exist");
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// balance()
// ═══════════════════════════════════════════════════════════════════════════════

contract BalanceTest is SlotTestBase {
    function test_BalanceReflectsERC20() public {
        address slot = factory.createSlot(merchant, ref1, 0, address(0));
        assertEq(Slot(slot).balance(), 0, "initial balance non-zero");

        _fund(slot, 1_000_000); // 1 USDC
        assertEq(Slot(slot).balance(), 1_000_000, "balance not updated");
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// sweep()
// ═══════════════════════════════════════════════════════════════════════════════

contract SweepTest is SlotTestBase {
    function test_SweepWithNoFee() public {
        address slot = factory.createSlot(merchant, ref1, 0, address(0));
        _fund(slot, 1_000_000);

        uint256 before = usdc.balanceOf(merchant);
        Slot(slot).sweep();
        assertEq(usdc.balanceOf(merchant) - before, 1_000_000, "merchant did not receive full amount");
        assertEq(Slot(slot).balance(), 0, "slot not drained");
    }

    function test_SweepWithFee() public {
        address slot = factory.createSlot(merchant, ref1, 500, feeRecipient); // 5 %
        _fund(slot, 1_000_000); // 1 USDC

        Slot(slot).sweep();

        // 5 % fee = 50_000, merchant gets 950_000
        assertEq(usdc.balanceOf(feeRecipient), 50_000,  "fee wrong");
        assertEq(usdc.balanceOf(merchant),     950_000, "merchant amount wrong");
        assertEq(Slot(slot).balance(), 0);
    }

    function test_SweepEmitsSweepedEvent() public {
        address slot = factory.createSlot(merchant, ref1, 100, feeRecipient); // 1 %
        _fund(slot, 1_000_000);

        vm.expectEmit(true, true, false, true);
        emit Slot.Swept(merchant, ref1, 990_000, 10_000);
        Slot(slot).sweep();
    }

    function test_SweepRevertsWhenEmpty() public {
        address slot = factory.createSlot(merchant, ref1, 0, address(0));
        vm.expectRevert(Slot.NothingToSweep.selector);
        Slot(slot).sweep();
    }

    function test_SweepIsPermissionless() public {
        address slot = factory.createSlot(merchant, ref1, 0, address(0));
        _fund(slot, 500_000);

        address anyone = makeAddr("anyone");
        vm.prank(anyone);
        Slot(slot).sweep(); // must not revert
        assertEq(usdc.balanceOf(merchant), 500_000);
    }

    /// Fuzz fee math: fee + merchant amount always equals total, no dust.
    function testFuzz_SweepFeeArithmetic(uint256 total, uint16 feeBps) public {
        // Constrain to realistic values.
        total  = bound(total,  1,    1e15); // up to 1 billion USDC
        feeBps = uint16(bound(feeBps, 0, 1000));

        address slot = factory.createSlot(merchant, ref1, feeBps, feeBps > 0 ? feeRecipient : address(0));
        _fund(slot, total);

        uint256 merchantBefore = usdc.balanceOf(merchant);
        uint256 feeBefore      = usdc.balanceOf(feeRecipient);

        Slot(slot).sweep();

        uint256 merchantGot = usdc.balanceOf(merchant)      - merchantBefore;
        uint256 feeGot      = usdc.balanceOf(feeRecipient)  - feeBefore;

        assertEq(merchantGot + feeGot, total, "amounts don't add up");
        assertEq(feeGot, (total * feeBps) / 10_000, "fee amount wrong");
    }

    /// Multiple sweeps across successive deposits work correctly.
    function test_MultipleSweeps() public {
        address slot = factory.createSlot(merchant, ref1, 0, address(0));

        _fund(slot, 1_000_000);
        Slot(slot).sweep();
        assertEq(usdc.balanceOf(merchant), 1_000_000);

        _fund(slot, 2_000_000);
        Slot(slot).sweep();
        assertEq(usdc.balanceOf(merchant), 3_000_000);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Arc-specific safety: nothing is payable
// ═══════════════════════════════════════════════════════════════════════════════

contract ArcSafetyTest is SlotTestBase {
    /// Sending native value (ETH/USDC-gas on Arc) to a Slot must revert.
    function test_SlotNotPayable() public {
        address slot = factory.createSlot(merchant, ref1, 0, address(0));
        vm.deal(address(this), 1 ether);
        (bool ok,) = payable(slot).call{value: 1}("");
        assertFalse(ok, "Slot accepted native value — must not be payable");
    }

    /// Sending native value to SlotFactory must revert.
    function test_FactoryNotPayable() public {
        vm.deal(address(this), 1 ether);
        (bool ok,) = payable(address(factory)).call{value: 1}("");
        assertFalse(ok, "SlotFactory accepted native value — must not be payable");
    }
}
