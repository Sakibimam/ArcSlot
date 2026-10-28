# ArcSlot Contract Deployments

## Current (v9)

Deployed by the developer with `scripts/deploy-deterministic.mjs` (reads the key from `.env`, never from the
command line), via CREATE2 through the canonical deterministic deployer `0x4e59b44847b379578588920cA78FbF26c0B4956C`.
Arc Studio cannot sign on Arc mainnet and **did not deploy these contracts**; it audited v8 and wrote the v9 fix and
its tests ([`AUDIT-v8-mainnet.md`](AUDIT-v8-mainnet.md)). Because CREATE2 was used, the addresses are identical on every network.

| Contract | Address | Networks | Explorer |
|---|---|---|---|
| SlotFactory | `0x849eE5AEd72d1Ba5ADa092e0d68C4B2D161BE9c3` | Arc Testnet, Ethereum Sepolia | [Arc Testnet](https://explorer.testnet.arc.io/address/0x849eE5AEd72d1Ba5ADa092e0d68C4B2D161BE9c3) |
| Slot (implementation) | `0x5B4f7e9F90c404F4C4926D2d039218de34567566` | Arc Testnet, Ethereum Sepolia | [Arc Testnet](https://explorer.testnet.arc.io/address/0x5B4f7e9F90c404F4C4926D2d039218de34567566) |
| VaultFactory | `0x85154fE5e5F5d2e9d4f11ef3159EB5c451b1eB97` | Arc Testnet, Ethereum Sepolia | [Arc Testnet](https://explorer.testnet.arc.io/address/0x85154fE5e5F5d2e9d4f11ef3159EB5c451b1eB97) |
| SlotVault (implementation) | `0x192C03F98e1Bc1BbF6C50388A7D24ecFcb4280a0` | Arc Testnet, Ethereum Sepolia | [Arc Testnet](https://explorer.testnet.arc.io/address/0x192C03F98e1Bc1BbF6C50388A7D24ecFcb4280a0) |

VaultFactory and SlotVault are unchanged since v5 (same bytecode, same addresses), so existing vaults keep working.

### Arc mainnet (2026-10-28)

`Slot` and `SlotFactory` (v9) deployed to Arc mainnet (chain 5042) at the addresses above, from the developer's wallet
`0x30c7eE328B80ce1dc15AC8F75e1FfAf51B9bB9Fb` ([Slot tx](https://explorer.arc.io/tx/0xdcb4d777150fab4cb9a437b7c6d75475200db09c65351c97e321ef5602c730c6),
[SlotFactory tx](https://explorer.arc.io/tx/0x113ac1079a61e779dad6fa172bc9c1f1dafde1b3bd1be9aeed8992e804d647ed); 0.056 USDC gas).
On-chain runtime code is byte-identical to the tested testnet v9, and the implementation rejects `initialize()`.
The vault contracts are not deployed on mainnet.

First real payment through the live app: a 1 USDC request created, paid by a second wallet and collected
([create](https://explorer.arc.io/tx/0x5924e6e36f71feef3f673a72a1b8a696bb6748e55d09233ddfbf2635e0376439), [pay](https://explorer.arc.io/tx/0x4f127ddac1c210556e10183328a9d7678f683e5254b7be05f2f8826562a5b41c), [collect](https://explorer.arc.io/tx/0x84d17dde8c5392a9a6ed389ff49ef679e083467ea671efb57406bf3dff8b334c)).

### What changed in v9 (Arc Studio pre-mainnet audit)

- **M-1 fixed: the Slot implementation is locked.** Its constructor marks it initialised, so nobody can call
  `initialize()` on the implementation and make themselves its merchant. Clones are unaffected (own storage).
  Test-first: `contracts/test/HardeningV9.t.sol` failed on v8 and passes on v9; also checked live on testnet
  (`initialize` on the implementation reverts `AlreadyInitialised()`).
- The same test file guards the v8 removal of `resolveQuarantine` (Studio's H-1 suggested re-adding it, which would
  reintroduce the v7 blacklist bypass; it was reclassified Info).
- Only Slot and SlotFactory changed; v8 slots keep working through `LEGACY_FACTORY_ADDRESSES`.
- v8 (`0x4baEfA…EB49` / `0x136F85…8DE2`) is superseded.

### What changed in v8 (independent review of v7)

Every issue from the developer's independent attack review of v7 is fixed, test-first. Details and the stress-test results are in [`SECURITY-REVIEW.md`](SECURITY-REVIEW.md).

- **No blacklist bypass.** A blacklisted merchant's funds stay frozen in the slot until Circle clears the address. `resolveQuarantine` is gone, so nobody can rewrite a slot's payout or fee terms.
- **A blacklisted fee wallet no longer blocks the merchant.** The merchant is paid, and the fee is held in the slot until `releaseHeldFees()` can pay the original fee recipient.
- **Native USDC sends work on Arc.** Slots accept native USDC there and refuse native coins elsewhere. `rescueToken` returns any other token to the merchant.
- **Recovery no longer depends on the creator.** `recoverSlot(creator, merchant, payRef)` lets anyone redeploy a slot off Arc, always with no fee. `creatorOf` records each slot's creator.
- **Collector limits.** A collector can only claim a reward for itself, which ends griefing and leaderboard spoofing, and a reward never exceeds 10% of the payment.

### What changed in v7 (white-hat review)

Found by the developer's white-hat pass while checking Arc Studio's v6 audit ([`AUDIT-v6.md`](AUDIT-v6.md)); full write-up and triage in [`SECURITY-REVIEW.md`](SECURITY-REVIEW.md):

- `SlotFactory` rejects a blacklisted merchant or fee recipient (`BlacklistedPayout()`) — Circle blacklists even the USDC contract itself, and a slot paying out to it would quarantine forever.
- `Slot.resolveQuarantine` refuses the USDC contract or a blacklisted address as the new payout (`BadPayout()`).
- App: the pay page only accepts slots the factory deployed (`isSlot`), and the vault badge requires a genuine SlotVault clone.

### What changed in v6 (audit follow-up)

Arc Studio's security review ([`AUDIT.md`](AUDIT.md), run on v5) reported one high-severity finding. The fixes were
written by the developer, test-first, and are not part of Studio's report:

- **H-1 fixed — front-running slot creation.** The slot address now commits to its creator:
  `salt = keccak256(creator, merchant, payRef)` and `predict(creator, merchant, payRef)`. Copying a pending
  `createSlot`/`createRequest` with different fees, amount or label lands on a different address, and the
  merchant's own transaction still succeeds. Wrong-network recovery must be run by the same wallet that created
  the request; the app checks this before sending any transaction.
- **L-1 fixed** — `Slot.resolveQuarantine` emits `QuarantineResolved`.
- **L-2 documented** — `sweepMany` NatSpec warns that oversized batches can exceed the block gas limit.
- **Deferred:** L-4 (`initiateRecovery` re-initiation) and L-5 (event ordering in `VaultFactory`) are low/negligible
  and would change the vault contracts' addresses, orphaning existing vaults. M-1 to M-3 and L-3/L-6 are Slither
  notes the review itself marks as non-exploitable or false positives.

---

## Superseded

Do not reference these in the app or in tests.

| Version | Contract | Address | Networks | Deployed by | Why superseded |
|---|---|---|---|---|---|
| v7 | SlotFactory | `0xFe3356346e2978a4BeA738e37144Ad52F4C8b01A` | Arc Testnet, Ethereum Sepolia | developer's deterministic script | blacklisted merchants could redirect frozen funds (and other v7 review findings) |
| v7 | Slot impl | `0x5Cdd775C5D1C832f52136a20996AeE0040D299Da` | Arc Testnet, Ethereum Sepolia | developer's deterministic script | replaced with v8 Slot |
| v6 | SlotFactory | `0xCEc73Fb0a1B24C2Bd44126c7E9CAD93126A41151` | Arc Testnet, Ethereum Sepolia | developer's deterministic script | accepted blacklisted payouts (could lock funds) |
| v6 | Slot impl | `0xAF526cE35D261330efFa49E62413Ed80CEe5b82C` | Arc Testnet, Ethereum Sepolia | developer's deterministic script | replaced with v7 Slot |
| v5 | SlotFactory | `0xaaC460901F37E2c250732D1e208e660F23D8E156` | Arc Testnet, Ethereum Sepolia | developer's deterministic script | audit H-1: slot address not bound to its creator |
| v5 | Slot impl | `0x5154cec13C1B652FdA465D92fe74aA42FEadfC04` | Arc Testnet, Ethereum Sepolia | developer's deterministic script | replaced with v6 Slot |
| v1 | SlotFactory | `0x34163d378498caca5cfedd06995f5cee02a14a45` | Arc Testnet | Arc Studio | predates `maxReimbursement` and base-fee gas pricing |
| v1 | Slot impl | `0x5825d935aa33a6bc0213d43c1c15c887fec8a990` | Arc Testnet | Arc Studio | predates `maxReimbursement` and base-fee gas pricing |
