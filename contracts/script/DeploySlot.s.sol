// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {Slot}            from "../Slot.sol";
import {SlotFactory}     from "../SlotFactory.sol";

/// @notice Deploys the Slot implementation and SlotFactory with production constants.
///
///   Dry run (no broadcast, no cost):
///     arc-forge script contracts/script/DeploySlot.s.sol --rpc-url <RPC>
///   Broadcast:
///     arc-forge script contracts/script/DeploySlot.s.sol --rpc-url <RPC> \
///       --account <keystore> --broadcast
contract DeploySlot is Script {
    address internal constant USDC      = 0x3600000000000000000000000000000000000000;
    uint256 internal constant TIP       = 2_000;   // 0.002 USDC
    uint256 internal constant MIN_SWEEP = 100_000; // 0.10 USDC

    function run() external returns (Slot impl, SlotFactory factory) {
        require(block.chainid == 5042 || block.chainid == 5042002, "DeploySlot: not an Arc chain");

        vm.startBroadcast();
        impl    = new Slot();
        factory = new SlotFactory(address(impl), USDC, TIP, MIN_SWEEP);
        vm.stopBroadcast();

        require(factory.implementation() == address(impl), "impl mismatch");
        require(factory.usdc() == USDC,                    "usdc mismatch");
        require(factory.tip() == TIP,                      "tip mismatch");
        require(factory.minSweep() == MIN_SWEEP,           "minSweep mismatch");

        console.log("chainId        ", block.chainid);
        console.log("Slot impl      ", address(impl));
        console.log("SlotFactory    ", address(factory));
    }
}
