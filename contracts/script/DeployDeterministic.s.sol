// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {Slot}            from "../Slot.sol";
import {SlotFactory}     from "../SlotFactory.sol";
import {SlotVault}       from "../SlotVault.sol";
import {VaultFactory}    from "../VaultFactory.sol";

/// @notice Deploys Slot, SlotFactory, SlotVault and VaultFactory through the
///         standard CREATE2 deployer with chain-independent init code, so every
///         contract — and every Slot and vault address derived from them — is
///         identical on Arc and on every other supported chain. That is what
///         lets a merchant recover USDC a payer sent on the wrong network.
///         Idempotent: contracts already deployed at their address are skipped.
///
///   arc-forge script contracts/script/DeployDeterministic.s.sol --rpc-url <RPC> [--broadcast ...]
contract DeployDeterministic is Script {
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    uint256 internal constant TIP       = 2_000;   // 0.002 USDC (Arc only)
    uint256 internal constant MIN_SWEEP = 100_000; // 0.10 USDC (Arc only)

    struct Deployment {
        address slotImpl;
        address slotFactory;
        address vaultImpl;
        address vaultFactory;
    }

    function run() external returns (Deployment memory d) {
        vm.startBroadcast();
        d = deployAll();
        vm.stopBroadcast();
        console.log("chainId        ", block.chainid);
        console.log("Slot impl      ", d.slotImpl);
        console.log("SlotFactory    ", d.slotFactory);
        console.log("SlotVault impl ", d.vaultImpl);
        console.log("VaultFactory   ", d.vaultFactory);
    }

    function deployAll() public returns (Deployment memory d) {
        d.slotImpl     = _deploy("Slot", type(Slot).creationCode);
        d.slotFactory  = _deploy("SlotFactory", abi.encodePacked(type(SlotFactory).creationCode, abi.encode(d.slotImpl, TIP, MIN_SWEEP)));
        d.vaultImpl    = _deploy("SlotVault", type(SlotVault).creationCode);
        d.vaultFactory = _deploy("VaultFactory", abi.encodePacked(type(VaultFactory).creationCode, abi.encode(d.vaultImpl)));
    }

    function _deploy(string memory name, bytes memory initcode) internal returns (address addr) {
        bytes32 salt = keccak256(abi.encodePacked("arc-slot.v5.", name));
        addr = vm.computeCreate2Address(salt, keccak256(initcode), CREATE2_DEPLOYER);
        if (addr.code.length > 0) return addr;
        (bool ok,) = CREATE2_DEPLOYER.call(abi.encodePacked(salt, initcode));
        require(ok && addr.code.length > 0, string.concat("deploy failed: ", name));
    }
}
