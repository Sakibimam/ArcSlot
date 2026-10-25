// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {SlotFactory} from "../SlotFactory.sol";
import {Slot}        from "../Slot.sol";

// Stress test: 1,000 actors hammer the system with random requests, payments,
// collections at random gas prices, blacklisting and fee releases. After every
// call sequence the invariants below must hold.

/// Behaves like Circle's FiatToken where it matters: transfers to or from a
/// blacklisted address revert.
contract StrictUSDC {
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => bool) public blacklisted;
    uint256 public totalSupply;

    function mint(address to, uint256 a) external { balanceOf[to] += a; totalSupply += a; }
    function setBlacklisted(address who, bool f) external { blacklisted[who] = f; }
    function isBlacklisted(address who) external view returns (bool) { return blacklisted[who]; }
    function transfer(address to, uint256 a) external returns (bool) {
        require(!blacklisted[msg.sender] && !blacklisted[to], "blacklisted");
        require(to != address(0) && balanceOf[msg.sender] >= a, "bal");
        balanceOf[msg.sender] -= a;
        balanceOf[to] += a;
        return true;
    }
}

contract Handler is Test {
    uint256 internal constant N_ACTORS = 1_000;
    uint256 internal constant TIP = 2_000;

    SlotFactory public factory;
    StrictUSDC  public usdc;
    address[] public actors;
    address[] public slots;
    address[] public collectors;
    mapping(address => bool) internal seenCollector;

    // Ghosts
    uint256 public minted;
    uint256 public violations;
    string  public lastViolation;
    uint256 public sweeps;
    uint256 public frozenSweeps;
    uint256 public heldSweeps;

    constructor(SlotFactory f, StrictUSDC u) {
        factory = f;
        usdc = u;
        for (uint256 i; i < N_ACTORS; ++i) actors.push(address(uint160(0x10000 + i)));
    }

    function _actor(uint256 seed) internal view returns (address) { return actors[seed % N_ACTORS]; }
    function _flag(string memory why) internal { violations++; lastViolation = why; }

    function create(uint256 creatorSeed, uint256 merchantSeed, uint256 feeSeed, uint256 maxRSeed) external {
        address creator  = _actor(creatorSeed);
        address merchant = _actor(merchantSeed);
        uint16  feeBps   = uint16(bound(feeSeed, 0, 1_000));
        address feeTo    = feeBps > 0 ? _actor(feeSeed >> 16) : address(0);
        uint256 maxR     = bound(maxRSeed, TIP, 500_000);
        vm.prank(creator);
        try factory.createRequest(merchant, keccak256(abi.encode(slots.length, creatorSeed)), feeBps, feeTo, maxR, 0, "stress", 0) returns (address s) {
            slots.push(s);
        } catch {}
    }

    function pay(uint256 slotSeed, uint256 payerSeed, uint256 amount) external {
        if (slots.length == 0) return;
        address slot  = slots[slotSeed % slots.length];
        address payer = _actor(payerSeed);
        amount = bound(amount, 100_000, 5_000e6); // at least minSweep, so payments are collectable
        usdc.mint(payer, amount);
        minted += amount;
        vm.prank(payer);
        try usdc.transfer(slot, amount) {} catch {}
    }

    /// Prefer a slot that actually holds a collectable payment.
    function _fundedSlot(uint256 seed) internal view returns (Slot) {
        for (uint256 k; k < 25; ++k) {
            Slot c = Slot(payable(slots[(seed + k) % slots.length]));
            if (usdc.balanceOf(address(c)) - c.heldFees() >= 100_000) return c;
        }
        return Slot(payable(slots[seed % slots.length]));
    }

    function sweep(uint256 slotSeed, uint256 callerSeed, uint256 baseFee, bool asMerchant) external {
        if (slots.length == 0) return;
        Slot s = _fundedSlot(slotSeed);
        address caller = asMerchant ? s.merchant() : _actor(callerSeed);
        // Mostly normal Arc fees, with occasional spikes to stress the 10% cap.
        baseFee = baseFee % 10 == 0 ? bound(baseFee, 80 gwei, 300 gwei) : bound(baseFee, 1 gwei, 80 gwei);
        vm.fee(baseFee);
        vm.txGasPrice(baseFee + 1 gwei);

        address merchant = s.merchant();
        address feeTo    = s.feeRecipient();
        uint256 gross    = usdc.balanceOf(address(s)) - s.heldFees();
        uint256 heldBefore = s.heldFees();
        uint256 mBefore  = usdc.balanceOf(merchant);
        uint256 cBefore  = usdc.balanceOf(caller);
        bool mBlocked    = usdc.blacklisted(merchant);

        vm.prank(caller);
        try s.sweep() {
            sweeps++;
            if (mBlocked) {
                frozenSweeps++;
                if (usdc.balanceOf(merchant) != mBefore) _flag("blacklisted merchant was paid");
                if (!s.quarantined()) _flag("blacklisted merchant not frozen");
                return;
            }
            if (s.quarantined()) _flag("clean sweep left slot quarantined");
            if (s.heldFees() > heldBefore) heldSweeps++;
            if (caller != merchant) {
                if (!seenCollector[caller]) { seenCollector[caller] = true; collectors.push(caller); }
                uint256 reward = usdc.balanceOf(caller) - cBefore;
                if (caller == feeTo) reward = 0; // fee and reward to the same address: skip the bound
                if (reward * 10 > gross) _flag("reward above 10% of the payment");
                if (reward > s.maxReimbursement()) _flag("reward above merchant cap");
            }
            if (usdc.balanceOf(merchant) < mBefore) _flag("merchant balance went down");
        } catch {}
    }

    function sweepForOther(uint256 slotSeed, uint256 callerSeed, uint256 otherSeed) external {
        if (slots.length == 0) return;
        Slot s = Slot(payable(slots[slotSeed % slots.length]));
        address caller = _actor(callerSeed);
        address other  = _actor(otherSeed);
        if (other == caller) return;
        vm.prank(caller);
        try s.sweepFor(other) { _flag("credited a reward to someone else"); } catch {}
    }

    /// Blacklist (or clear) a real merchant or fee wallet, so freeze and
    /// fee-hold paths run; sometimes a random actor.
    function toggleBlacklist(uint256 seed, bool on) external {
        address who = _actor(seed);
        if (slots.length > 0 && seed % 3 != 0) {
            Slot s = Slot(payable(slots[seed % slots.length]));
            who = seed % 2 == 0 ? s.merchant() : (s.feeRecipient() == address(0) ? s.merchant() : s.feeRecipient());
        }
        usdc.setBlacklisted(who, on);
    }

    function release(uint256 slotSeed) external {
        if (slots.length == 0) return;
        Slot s = Slot(payable(slots[slotSeed % slots.length]));
        address feeTo = s.feeRecipient();
        uint256 held = s.heldFees();
        uint256 before = usdc.balanceOf(feeTo);
        try s.releaseHeldFees() {
            if (usdc.blacklisted(feeTo)) _flag("paid a blacklisted fee wallet");
            if (usdc.balanceOf(feeTo) - before != held) _flag("held fee amount wrong");
        } catch {}
    }

    // Views for the invariants
    function slotCount() external view returns (uint256) { return slots.length; }
    function actorCount() external view returns (uint256) { return actors.length; }
    function collectorCount() external view returns (uint256) { return collectors.length; }
    function collectorAt(uint256 i) external view returns (address) { return collectors[i]; }
}

contract StressInvariantTest is Test {
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000;
    SlotFactory internal factory;
    StrictUSDC  internal usdc;
    Handler     internal handler;

    function setUp() public {
        vm.chainId(5042002);
        vm.etch(ARC_USDC, address(new StrictUSDC()).code);
        usdc = StrictUSDC(ARC_USDC);
        factory = new SlotFactory(address(new Slot()), 2_000, 100_000);
        handler = new Handler(factory, usdc);
        targetContract(address(handler));
    }

    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 2000
    /// forge-config: default.invariant.fail-on-revert = false
    function invariant_NoViolations() public view {
        assertEq(handler.violations(), 0, handler.lastViolation());
    }

    /// No USDC is created or destroyed: everything minted is held by an actor, a slot, or nobody else.
    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 2000
    /// forge-config: default.invariant.fail-on-revert = false
    function invariant_UsdcConserved() public view {
        uint256 sum;
        for (uint256 i; i < handler.actorCount(); ++i) sum += usdc.balanceOf(handler.actors(i));
        for (uint256 i; i < handler.slotCount(); ++i) sum += usdc.balanceOf(handler.slots(i));
        assertEq(sum, handler.minted(), "USDC leaked or created");
        assertEq(usdc.balanceOf(address(factory)), 0, "factory holds USDC");
    }

    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 2000
    /// forge-config: default.invariant.fail-on-revert = false
    function invariant_HeldFeesCovered() public view {
        for (uint256 i; i < handler.slotCount(); ++i) {
            Slot s = Slot(payable(handler.slots(i)));
            assertLe(s.heldFees(), usdc.balanceOf(address(s)), "held fees exceed slot balance");
        }
    }

    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 2000
    /// forge-config: default.invariant.fail-on-revert = false
    function invariant_LeaderboardAddsUp() public view {
        uint256 n; uint256 delivered;
        for (uint256 i; i < handler.collectorCount(); ++i) {
            (uint64 c, uint192 d) = factory.collectorStats(handler.collectorAt(i));
            n += c; delivered += d;
        }
        assertEq(n, factory.totalCollections(), "collections don't add up");
        assertEq(delivered, factory.totalDelivered(), "delivered doesn't add up");
    }

    function afterInvariant() external view virtual {
        // Make sure the campaign actually exercised the paths (not a vacuous pass).
        assertGt(handler.slotCount(), 0);
    }
}

/// Deterministic 1,000-actor simulation: 20,000 pseudo-random actions through
/// the same handler, invariants checked every 500 steps, and a coverage report
/// proving the risky paths (frozen merchants, held fees, collector races) ran.
contract StressSimulationTest is Test {
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000;
    SlotFactory internal factory;
    StrictUSDC  internal usdc;
    Handler     internal h;

    function setUp() public {
        vm.chainId(5042002);
        vm.etch(ARC_USDC, address(new StrictUSDC()).code);
        usdc = StrictUSDC(ARC_USDC);
        factory = new SlotFactory(address(new Slot()), 2_000, 100_000);
        h = new Handler(factory, usdc);
    }

    function _checkInvariants() internal view {
        assertEq(h.violations(), 0, h.lastViolation());
        uint256 sum;
        for (uint256 i; i < h.actorCount(); ++i) sum += usdc.balanceOf(h.actors(i));
        for (uint256 i; i < h.slotCount(); ++i) {
            Slot s = Slot(payable(h.slots(i)));
            uint256 b = usdc.balanceOf(address(s));
            sum += b;
            assertLe(s.heldFees(), b, "held fees exceed slot balance");
        }
        assertEq(sum, h.minted(), "USDC leaked or created");
        uint256 n; uint256 delivered;
        for (uint256 i; i < h.collectorCount(); ++i) {
            (uint64 c, uint192 d) = factory.collectorStats(h.collectorAt(i));
            n += c; delivered += d;
        }
        assertEq(n, factory.totalCollections(), "collections don't add up");
        assertEq(delivered, factory.totalDelivered(), "delivered doesn't add up");
    }

    function test_Simulate1000Users20000Actions() public {
        uint256 seed = uint256(keccak256("arcslot-stress"));
        for (uint256 step; step < 20_000; ++step) {
            seed = uint256(keccak256(abi.encode(seed, step)));
            uint256 a = seed; uint256 b = seed >> 64; uint256 c = seed >> 128; uint256 d = seed >> 192;
            uint256 kind = seed % 100;
            if (kind < 15)      h.create(a, b, c % 1_500, d);   // ~1/3 of creates take a fee
            else if (kind < 45) h.pay(a, b, c);
            else if (kind < 80) h.sweep(a, b, c, d % 4 == 0);
            else if (kind < 88) h.sweepForOther(a, b, c);
            else if (kind < 95) h.toggleBlacklist(a, d % 3 != 0);
            else                h.release(a);
            if (step % 500 == 499) _checkInvariants();
        }
        _checkInvariants();
        console.log("actors                    ", h.actorCount());
        console.log("payment requests          ", h.slotCount());
        console.log("collectors on leaderboard ", h.collectorCount());
        console.log("successful sweeps         ", h.sweeps());
        console.log("frozen (merchant blacklisted)", h.frozenSweeps());
        console.log("fee held (fee wallet blacklisted)", h.heldSweeps());
        console.log("USDC paid in (6-dec)      ", h.minted());
        assertGt(h.sweeps(), 1_000, "too few sweeps");
        assertGt(h.frozenSweeps(), 10, "freeze path barely ran");
        assertGt(h.heldSweeps(), 10, "fee-hold path barely ran");
        assertGt(h.collectorCount(), 100, "too few distinct collectors");
    }
}
