// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test}             from "forge-std/Test.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {SlotFactory}      from "../SlotFactory.sol";
import {Slot}             from "../Slot.sol";
import {SlotVault}        from "../SlotVault.sol";
import {VaultFactory}     from "../VaultFactory.sol";
import {ChainConfig}      from "../ChainConfig.sol";
import {DeployDeterministic} from "../script/DeployDeterministic.s.sol";
import {MockUSDC}         from "./Slot.t.sol";

/// Exposes the ChainConfig library for testing.
contract ChainConfigHarness {
    function usdc() external view returns (address) { return ChainConfig.usdc(); }
    function isArc() external view returns (bool) { return ChainConfig.isArc(); }
}

contract ChainConfigTest is Test {
    ChainConfigHarness internal h = new ChainConfigHarness();

    function _usdcOn(uint256 id) internal returns (address) {
        vm.chainId(id);
        return h.usdc();
    }

    function test_UsdcPerChain() public {
        assertEq(_usdcOn(5042),     0x3600000000000000000000000000000000000000);
        assertEq(_usdcOn(5042002),  0x3600000000000000000000000000000000000000);
        assertEq(_usdcOn(1),        0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48);
        assertEq(_usdcOn(8453),     0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913);
        assertEq(_usdcOn(42161),    0xaf88d065e77c8cC2239327C5EDb3A432268e5831);
        assertEq(_usdcOn(10),       0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85);
        assertEq(_usdcOn(137),      0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359);
        assertEq(_usdcOn(43114),    0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E);
        assertEq(_usdcOn(11155111), 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238);
        assertEq(_usdcOn(84532),    0x036CbD53842c5426634e7929541eC2318f3dCF7e);
        assertEq(_usdcOn(421614),   0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d);
    }

    function test_UnsupportedChainReverts() public {
        vm.chainId(999_999);
        vm.expectRevert(ChainConfig.UnsupportedChain.selector);
        h.usdc();
    }

    function test_IsArc() public {
        vm.chainId(5042);    assertTrue(h.isArc());
        vm.chainId(5042002); assertTrue(h.isArc());
        vm.chainId(8453);    assertFalse(h.isArc());
    }
}

// ─── Same addresses on every chain ──────────────────────────────────────────

contract DeterministicDeployTest is Test {
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    // Arachnid's deterministic deployment proxy runtime code.
    bytes internal constant DEPLOYER_CODE =
        hex"7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3";

    function _deployOn(uint256 chainId) internal returns (DeployDeterministic.Deployment memory d) {
        vm.chainId(chainId);
        vm.etch(CREATE2_DEPLOYER, DEPLOYER_CODE);
        d = new DeployDeterministic().deployAll();
    }

    function test_SameAddressesOnArcAndBase() public {
        uint256 snap = vm.snapshotState();
        DeployDeterministic.Deployment memory arc = _deployOn(5042002);
        vm.revertToState(snap);
        DeployDeterministic.Deployment memory base = _deployOn(84532);

        assertEq(arc.slotImpl, base.slotImpl, "slot impl");
        assertEq(arc.slotFactory, base.slotFactory, "slot factory");
        assertEq(arc.vaultImpl, base.vaultImpl, "vault impl");
        assertEq(arc.vaultFactory, base.vaultFactory, "vault factory");
    }

    function test_SameSlotAddressOnEveryChain() public {
        address merchant = makeAddr("merchant");
        bytes32 ref = keccak256("inv-1");
        uint256 snap = vm.snapshotState();
        address onArc = SlotFactory(_deployOn(5042002).slotFactory).predict(merchant, ref);
        vm.revertToState(snap);
        address onBase = SlotFactory(_deployOn(84532).slotFactory).predict(merchant, ref);
        assertEq(onArc, onBase);
    }

    function test_DeployIsIdempotent() public {
        DeployDeterministic.Deployment memory a = _deployOn(5042002);
        DeployDeterministic.Deployment memory b = new DeployDeterministic().deployAll();
        assertEq(a.slotFactory, b.slotFactory);
        assertEq(a.vaultFactory, b.vaultFactory);
    }

    function test_FactoriesUseTheLocalUsdc() public {
        assertEq(SlotFactory(_deployOn(84532).slotFactory).usdc(), 0x036CbD53842c5426634e7929541eC2318f3dCF7e);
    }
}

// ─── Recovery rules off Arc ─────────────────────────────────────────────────

contract OffArcSlotTest is Test {
    address internal constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    MockUSDC    internal usdc;
    SlotFactory internal factory;
    address internal merchant = makeAddr("merchant");
    address internal stranger = makeAddr("stranger");
    bytes32 internal ref = keccak256("inv-wrong-chain");

    function setUp() public {
        vm.chainId(8453);
        vm.etch(BASE_USDC, address(new MockUSDC()).code);
        usdc = MockUSDC(BASE_USDC);
        factory = new SlotFactory(address(new Slot()), 2_000, 100_000);
    }

    /// Someone sent USDC to the slot address on Base by mistake: anyone can
    /// deploy the slot there and the whole amount goes to the merchant.
    function test_RecoversStrayFundsToMerchant() public {
        address predicted = factory.predict(merchant, ref);
        usdc.mint(predicted, 50_000); // below Arc's minimum, still recoverable
        address slot = factory.createSlot(merchant, ref, 0, address(0), 50_000);
        assertEq(slot, predicted);

        vm.txGasPrice(50 gwei);
        vm.prank(stranger);
        Slot(slot).sweep();

        assertEq(usdc.balanceOf(merchant), 50_000, "merchant gets everything");
        assertEq(usdc.balanceOf(stranger), 0, "no USDC gas refund off Arc");
    }

    function test_NoGasTooHighOffArc() public {
        address slot = factory.createSlot(merchant, ref, 0, address(0), 50_000);
        usdc.mint(slot, 1_000_000);
        vm.fee(20_000 gwei);
        vm.txGasPrice(20_000 gwei);
        vm.prank(stranger);
        Slot(slot).sweep();
        assertEq(usdc.balanceOf(merchant), 1_000_000);
    }

    /// Whoever deploys a recovery slot first must not be able to skim a fee.
    function test_FeeNotAllowedOffArc() public {
        vm.expectRevert(SlotFactory.FeeNotAllowedOffArc.selector);
        factory.createSlot(merchant, ref, 100, makeAddr("skimmer"), 50_000);
    }

    function test_BlocklistStillQuarantinesOffArc() public {
        address slot = factory.createSlot(merchant, ref, 0, address(0), 50_000);
        usdc.mint(slot, 1_000_000);
        usdc.setBlacklisted(merchant, true);
        Slot(slot).sweep();
        assertTrue(Slot(slot).quarantined());
        assertEq(usdc.balanceOf(slot), 1_000_000);
    }
}

contract OffArcVaultTest is Test {
    address internal constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    MockUSDC     internal usdc;
    VaultFactory internal vaults;
    uint256 internal ownerPk = 0xA11CE;
    address internal owner;
    address internal payee = makeAddr("payee");

    function setUp() public {
        vm.chainId(8453);
        owner = vm.addr(ownerPk);
        vm.etch(BASE_USDC, address(new MockUSDC()).code);
        usdc = MockUSDC(BASE_USDC);
        vaults = new VaultFactory(address(new SlotVault()));
    }

    function _ownerSign(bytes32 digest) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerPk, MessageHashUtils.toEthSignedMessageHash(digest));
        return abi.encodePacked(r, s, v);
    }

    /// There is no PQ precompile off Arc, so recovered funds are released with
    /// the owner wallet's signature alone.
    function test_OwnerAloneWithdrawsOffArc() public {
        SlotVault v = SlotVault(vaults.createVault(owner, keccak256("pq"), true, 7 days, bytes32("s")));
        usdc.mint(address(v), 1_000_000);
        uint256 dl = block.timestamp + 1 hours;
        bytes32 d = v.withdrawDigest(payee, 1_000_000, 0, dl);
        v.withdraw(payee, 1_000_000, 0, dl, "", _ownerSign(d));
        assertEq(usdc.balanceOf(payee), 1_000_000);
    }

    function test_OffArcStillNeedsTheOwner() public {
        SlotVault v = SlotVault(vaults.createVault(owner, keccak256("pq"), false, 7 days, bytes32("s")));
        usdc.mint(address(v), 1_000_000);
        uint256 dl = block.timestamp + 1 hours;
        bytes32 d = v.withdrawDigest(payee, 1_000_000, 0, dl);
        (uint8 vv, bytes32 r, bytes32 s) = vm.sign(0xBAD, MessageHashUtils.toEthSignedMessageHash(d));
        vm.expectRevert(SlotVault.BadOwnerSignature.selector);
        v.withdraw(payee, 1_000_000, 0, dl, "", abi.encodePacked(r, s, vv));
    }

    function test_VaultAddressMatchesArc() public {
        address onBase = vaults.predict(owner, keccak256("pq"), true, 7 days, bytes32("s"));
        vm.chainId(5042002);
        assertEq(vaults.predict(owner, keccak256("pq"), true, 7 days, bytes32("s")), onBase);
    }
}
