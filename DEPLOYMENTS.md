# ArcSlot Contract Deployments

## Current (v5)

These contracts were deployed by the developer using the repository's own deterministic deploy script
(`bun run deploy:deterministic`), via CREATE2 through the canonical deterministic deployer
`0x4e59b44847b379578588920cA78FbF26c0B4956C`. **Arc Studio did not deploy these contracts.**
Because CREATE2 was used, the addresses are identical on every supported network.

| Contract | Address | Networks | Explorer |
|---|---|---|---|
| SlotFactory | `0xaaC460901F37E2c250732D1e208e660F23D8E156` | Arc Testnet, Ethereum Sepolia | [Arc Testnet](https://explorer.testnet.arc.io/address/0xaaC460901F37E2c250732D1e208e660F23D8E156) |
| VaultFactory | `0x85154fE5e5F5d2e9d4f11ef3159EB5c451b1eB97` | Arc Testnet, Ethereum Sepolia | [Arc Testnet](https://explorer.testnet.arc.io/address/0x85154fE5e5F5d2e9d4f11ef3159EB5c451b1eB97) |
| Slot (implementation) | `0x5154cec13C1B652FdA465D92fe74aA42FEadfC04` | Arc Testnet, Ethereum Sepolia | [Arc Testnet](https://explorer.testnet.arc.io/address/0x5154cec13C1B652FdA465D92fe74aA42FEadfC04) |
| SlotVault (implementation) | `0x192C03F98e1Bc1BbF6C50388A7D24ecFcb4280a0` | Arc Testnet, Ethereum Sepolia | [Arc Testnet](https://explorer.testnet.arc.io/address/0x192C03F98e1Bc1BbF6C50388A7D24ecFcb4280a0) |

Bytecode confirmed present on Arc Testnet (via `eth_getCode` against `https://rpc.testnet.arc.io`):

| Contract | Bytecode size |
|---|---|
| SlotFactory | 6,592 bytes |
| VaultFactory | 1,420 bytes |
| Slot (implementation) | 3,779 bytes |
| SlotVault (implementation) | 4,910 bytes |

---

## Superseded (v1)

The two addresses below were deployed by Arc Studio during early development and are **no longer in
use**. Do not reference them in the app or in tests. They predate the `maxReimbursement` parameter
and the base-fee gas pricing model introduced in later versions.

| Contract | Address | Network |
|---|---|---|
| SlotFactory (v1) | `0x34163d378498caca5cfedd06995f5cee02a14a45` | Arc Testnet |
| Slot impl (v1) | `0x5825d935aa33a6bc0213d43c1c15c887fec8a990` | Arc Testnet |
