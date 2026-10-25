// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20}           from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}        from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA}            from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ChainConfig}      from "./ChainConfig.sol";

interface ISlotQuarantine {
    function resolveQuarantine(address newMerchant, address newFeeRecipient, uint16 newFeeBps) external;
}

/// @title SlotVault
/// @notice A USDC vault for a merchant's Slot payouts whose spending is
///         authorised by a post-quantum SLH-DSA-SHA2-128s signature (FIPS 205),
///         verified by Arc's PQ precompile at 0x1800..0004.
///
///         Modes:
///         - two-key: every spend needs the PQ signature AND the owner wallet's
///           signature, so a stolen wallet key or a stolen PQ key alone cannot
///           move funds. Circle recommends pairing PQ with classical signatures.
///         - PQ-only: the PQ signature alone authorises spends.
///
///         Spends are signed messages, so anyone can submit them (gasless for
///         the merchant); the signer fixes the relayer's fee.
///
///         Recovery: the owner wallet can propose a new PQ key, which takes
///         effect only after `recoveryDelay`. The current PQ key can cancel it
///         in the meantime, so a thief holding only the wallet key loses.
///
///         Arc specifics: only the 6-decimal ERC-20 view of USDC is used, nothing
///         is payable, zero-address transfers are rejected up front.
contract SlotVault {
    using SafeERC20 for IERC20;

    address internal constant PQ_PRECOMPILE = 0x1800000000000000000000000000000000000004;
    uint256 public constant MIN_RECOVERY_DELAY = 1 days;

    bytes32 internal constant WITHDRAW_TAG = keccak256("SlotVault.withdraw.v1");
    bytes32 internal constant ROTATE_TAG   = keccak256("SlotVault.rotate.v1");
    bytes32 internal constant CANCEL_TAG   = keccak256("SlotVault.cancelRecovery.v1");
    bytes32 internal constant RESOLVE_TAG  = keccak256("SlotVault.resolveQuarantine.v1");

    IERC20  public usdc;
    address public owner;
    /// @notice SLH-DSA-SHA2-128s verifying key (32 bytes).
    bytes32 public pqKey;
    bool    public twoKey;
    uint256 public recoveryDelay;
    /// @notice Increments on every authorised action; binds every signature to one use.
    uint256 public nonce;

    bytes32 public pendingKey;
    uint256 public recoveryReadyAt;

    bool private _initialised;

    event Withdrawn(address indexed to, address indexed relayer, uint256 amount, uint256 relayerFee, uint256 nonce);
    event KeyRotated(bytes32 indexed oldKey, bytes32 indexed newKey);
    event RecoveryInitiated(bytes32 indexed newKey, uint256 readyAt);
    event RecoveryCancelled(bytes32 indexed cancelledKey);
    event RecoveryCompleted(bytes32 indexed newKey);
    event SlotQuarantineResolved(address indexed slot, address newMerchant, address newFeeRecipient, uint16 newFeeBps);

    error AlreadyInitialised();
    error ZeroOwner();
    error ZeroKey();
    error ZeroUSDC();
    error DelayTooShort();
    error BadRecipient();
    error ZeroAmount();
    error Expired();
    error BadPQSignature();
    error BadOwnerSignature();
    error InsufficientBalance();
    error NotOwner();
    error NoRecovery();
    error RecoveryNotReady();

    function initialize(address _usdc, address _owner, bytes32 _pqKey, bool _twoKey, uint256 _recoveryDelay) external {
        if (_initialised)                         revert AlreadyInitialised();
        if (_usdc == address(0))                  revert ZeroUSDC();
        if (_owner == address(0))                 revert ZeroOwner();
        if (_pqKey == bytes32(0))                 revert ZeroKey();
        if (_recoveryDelay < MIN_RECOVERY_DELAY)  revert DelayTooShort();
        _initialised  = true;
        usdc          = IERC20(_usdc);
        owner         = _owner;
        pqKey         = _pqKey;
        twoKey        = _twoKey;
        recoveryDelay = _recoveryDelay;
    }

    // ─── Digests (what the keys sign) ─────────────────────────────────────────

    function withdrawDigest(address to, uint256 amount, uint256 relayerFee, uint256 deadline)
        public view returns (bytes32)
    {
        return keccak256(abi.encode(WITHDRAW_TAG, block.chainid, address(this), nonce, to, amount, relayerFee, deadline));
    }

    function rotateDigest(bytes32 newKey) public view returns (bytes32) {
        return keccak256(abi.encode(ROTATE_TAG, block.chainid, address(this), nonce, newKey));
    }

    function resolveDigest(address slot, address newMerchant, address newFeeRecipient, uint16 newFeeBps)
        public view returns (bytes32)
    {
        return keccak256(abi.encode(RESOLVE_TAG, block.chainid, address(this), nonce, slot, newMerchant, newFeeRecipient, newFeeBps));
    }

    function cancelDigest() public view returns (bytes32) {
        return keccak256(abi.encode(CANCEL_TAG, block.chainid, address(this), nonce, pendingKey));
    }

    // ─── Spending ─────────────────────────────────────────────────────────────

    /// @notice Send `amount` to `to`, paying `relayerFee` to whoever submits.
    function withdraw(
        address to,
        uint256 amount,
        uint256 relayerFee,
        uint256 deadline,
        bytes calldata pqSig,
        bytes calldata ownerSig
    ) external {
        if (to == address(0) || to == address(this)) revert BadRecipient();
        if (amount == 0)                             revert ZeroAmount();
        if (block.timestamp > deadline)              revert Expired();

        _authorise(withdrawDigest(to, amount, relayerFee, deadline), pqSig, ownerSig);

        IERC20 _usdc = usdc;
        if (_usdc.balanceOf(address(this)) < amount + relayerFee) revert InsufficientBalance();

        uint256 used = nonce++;
        _usdc.safeTransfer(to, amount);
        if (relayerFee > 0) _usdc.safeTransfer(msg.sender, relayerFee);
        emit Withdrawn(to, msg.sender, amount, relayerFee, used);
    }

    // ─── Slots owned by this vault ────────────────────────────────────────────

    /// @notice Resolve quarantine on a Slot whose merchant is this vault.
    ///         Without it, a quarantined Slot paying into a vault would be stuck,
    ///         because only the merchant may call Slot.resolveQuarantine.
    function resolveSlotQuarantine(
        address slot,
        address newMerchant,
        address newFeeRecipient,
        uint16  newFeeBps,
        bytes calldata pqSig,
        bytes calldata ownerSig
    ) external {
        _authorise(resolveDigest(slot, newMerchant, newFeeRecipient, newFeeBps), pqSig, ownerSig);
        nonce++;
        ISlotQuarantine(slot).resolveQuarantine(newMerchant, newFeeRecipient, newFeeBps);
        emit SlotQuarantineResolved(slot, newMerchant, newFeeRecipient, newFeeBps);
    }

    // ─── Key management ───────────────────────────────────────────────────────

    /// @notice Replace the PQ key, authorised by the current key (and owner in two-key mode).
    function rotateKey(bytes32 newKey, bytes calldata pqSig, bytes calldata ownerSig) external {
        if (newKey == bytes32(0)) revert ZeroKey();
        _authorise(rotateDigest(newKey), pqSig, ownerSig);
        bytes32 old = pqKey;
        pqKey = newKey;
        _clearRecovery();
        nonce++;
        emit KeyRotated(old, newKey);
    }

    /// @notice Owner wallet proposes a new PQ key (e.g. the old one was lost).
    function initiateRecovery(bytes32 newKey) external {
        if (msg.sender != owner)  revert NotOwner();
        if (newKey == bytes32(0)) revert ZeroKey();
        pendingKey      = newKey;
        recoveryReadyAt = block.timestamp + recoveryDelay;
        emit RecoveryInitiated(newKey, recoveryReadyAt);
    }

    /// @notice The current PQ key vetoes a pending recovery. Anyone may submit it.
    function cancelRecovery(bytes calldata pqSig) external {
        bytes32 cancelled = pendingKey;
        if (cancelled == bytes32(0)) revert NoRecovery();
        if (!_pqValid(cancelDigest(), pqSig)) revert BadPQSignature();
        _clearRecovery();
        nonce++;
        emit RecoveryCancelled(cancelled);
    }

    /// @notice Finalise a recovery once the delay has passed. Anyone may call.
    function completeRecovery() external {
        bytes32 newKey = pendingKey;
        if (newKey == bytes32(0))                 revert NoRecovery();
        if (block.timestamp < recoveryReadyAt)    revert RecoveryNotReady();
        bytes32 old = pqKey;
        pqKey = newKey;
        _clearRecovery();
        nonce++; // every signature made under the old key is now dead
        emit RecoveryCompleted(newKey);
        emit KeyRotated(old, newKey);
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _authorise(bytes32 digest, bytes calldata pqSig, bytes calldata ownerSig) internal view {
        // Off Arc there is no PQ precompile; a vault there only holds funds
        // recovered from a wrong-chain payment, released by the owner wallet.
        bool onArc = ChainConfig.isArc();
        if (onArc && !_pqValid(digest, pqSig)) revert BadPQSignature();
        if (twoKey || !onArc) {
            (address signer, ECDSA.RecoverError err,) =
                ECDSA.tryRecover(MessageHashUtils.toEthSignedMessageHash(digest), ownerSig);
            if (err != ECDSA.RecoverError.NoError || signer != owner) revert BadOwnerSignature();
        }
    }

    /// @dev Fail closed: a revert, missing code, or malformed return all mean "invalid".
    function _pqValid(bytes32 digest, bytes calldata sig) internal view returns (bool) {
        (bool ok, bytes memory ret) = PQ_PRECOMPILE.staticcall(
            abi.encodeWithSignature(
                "verifySlhDsaSha2128s(bytes,bytes,bytes)",
                abi.encodePacked(pqKey),
                abi.encodePacked(digest),
                sig
            )
        );
        return ok && ret.length >= 32 && abi.decode(ret, (bool));
    }

    function _clearRecovery() internal {
        pendingKey      = bytes32(0);
        recoveryReadyAt = 0;
    }
}
