// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {SlotVaultTestBase} from "./SlotVault.t.sol";
import {SlotVault}         from "../SlotVault.sol";
import {MockUSDC}          from "./Slot.t.sol";

// ═══════════════════════════════════════════════════════════════════════════════
// White-hat attack attempts against SlotVault (v6, unchanged from v5).
// ═══════════════════════════════════════════════════════════════════════════════

contract WhiteHatVaultTest is SlotVaultTestBase {
    address internal thief = makeAddr("thief");

    /// A signed withdrawal from Arc testnet replayed on another chain id.
    function test_Attack_CrossChainReplay() public {
        SlotVault v = _funded(true, 1e6);
        (bytes memory pqSig, bytes memory ownerSig, uint256 deadline) = _withdrawSigs(v, payee, 1e6, 0, true);
        vm.chainId(5042); // Arc mainnet: same vault address, same nonce
        vm.expectRevert(SlotVault.BadPQSignature.selector);
        v.withdraw(payee, 1e6, 0, deadline, pqSig, ownerSig);
    }

    /// A rotate-key signature reused as a withdrawal (or vice versa).
    function test_Attack_CrossActionReplay() public {
        SlotVault v = _funded(true, 1e6);
        bytes32 rot = v.rotateDigest(pqKey2);
        bytes memory pqSig = _pqSign(pqKey, rot);
        bytes memory ownerSig = _ownerSign(rot);
        vm.expectRevert(SlotVault.BadPQSignature.selector);
        v.withdraw(thief, 1e6, 0, block.timestamp + 1, pqSig, ownerSig);
    }

    /// Changing the recipient or relayer fee of a signed withdrawal in flight.
    function test_Attack_TamperWithSignedWithdrawal() public {
        SlotVault v = _funded(true, 1e6);
        (bytes memory pqSig, bytes memory ownerSig, uint256 deadline) = _withdrawSigs(v, payee, 5e5, 0, true);
        vm.startPrank(thief);
        vm.expectRevert(SlotVault.BadPQSignature.selector);
        v.withdraw(thief, 5e5, 0, deadline, pqSig, ownerSig);
        vm.expectRevert(SlotVault.BadPQSignature.selector);
        v.withdraw(payee, 5e5, 5e5, deadline, pqSig, ownerSig);
        vm.stopPrank();
    }

    /// Owner-key thief races a recovery: the PQ key cancels, the old wallet
    /// signatures stay useless, and funds never move without the PQ key.
    function test_Attack_StolenOwnerKeyRecoveryRace() public {
        SlotVault v = _funded(true, 1e6);
        vm.prank(owner); // thief holds the owner key
        v.initiateRecovery(keccak256("thief-key"));
        v.cancelRecovery(_pqSign(pqKey, v.cancelDigest()));
        vm.warp(block.timestamp + DELAY + 1);
        vm.expectRevert(SlotVault.NoRecovery.selector);
        v.completeRecovery();
        assertEq(v.pqKey(), pqKey);
        assertEq(usdc.balanceOf(address(v)), 1e6);
    }

    /// AUDIT L-4 (accepted): a thief with the owner key can re-initiate after
    /// each cancel, forcing the PQ holder to keep cancelling — but never wins
    /// while they do, because every attempt restarts the full delay.
    function test_Attack_RecoveryReinitiationGriefingNeverCompletesEarly() public {
        SlotVault v = _funded(true, 1e6);
        for (uint256 i; i < 3; ++i) {
            vm.prank(owner);
            v.initiateRecovery(keccak256(abi.encode("thief-key", i)));
            vm.warp(block.timestamp + DELAY - 1);
            vm.expectRevert(SlotVault.RecoveryNotReady.selector);
            v.completeRecovery();
            v.cancelRecovery(_pqSign(pqKey, v.cancelDigest()));
        }
        assertEq(v.pqKey(), pqKey);
    }

    /// INFO: the relayer fee goes to whoever submits first, so a front-runner
    /// can take a relayer's fee. The signer's recipient and amount are safe.
    function test_Info_RelayerFeeGoesToFirstSubmitter() public {
        SlotVault v = _funded(true, 1e6);
        (bytes memory pqSig, bytes memory ownerSig, uint256 deadline) = _withdrawSigs(v, payee, 9e5, 1e5, true);
        vm.prank(thief);
        v.withdraw(payee, 9e5, 1e5, deadline, pqSig, ownerSig);
        assertEq(usdc.balanceOf(payee), 9e5, "payee still gets exactly what was signed");
        assertEq(usdc.balanceOf(thief), 1e5, "front-runner earns the relayer fee");
    }

    /// INFO (by design): off Arc there is no PQ precompile, so a vault there —
    /// which only ever holds wrong-chain funds — releases with the owner's
    /// signature over a raw digest alone.
    function test_Info_OffArcVaultReleasesWithOwnerSignatureOnly() public {
        vm.chainId(11155111);
        address sepoliaUsdc = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
        vm.etch(sepoliaUsdc, address(usdc).code);
        usdc = MockUSDC(sepoliaUsdc);
        SlotVault v = _funded(true, 1e6);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory ownerSig = _ownerSign(v.withdrawDigest(thief, 1e6, 0, deadline));
        v.withdraw(thief, 1e6, 0, deadline, "", ownerSig);
        assertEq(usdc.balanceOf(thief), 1e6);
    }
}
