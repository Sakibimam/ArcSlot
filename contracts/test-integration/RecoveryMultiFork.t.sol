// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test}        from "forge-std/Test.sol";
import {IERC20}      from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SlotFactory} from "../SlotFactory.sol";
import {Slot}        from "../Slot.sol";
import {DeployDeterministic} from "../script/DeployDeterministic.s.sol";

/// Forks Arc testnet AND Ethereum Sepolia in one test, deploys through the real
/// CREATE2 deployer on both, and recovers real Sepolia USDC that was sent to
/// the Arc Slot address on the wrong chain.
contract RecoveryMultiForkTest is Test {
    string  internal constant ARC_RPC     = "https://rpc.testnet.arc.io";
    string  internal constant SEPOLIA_RPC = "https://ethereum-sepolia-rpc.publicnode.com";
    IERC20  internal constant SEPOLIA_USDC = IERC20(0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238);
    /// Test wallet holding a little Sepolia USDC (used as the mistaken payer).
    address internal constant PAYER = 0x30c7eE328B80ce1dc15AC8F75e1FfAf51B9bB9Fb;

    address internal merchant = makeAddr("recovery-merchant");
    address internal stranger = makeAddr("recovery-stranger");
    bytes32 internal ref      = keccak256("paid-on-the-wrong-chain");

    function test_MultiFork_SameAddressesAndRealRecovery() public {
        // Arc testnet: where the request was made.
        vm.createSelectFork(ARC_RPC);
        DeployDeterministic.Deployment memory onArc = new DeployDeterministic().deployAll();
        address slotOnArc = SlotFactory(onArc.slotFactory).predict(address(this), merchant, ref);

        // Ethereum Sepolia: where the payer sent USDC by mistake.
        vm.createSelectFork(SEPOLIA_RPC);
        DeployDeterministic.Deployment memory onSepolia = new DeployDeterministic().deployAll();
        assertEq(onSepolia.slotFactory, onArc.slotFactory, "factory differs across chains");
        assertEq(onSepolia.vaultFactory, onArc.vaultFactory, "vault factory differs across chains");

        SlotFactory factory = SlotFactory(onSepolia.slotFactory);
        assertEq(factory.usdc(), address(SEPOLIA_USDC));
        address slotOnSepolia = factory.predict(address(this), merchant, ref);
        assertEq(slotOnSepolia, slotOnArc, "slot address differs across chains");

        // The mistake: real Sepolia USDC sent to the Arc slot address.
        uint256 amount = 50_000; // 0.05 USDC — below Arc's minimum, still recoverable
        vm.prank(PAYER);
        assertTrue(SEPOLIA_USDC.transfer(slotOnSepolia, amount));

        // Recovery: the creator redeploys the slot there; anyone collects; all of it goes to the merchant.
        assertEq(factory.createSlot(merchant, ref, 0, address(0), 50_000), slotOnSepolia);
        vm.prank(stranger);
        Slot(payable(slotOnSepolia)).sweep();

        assertEq(SEPOLIA_USDC.balanceOf(merchant), amount, "merchant did not recover the funds");
        assertEq(SEPOLIA_USDC.balanceOf(stranger), 0, "no USDC refund off Arc");
        assertFalse(Slot(payable(slotOnSepolia)).quarantined(), "real Sepolia blocklist probe failed");
    }
}
