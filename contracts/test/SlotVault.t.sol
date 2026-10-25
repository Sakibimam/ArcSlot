// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test}               from "forge-std/Test.sol";
import {MessageHashUtils}   from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {SlotVault}          from "../SlotVault.sol";
import {VaultFactory}       from "../VaultFactory.sol";
import {SlotFactory}        from "../SlotFactory.sol";
import {Slot}               from "../Slot.sol";
import {MockUSDC}           from "./Slot.t.sol";

/// Stand-in for Arc's PQ precompile (0x1800..0004). A signature is "valid"
/// only if the test registered that exact (vk, message, sig) triple.
contract MockPQ {
    mapping(bytes32 => bool) public valid;

    function register(bytes calldata vk, bytes calldata message, bytes calldata sig) external {
        valid[keccak256(abi.encode(vk, message, sig))] = true;
    }

    function verifySlhDsaSha2128s(bytes calldata vk, bytes calldata message, bytes calldata sig)
        external view returns (bool)
    {
        return valid[keccak256(abi.encode(vk, message, sig))];
    }
}

contract SlotVaultTestBase is Test {
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000;
    address internal constant PQ       = 0x1800000000000000000000000000000000000004;
    uint256 internal constant DELAY    = 7 days;

    MockUSDC     internal usdc;
    MockPQ       internal pq;
    VaultFactory internal vaults;

    uint256 internal ownerPk = 0xA11CE;
    address internal owner;
    address internal relayer = makeAddr("relayer");
    address internal payee   = makeAddr("payee");

    bytes32 internal pqKey   = keccak256("pq-key-1");
    bytes32 internal pqKey2  = keccak256("pq-key-2");

    function setUp() public virtual {
        vm.chainId(5042002); // unit tests run as Arc testnet (ChainConfig)
        owner = vm.addr(ownerPk);
        vm.etch(ARC_USDC, address(new MockUSDC()).code);
        usdc = MockUSDC(ARC_USDC);
        vm.etch(PQ, address(new MockPQ()).code);
        pq = MockPQ(PQ);
        vaults = new VaultFactory(address(new SlotVault()));
    }

    // A fake-but-deterministic PQ signature over `digest` under `key`, registered as valid.
    function _pqSign(bytes32 key, bytes32 digest) internal returns (bytes memory sig) {
        sig = abi.encodePacked("slh-dsa", key, digest);
        pq.register(abi.encodePacked(key), abi.encodePacked(digest), sig);
    }

    function _ownerSign(bytes32 digest) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerPk, MessageHashUtils.toEthSignedMessageHash(digest));
        return abi.encodePacked(r, s, v);
    }

    function _vault(bool twoKey) internal returns (SlotVault v) {
        v = SlotVault(vaults.createVault(owner, pqKey, twoKey, DELAY, bytes32("salt")));
    }

    function _funded(bool twoKey, uint256 amount) internal returns (SlotVault v) {
        v = _vault(twoKey);
        usdc.mint(address(v), amount);
    }

    function _withdrawSigs(SlotVault v, address to, uint256 amount, uint256 fee, bool withOwner)
        internal returns (bytes memory pqSig, bytes memory ownerSig, uint256 deadline)
    {
        deadline = block.timestamp + 1 hours;
        bytes32 d = v.withdrawDigest(to, amount, fee, deadline);
        pqSig = _pqSign(v.pqKey(), d);
        ownerSig = withOwner ? _ownerSign(d) : bytes("");
    }
}

// ─── Factory ────────────────────────────────────────────────────────────────

contract VaultFactoryTest is SlotVaultTestBase {
    function test_PredictMatchesCreated() public {
        address predicted = vaults.predict(owner, pqKey, true, DELAY, bytes32("salt"));
        assertEq(address(_vault(true)), predicted);
    }

    /// The address commits to the key and settings, so nobody can pre-deploy
    /// "your" vault address with their own key.
    function test_AddressCommitsToKeyAndSettings() public {
        address mine = vaults.predict(owner, pqKey, true, DELAY, bytes32("salt"));
        assertTrue(mine != vaults.predict(owner, pqKey2, true, DELAY, bytes32("salt")), "key");
        assertTrue(mine != vaults.predict(owner, pqKey, false, DELAY, bytes32("salt")), "mode");
        assertTrue(mine != vaults.predict(owner, pqKey, true, DELAY + 1, bytes32("salt")), "delay");
        // An attacker deploying with their own key lands somewhere else.
        address theirs = vaults.createVault(owner, keccak256("attacker"), false, DELAY, bytes32("salt"));
        assertTrue(theirs != mine);
        assertEq(address(_vault(true)), mine);
    }

    function test_VaultIsInitialised() public {
        SlotVault v = _vault(true);
        assertEq(v.owner(), owner);
        assertEq(v.pqKey(), pqKey);
        assertTrue(v.twoKey());
        assertEq(v.recoveryDelay(), DELAY);
        assertEq(address(v.usdc()), ARC_USDC);
        assertEq(v.nonce(), 0);
    }

    function test_RejectsZeroOwnerOrKey() public {
        vm.expectRevert(SlotVault.ZeroOwner.selector);
        vaults.createVault(address(0), pqKey, true, DELAY, bytes32("a"));
        vm.expectRevert(SlotVault.ZeroKey.selector);
        vaults.createVault(owner, bytes32(0), true, DELAY, bytes32("b"));
    }

    function test_RejectsTooShortRecoveryDelay() public {
        vm.expectRevert(SlotVault.DelayTooShort.selector);
        vaults.createVault(owner, pqKey, true, 1 hours, bytes32("c"));
    }

    function test_CannotInitialiseTwice() public {
        SlotVault v = _vault(true);
        vm.expectRevert(SlotVault.AlreadyInitialised.selector);
        v.initialize(ARC_USDC, owner, pqKey2, false, DELAY);
    }
}

// ─── Withdrawals ────────────────────────────────────────────────────────────

contract VaultWithdrawTest is SlotVaultTestBase {
    function test_TwoKeyWithdrawRelayedByAnyone() public {
        SlotVault v = _funded(true, 1_000_000);
        (bytes memory pqSig, bytes memory ownerSig, uint256 dl) = _withdrawSigs(v, payee, 400_000, 5_000, true);

        vm.prank(relayer);
        v.withdraw(payee, 400_000, 5_000, dl, pqSig, ownerSig);

        assertEq(usdc.balanceOf(payee), 400_000, "payee");
        assertEq(usdc.balanceOf(relayer), 5_000, "relayer fee");
        assertEq(usdc.balanceOf(address(v)), 595_000, "vault rest");
        assertEq(v.nonce(), 1);
    }

    function test_TwoKeyRejectsMissingOwnerSignature() public {
        SlotVault v = _funded(true, 1_000_000);
        (bytes memory pqSig,, uint256 dl) = _withdrawSigs(v, payee, 400_000, 0, false);
        vm.expectRevert(SlotVault.BadOwnerSignature.selector);
        v.withdraw(payee, 400_000, 0, dl, pqSig, "");
    }

    /// A stolen wallet key alone cannot move funds.
    function test_StolenWalletKeyAloneCannotWithdraw() public {
        SlotVault v = _funded(true, 1_000_000);
        uint256 dl = block.timestamp + 1 hours;
        bytes32 d = v.withdrawDigest(payee, 400_000, 0, dl);
        bytes memory forgedPq = abi.encodePacked("not-a-real-signature", d);
        vm.expectRevert(SlotVault.BadPQSignature.selector);
        v.withdraw(payee, 400_000, 0, dl, forgedPq, _ownerSign(d));
    }

    /// A stolen PQ key alone cannot move funds in two-key mode.
    function test_StolenPQKeyAloneCannotWithdraw() public {
        SlotVault v = _funded(true, 1_000_000);
        (bytes memory pqSig,, uint256 dl) = _withdrawSigs(v, payee, 400_000, 0, false);
        (uint8 vv, bytes32 r, bytes32 s) = vm.sign(0xBAD, MessageHashUtils.toEthSignedMessageHash(
            v.withdrawDigest(payee, 400_000, 0, dl)));
        vm.expectRevert(SlotVault.BadOwnerSignature.selector);
        v.withdraw(payee, 400_000, 0, dl, pqSig, abi.encodePacked(r, s, vv));
    }

    function test_PQOnlyModeNeedsNoOwnerSignature() public {
        SlotVault v = _funded(false, 1_000_000);
        (bytes memory pqSig,, uint256 dl) = _withdrawSigs(v, payee, 400_000, 0, false);
        v.withdraw(payee, 400_000, 0, dl, pqSig, "");
        assertEq(usdc.balanceOf(payee), 400_000);
    }

    function test_SignatureCannotBeReplayed() public {
        SlotVault v = _funded(true, 1_000_000);
        (bytes memory pqSig, bytes memory ownerSig, uint256 dl) = _withdrawSigs(v, payee, 100_000, 0, true);
        v.withdraw(payee, 100_000, 0, dl, pqSig, ownerSig);
        vm.expectRevert(SlotVault.BadPQSignature.selector);
        v.withdraw(payee, 100_000, 0, dl, pqSig, ownerSig);
    }

    function test_SignatureBoundToParameters() public {
        SlotVault v = _funded(true, 1_000_000);
        (bytes memory pqSig, bytes memory ownerSig, uint256 dl) = _withdrawSigs(v, payee, 100_000, 0, true);
        vm.expectRevert(SlotVault.BadPQSignature.selector);
        v.withdraw(relayer, 100_000, 0, dl, pqSig, ownerSig);  // different recipient
        vm.expectRevert(SlotVault.BadPQSignature.selector);
        v.withdraw(payee, 900_000, 0, dl, pqSig, ownerSig);   // different amount
        vm.expectRevert(SlotVault.BadPQSignature.selector);
        v.withdraw(payee, 100_000, 50_000, dl, pqSig, ownerSig); // different fee
    }

    function test_SignatureBoundToVault() public {
        SlotVault a = _funded(true, 1_000_000);
        SlotVault b = SlotVault(vaults.createVault(owner, pqKey, true, DELAY, bytes32("other")));
        usdc.mint(address(b), 1_000_000);
        (bytes memory pqSig, bytes memory ownerSig, uint256 dl) = _withdrawSigs(a, payee, 100_000, 0, true);
        vm.expectRevert(SlotVault.BadPQSignature.selector);
        b.withdraw(payee, 100_000, 0, dl, pqSig, ownerSig);
    }

    function test_ExpiredSignatureRejected() public {
        SlotVault v = _funded(true, 1_000_000);
        (bytes memory pqSig, bytes memory ownerSig, uint256 dl) = _withdrawSigs(v, payee, 100_000, 0, true);
        vm.warp(dl + 1);
        vm.expectRevert(SlotVault.Expired.selector);
        v.withdraw(payee, 100_000, 0, dl, pqSig, ownerSig);
    }

    function test_RejectsBadRecipientOrAmount() public {
        SlotVault v = _funded(true, 1_000_000);
        uint256 dl = block.timestamp + 1 hours;
        vm.expectRevert(SlotVault.BadRecipient.selector);
        v.withdraw(address(0), 1, 0, dl, "", "");
        vm.expectRevert(SlotVault.BadRecipient.selector);
        v.withdraw(address(v), 1, 0, dl, "", "");
        vm.expectRevert(SlotVault.ZeroAmount.selector);
        v.withdraw(payee, 0, 0, dl, "", "");
    }

    function test_InsufficientBalanceReverts() public {
        SlotVault v = _funded(true, 100_000);
        (bytes memory pqSig, bytes memory ownerSig, uint256 dl) = _withdrawSigs(v, payee, 99_000, 5_000, true);
        vm.expectRevert(SlotVault.InsufficientBalance.selector);
        v.withdraw(payee, 99_000, 5_000, dl, pqSig, ownerSig);
    }

    /// If Arc's verifier is missing or misbehaves, the vault must fail closed.
    function test_FailsClosedWhenVerifierReverts() public {
        SlotVault v = _funded(true, 1_000_000);
        (bytes memory pqSig, bytes memory ownerSig, uint256 dl) = _withdrawSigs(v, payee, 100_000, 0, true);
        vm.etch(PQ, hex"60006000fd"); // PUSH1 0 PUSH1 0 REVERT
        vm.expectRevert(SlotVault.BadPQSignature.selector);
        v.withdraw(payee, 100_000, 0, dl, pqSig, ownerSig);
    }

    function test_FailsClosedWhenVerifierHasNoCode() public {
        SlotVault v = _funded(true, 1_000_000);
        (bytes memory pqSig, bytes memory ownerSig, uint256 dl) = _withdrawSigs(v, payee, 100_000, 0, true);
        vm.etch(PQ, "");
        vm.expectRevert(SlotVault.BadPQSignature.selector);
        v.withdraw(payee, 100_000, 0, dl, pqSig, ownerSig);
    }

    function test_EmitsWithdrawn() public {
        SlotVault v = _funded(true, 1_000_000);
        (bytes memory pqSig, bytes memory ownerSig, uint256 dl) = _withdrawSigs(v, payee, 100_000, 2_000, true);
        vm.expectEmit(true, true, false, true, address(v));
        emit SlotVault.Withdrawn(payee, relayer, 100_000, 2_000, 0);
        vm.prank(relayer);
        v.withdraw(payee, 100_000, 2_000, dl, pqSig, ownerSig);
    }

    function testFuzz_NoValueLeak(uint256 bal, uint256 amount, uint256 fee) public {
        bal    = bound(bal, 1, 1e15);
        amount = bound(amount, 1, bal);
        fee    = bound(fee, 0, bal - amount);
        SlotVault v = _funded(true, bal);
        (bytes memory pqSig, bytes memory ownerSig, uint256 dl) = _withdrawSigs(v, payee, amount, fee, true);
        vm.prank(relayer);
        v.withdraw(payee, amount, fee, dl, pqSig, ownerSig);
        assertEq(usdc.balanceOf(payee) + usdc.balanceOf(relayer) + usdc.balanceOf(address(v)), bal);
    }
}

// ─── Key rotation and recovery ──────────────────────────────────────────────

contract VaultRecoveryTest is SlotVaultTestBase {
    function test_RotateKeyWithBothSignatures() public {
        SlotVault v = _vault(true);
        bytes32 d = v.rotateDigest(pqKey2);
        v.rotateKey(pqKey2, _pqSign(pqKey, d), _ownerSign(d));
        assertEq(v.pqKey(), pqKey2);
        assertEq(v.nonce(), 1);
    }

    function test_RotateRejectsWrongPQKey() public {
        SlotVault v = _vault(true);
        bytes32 d = v.rotateDigest(pqKey2);
        bytes memory sigByNewKey = _pqSign(pqKey2, d);
        vm.expectRevert(SlotVault.BadPQSignature.selector);
        v.rotateKey(pqKey2, sigByNewKey, _ownerSign(d));
    }

    function test_OwnerRecoversLostKeyAfterDelay() public {
        SlotVault v = _funded(true, 1_000_000);
        vm.prank(owner);
        v.initiateRecovery(pqKey2);
        assertEq(v.pendingKey(), pqKey2);

        vm.expectRevert(SlotVault.RecoveryNotReady.selector);
        v.completeRecovery();

        vm.warp(block.timestamp + DELAY);
        v.completeRecovery(); // anyone can finalise
        assertEq(v.pqKey(), pqKey2);
        assertEq(v.pendingKey(), bytes32(0));
    }

    function test_OnlyOwnerCanInitiateRecovery() public {
        SlotVault v = _vault(true);
        vm.prank(relayer);
        vm.expectRevert(SlotVault.NotOwner.selector);
        v.initiateRecovery(pqKey2);
    }

    /// A thief with only the wallet key starts recovery; the PQ key holder cancels it.
    function test_PQKeyCancelsHostileRecovery() public {
        SlotVault v = _vault(true);
        vm.prank(owner);
        v.initiateRecovery(keccak256("attacker-key"));

        bytes32 d = v.cancelDigest();
        vm.prank(relayer);
        v.cancelRecovery(_pqSign(pqKey, d));

        assertEq(v.pendingKey(), bytes32(0));
        vm.warp(block.timestamp + DELAY);
        vm.expectRevert(SlotVault.NoRecovery.selector);
        v.completeRecovery();
        assertEq(v.pqKey(), pqKey);
    }

    function test_CompletedRecoveryInvalidatesOldSignatures() public {
        SlotVault v = _funded(true, 1_000_000);
        uint256 dl = block.timestamp + 30 days; // outlives the recovery delay
        bytes32 d = v.withdrawDigest(payee, 100_000, 0, dl);
        bytes memory pqSig = _pqSign(pqKey, d);
        bytes memory ownerSig = _ownerSign(d);
        vm.prank(owner);
        v.initiateRecovery(pqKey2);
        vm.warp(block.timestamp + DELAY);
        v.completeRecovery();
        vm.expectRevert(SlotVault.BadPQSignature.selector);
        v.withdraw(payee, 100_000, 0, dl, pqSig, ownerSig);
    }

    function test_CancelRequiresPendingRecovery() public {
        SlotVault v = _vault(true);
        bytes32 d = v.cancelDigest();
        bytes memory sig = _pqSign(pqKey, d);
        vm.expectRevert(SlotVault.NoRecovery.selector);
        v.cancelRecovery(sig);
    }
}

// ─── Slot payouts land in the vault ─────────────────────────────────────────

contract VaultAsSlotMerchantTest is SlotVaultTestBase {
    function test_SlotSweepsIntoVaultThenQuantumSafeWithdraw() public {
        SlotVault v = _vault(true);
        SlotFactory slots = new SlotFactory(address(new Slot()), 2_000, 100_000);
        address slot = slots.createSlot(address(v), keccak256("inv-1"), 0, address(0), 50_000);
        usdc.mint(slot, 1_000_000);

        vm.prank(relayer);
        Slot(payable(slot)).sweep();
        uint256 inVault = usdc.balanceOf(address(v));
        assertGt(inVault, 900_000, "payout did not reach vault");

        (bytes memory pqSig, bytes memory ownerSig, uint256 dl) = _withdrawSigs(v, payee, inVault, 0, true);
        v.withdraw(payee, inVault, 0, dl, pqSig, ownerSig);
        assertEq(usdc.balanceOf(payee), inVault);
    }
}

// ─── v8: a vault-owned Slot cannot be redirected, even with both keys ──────

contract VaultOwnedSlotBlacklistTest is SlotVaultTestBase {
    SlotFactory internal slots;
    address internal feeTo = makeAddr("feeTo");

    function setUp() public override {
        super.setUp();
        slots = new SlotFactory(address(new Slot()), 2_000, 100_000);
    }

    /// A blacklisted fee wallet no longer strands the vault's money: the vault
    /// is paid and the fee is held for the fee wallet.
    function test_FeeWalletBlacklisted_VaultStillPaid() public {
        SlotVault v = _vault(true);
        address slot = slots.createSlot(address(v), keccak256("inv-q"), 250, feeTo, 50_000);
        usdc.mint(slot, 1_000_000);
        usdc.setBlacklisted(feeTo, true);
        vm.prank(relayer);
        Slot(payable(slot)).sweep();
        assertFalse(Slot(payable(slot)).quarantined());
        assertEq(Slot(payable(slot)).heldFees(), 25_000);
        assertGt(usdc.balanceOf(address(v)), 900_000);
    }

    /// AUDIT (v7 A-1): a blacklisted vault used resolveSlotQuarantine, relayed by
    /// anyone, to move frozen funds to a clean wallet. That path is now dead.
    function test_BlacklistedVaultCannotRedirectFrozenFunds() public {
        SlotVault v = _vault(true);
        address slot = slots.createSlot(address(v), keccak256("inv-b"), 0, address(0), 50_000);
        usdc.mint(slot, 1_000_000);
        usdc.setBlacklisted(address(v), true);
        Slot(payable(slot)).sweep();
        assertTrue(Slot(payable(slot)).quarantined());

        address clean = makeAddr("clean");
        bytes32 d = v.resolveDigest(slot, clean, address(0), 0);
        bytes memory pqSig = _pqSign(pqKey, d);
        bytes memory ownerSig = _ownerSign(d);
        vm.prank(relayer);
        vm.expectRevert();
        v.resolveSlotQuarantine(slot, clean, address(0), 0, pqSig, ownerSig);
        assertEq(usdc.balanceOf(slot), 1_000_000, "frozen funds moved");
        assertEq(usdc.balanceOf(clean), 0);
    }
}
