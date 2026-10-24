// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Slot}   from "./Slot.sol";

/// @title SlotFactory
/// @notice Deploys EIP-1167 minimal-proxy Slot instances deterministically.
///         No owner, no admin, no pause, no upgrade path.
contract SlotFactory {
    using Clones for address;

    // ─── State ─────────────────────────────────────────────────────────────────
    address public immutable implementation;

    /// @dev merchant => reference => slot address (non-zero once deployed)
    mapping(address => mapping(bytes32 => address)) public slots;

    // ─── Events ────────────────────────────────────────────────────────────────
    event SlotCreated(
        address indexed slot,
        address indexed merchant,
        bytes32 indexed reference,
        uint16  feeBps,
        address feeRecipient
    );

    // ─── Errors ────────────────────────────────────────────────────────────────
    error ZeroMerchant();
    error ZeroFeeRecipient();
    error FeeBpsTooHigh();
    error ReferenceAlreadyUsed();

    // ─── Constructor ───────────────────────────────────────────────────────────
    constructor() {
        implementation = address(new Slot());
    }

    // ─── Public interface ──────────────────────────────────────────────────────

    /// @notice Deploy a new Slot clone for (merchant, reference).
    /// @param merchant       Address that will receive swept USDC.
    /// @param reference      Off-chain payment reference; unique per merchant.
    /// @param feeBps         Fee in basis points (0–1000, i.e. 0–10 %).
    /// @param feeRecipient   Receives the fee portion; must be non-zero when feeBps > 0.
    /// @return slot          Address of the newly-deployed Slot clone.
    function createSlot(
        address merchant,
        bytes32 reference,
        uint16  feeBps,
        address feeRecipient
    ) external returns (address slot) {
        // ── Validate ──
        if (merchant == address(0))               revert ZeroMerchant();
        if (feeBps > 1000)                        revert FeeBpsTooHigh();
        if (feeBps > 0 && feeRecipient == address(0)) revert ZeroFeeRecipient();
        if (slots[merchant][reference] != address(0)) revert ReferenceAlreadyUsed();

        // ── Deploy ──
        bytes32 salt = _salt(merchant, reference);
        slot = implementation.cloneDeterministic(salt);

        // ── Record before external call (CEI) ──
        slots[merchant][reference] = slot;

        // ── Initialise ──
        Slot(slot).initialize(merchant, reference, feeBps, feeRecipient);

        emit SlotCreated(slot, merchant, reference, feeBps, feeRecipient);
    }

    /// @notice Predict the address a Slot clone would get for (merchant, reference)
    ///         without deploying it. Returns the same address createSlot would produce.
    function predict(address merchant, bytes32 reference)
        external
        view
        returns (address)
    {
        return implementation.predictDeterministicAddress(_salt(merchant, reference));
    }

    // ─── Internal ──────────────────────────────────────────────────────────────

    function _salt(address merchant, bytes32 reference) internal pure returns (bytes32) {
        return keccak256(abi.encode(merchant, reference));
    }
}
