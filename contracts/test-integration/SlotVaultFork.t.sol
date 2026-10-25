// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test}             from "forge-std/Test.sol";
import {IERC20}           from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {SlotVault}        from "../SlotVault.sol";
import {VaultFactory}     from "../VaultFactory.sol";
import {SlotFactory}      from "../SlotFactory.sol";
import {Slot}             from "../Slot.sol";

/// Real post-quantum signatures (SLH-DSA-SHA2-128s via scripts/pq-sign.mjs)
/// verified by Arc's real PQ precompile on a fork. Needs --ffi.
contract SlotVaultForkTest is Test {
    IERC20  internal constant USDC  = IERC20(0x3600000000000000000000000000000000000000);
    uint256 internal constant DELAY = 7 days;
    string  internal constant SEED  = "0x5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e";

    VaultFactory internal vaults;
    uint256 internal ownerPk = 0xA11CE;
    address internal owner;
    address internal relayer = makeAddr("fork-relayer");
    address internal payee   = makeAddr("fork-payee");
    bytes32 internal pqKey;

    function setUp() public {
        owner  = vm.addr(ownerPk);
        vaults = new VaultFactory(address(new SlotVault()));
        pqKey  = bytes32(_ffi("vk", ""));
    }

    function _ffi(string memory cmd, bytes memory msg_) internal returns (bytes memory) {
        string[] memory a = new string[](msg_.length == 0 ? 4 : 5);
        a[0] = "node"; a[1] = "scripts/pq-sign.mjs"; a[2] = cmd; a[3] = SEED;
        if (msg_.length != 0) a[4] = vm.toString(msg_);
        return vm.ffi(a);
    }

    function _pqSign(bytes32 digest) internal returns (bytes memory) {
        return _ffi("sign", abi.encodePacked(digest));
    }

    function _ownerSign(bytes32 digest) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerPk, MessageHashUtils.toEthSignedMessageHash(digest));
        return abi.encodePacked(r, s, v);
    }

    function test_Fork_RealKeyShape() public view {
        assertTrue(pqKey != bytes32(0));
    }

    function test_Fork_RealPQSignatureWithdraws() public {
        SlotVault v = SlotVault(vaults.createVault(owner, pqKey, true, DELAY, bytes32("fork")));
        vm.deal(address(v), 2 ether); // 2 USDC (native view == ERC-20 view on Arc)

        uint256 dl = block.timestamp + 1 hours;
        bytes32 d = v.withdrawDigest(payee, 1_000_000, 10_000, dl);
        bytes memory pqSig = _pqSign(d);
        assertEq(pqSig.length, 7856, "SLH-DSA-SHA2-128s signature size");

        uint256 g0 = gasleft();
        vm.prank(relayer);
        v.withdraw(payee, 1_000_000, 10_000, dl, pqSig, _ownerSign(d));
        emit log_named_uint("withdraw gas (excl. calldata)", g0 - gasleft());

        assertEq(USDC.balanceOf(payee), 1_000_000);
        assertEq(USDC.balanceOf(relayer), 10_000);
    }

    function test_Fork_TamperedSignatureRejectedByArc() public {
        SlotVault v = SlotVault(vaults.createVault(owner, pqKey, true, DELAY, bytes32("fork2")));
        vm.deal(address(v), 2 ether);
        uint256 dl = block.timestamp + 1 hours;
        bytes32 d = v.withdrawDigest(payee, 1_000_000, 0, dl);
        bytes memory pqSig = _pqSign(d);
        pqSig[100] = bytes1(uint8(pqSig[100]) ^ 0x01); // flip one bit

        vm.expectRevert(SlotVault.BadPQSignature.selector);
        v.withdraw(payee, 1_000_000, 0, dl, pqSig, _ownerSign(d));
    }

    function test_Fork_SignatureForOtherAmountRejected() public {
        SlotVault v = SlotVault(vaults.createVault(owner, pqKey, true, DELAY, bytes32("fork3")));
        vm.deal(address(v), 2 ether);
        uint256 dl = block.timestamp + 1 hours;
        bytes memory pqSig = _pqSign(v.withdrawDigest(payee, 1, 0, dl));
        bytes32 bigger = v.withdrawDigest(payee, 1_000_000, 0, dl);

        vm.expectRevert(SlotVault.BadPQSignature.selector);
        v.withdraw(payee, 1_000_000, 0, dl, pqSig, _ownerSign(bigger));
    }

    /// End to end: payer -> Slot -> sweep into vault -> PQ-authorised withdrawal.
    function test_Fork_SlotPayoutIntoQuantumSafeVault() public {
        SlotVault v = SlotVault(vaults.createVault(owner, pqKey, true, DELAY, bytes32("fork4")));
        SlotFactory slots = new SlotFactory(address(new Slot()), 2_000, 100_000);
        address slot = slots.createSlot(address(v), keccak256("fork-inv"), 0, address(0), 50_000);

        address payer = makeAddr("fork-payer");
        vm.deal(payer, 5 ether);
        vm.prank(payer);
        assertTrue(USDC.transfer(slot, 1_000_000));

        vm.txGasPrice(block.basefee);
        vm.prank(relayer);
        Slot(slot).sweep();
        uint256 inVault = USDC.balanceOf(address(v));
        assertGt(inVault, 990_000, "payout missing");
        assertFalse(Slot(slot).quarantined(), "real blocklist probe failed for vault");

        uint256 dl = block.timestamp + 1 hours;
        bytes32 d = v.withdrawDigest(payee, inVault, 0, dl);
        v.withdraw(payee, inVault, 0, dl, _pqSign(d), _ownerSign(d));
        assertEq(USDC.balanceOf(payee), inVault);
    }

    function test_Fork_RecoveryCancelledByRealPQKey() public {
        SlotVault v = SlotVault(vaults.createVault(owner, pqKey, true, DELAY, bytes32("fork5")));
        vm.prank(owner);
        v.initiateRecovery(keccak256("thief-key"));
        vm.prank(relayer);
        v.cancelRecovery(_pqSign(v.cancelDigest()));
        assertEq(v.pendingKey(), bytes32(0));
    }
}
