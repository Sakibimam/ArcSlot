// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ChainConfig
/// @notice Per-chain facts resolved at runtime from block.chainid, so the same
///         bytecode (and therefore the same CREATE2 addresses) works on every
///         chain. This is what makes a Slot address identical on Arc and on
///         the chains a payer might send to by mistake.
library ChainConfig {
    error UnsupportedChain();

    /// @notice Arc mainnet or Arc testnet: gas is USDC, PQ precompile present.
    function isArc() internal view returns (bool) {
        return block.chainid == 5042 || block.chainid == 5042002;
    }

    /// @notice Circle USDC (FiatToken) on this chain.
    function usdc() internal view returns (address) {
        uint256 id = block.chainid;
        if (id == 5042 || id == 5042002) return 0x3600000000000000000000000000000000000000; // Arc
        if (id == 1)        return 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48; // Ethereum
        if (id == 8453)     return 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913; // Base
        if (id == 42161)    return 0xaf88d065e77c8cC2239327C5EDb3A432268e5831; // Arbitrum
        if (id == 10)       return 0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85; // OP Mainnet
        if (id == 137)      return 0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359; // Polygon
        if (id == 43114)    return 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E; // Avalanche
        if (id == 11155111) return 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238; // Ethereum Sepolia
        if (id == 84532)    return 0x036CbD53842c5426634e7929541eC2318f3dCF7e; // Base Sepolia
        if (id == 421614)   return 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d; // Arbitrum Sepolia
        revert UnsupportedChain();
    }
}
