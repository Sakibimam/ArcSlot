// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Clones}    from "@openzeppelin/contracts/proxy/Clones.sol";
import {SlotVault} from "./SlotVault.sol";

/// @title VaultFactory
/// @notice Deploys SlotVault minimal proxies at deterministic addresses.
///         The address commits to the owner, PQ key and every setting, so no
///         one can pre-deploy "your" vault address with a different key.
///         No owner, no admin, no upgrade path.
contract VaultFactory {
    using Clones for address;

    address public immutable implementation;
    address public immutable usdc;

    event VaultCreated(address indexed vault, address indexed owner, bytes32 indexed pqKey, bool twoKey, uint256 recoveryDelay);

    error ZeroImplementation();
    error ZeroUSDC();

    constructor(address _implementation, address _usdc) {
        if (_implementation == address(0)) revert ZeroImplementation();
        if (_usdc == address(0))           revert ZeroUSDC();
        implementation = _implementation;
        usdc           = _usdc;
    }

    function createVault(address owner, bytes32 pqKey, bool twoKey, uint256 recoveryDelay, bytes32 salt)
        external returns (address vault)
    {
        vault = implementation.cloneDeterministic(_salt(owner, pqKey, twoKey, recoveryDelay, salt));
        SlotVault(vault).initialize(usdc, owner, pqKey, twoKey, recoveryDelay);
        emit VaultCreated(vault, owner, pqKey, twoKey, recoveryDelay);
    }

    function predict(address owner, bytes32 pqKey, bool twoKey, uint256 recoveryDelay, bytes32 salt)
        external view returns (address)
    {
        return implementation.predictDeterministicAddress(_salt(owner, pqKey, twoKey, recoveryDelay, salt));
    }

    function _salt(address owner, bytes32 pqKey, bool twoKey, uint256 recoveryDelay, bytes32 salt)
        internal pure returns (bytes32)
    {
        return keccak256(abi.encode(owner, pqKey, twoKey, recoveryDelay, salt));
    }
}
