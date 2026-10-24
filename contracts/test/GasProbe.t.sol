// SPDX-License-Identifier: MIT
// contracts/test/GasProbe.t.sol
pragma solidity ^0.8.20;
import {Test} from "forge-std/Test.sol";
import {VmSafe} from "forge-std/Vm.sol";

contract Probe {
    event Measured(uint256 gasUsed, uint256 gasPrice, uint256 cost18, uint256 cost6);
    function measure() external {
        uint256 g0 = gasleft();
        // burn roughly what a sweep burns: 3 cold SLOADs + 3 transfers
        uint256 x; for (uint256 i; i < 40; ++i) { x = uint256(keccak256(abi.encode(x, i))); }
        uint256 used = g0 - gasleft() + 21000;
        uint256 cost18 = used * tx.gasprice;
        emit Measured(used, tx.gasprice, cost18, cost18 / 1e12);
    }
}

contract GasProbeTest is Test {
    function test_Probe() public {
        vm.txGasPrice(21 gwei);           // Arc's 20 gwei floor + 1 gwei tip
        Probe p = new Probe();
        vm.recordLogs();
        p.measure();
        VmSafe.Log[] memory e = vm.getRecordedLogs();
        (uint256 used, uint256 price, uint256 c18, uint256 c6) =
            abi.decode(e[0].data, (uint256, uint256, uint256, uint256));
        emit log_named_uint("gasUsed", used);
        emit log_named_uint("tx.gasprice", price);
        emit log_named_uint("cost18 (wei)", c18);
        emit log_named_uint("cost6 (USDC micro)", c6);
        assertGt(price, 0, "tx.gasprice reads zero - self-funding sweep is dead");
        assertGt(c6, 0, "1e12 scaling truncates to zero");
    }
}
