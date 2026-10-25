// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Clones}    from "@openzeppelin/contracts/proxy/Clones.sol";
import {SlotVault} from "./SlotVault.sol";
import {ChainConfig} from "./ChainConfig.sol";

/// @title VaultFactory
/// @notice Deploys SlotVault minimal proxies at deterministic addresses.
///         The address commits to the owner, PQ key and every setting, so no
///         one can pre-deploy "your" vault address with a different key.
///         No owner, no admin, no upgrade path.
contract VaultFactory {
    using Clones for address;

    address public immutable implementation;

    event VaultCreated(address indexed vault, address indexed owner, bytes32 indexed pqKey, bool twoKey, uint256 recoveryDelay);

    error ZeroImplementation();

    /// @dev No chain-specific constructor args, so a deterministic deploy gives
    ///      the same factory (and vault) addresses on every chain.
    constructor(address _implementation) {
        if (_implementation == address(0)) revert ZeroImplementation();
        implementation = _implementation;
    }

    /// @notice Circle USDC on this chain.
    function usdc() public view returns (address) {
        return ChainConfig.usdc();
    }

    function createVault(address owner, bytes32 pqKey, bool twoKey, uint256 recoveryDelay, bytes32 salt)
        external returns (address vault)
    {
        vault = implementation.cloneDeterministic(_salt(owner, pqKey, twoKey, recoveryDelay, salt));
        SlotVault(vault).initialize(ChainConfig.usdc(), owner, pqKey, twoKey, recoveryDelay);
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
