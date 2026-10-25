// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {SlotVault}       from "../SlotVault.sol";
import {VaultFactory}    from "../VaultFactory.sol";

/// @notice Deploys the SlotVault implementation and VaultFactory.
///   arc-forge script contracts/script/DeployVault.s.sol --rpc-url <RPC> [--broadcast ...]
contract DeployVault is Script {
    address internal constant USDC = 0x3600000000000000000000000000000000000000;
    address internal constant PQ   = 0x1800000000000000000000000000000000000004;

    function run() external returns (SlotVault impl, VaultFactory factory) {
        require(block.chainid == 5042 || block.chainid == 5042002, "DeployVault: not an Arc chain");
        require(PQ.code.length > 0 || block.chainid == 5042002 || block.chainid == 5042, "no PQ precompile");

        vm.startBroadcast();
        impl    = new SlotVault();
        factory = new VaultFactory(address(impl), USDC);
        vm.stopBroadcast();

        require(factory.implementation() == address(impl), "impl mismatch");
        require(factory.usdc() == USDC, "usdc mismatch");
        console.log("SlotVault impl ", address(impl));
        console.log("VaultFactory   ", address(factory));
    }
}
