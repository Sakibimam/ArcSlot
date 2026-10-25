# ArcSlot v6 Security Audit

**Date:** 2026-10-25
**Contracts audited (commit 24c0fb0):**
- `contracts/Slot.sol`
- `contracts/SlotFactory.sol`
- `contracts/SlotVault.sol`
- `contracts/VaultFactory.sol`
- `contracts/ChainConfig.sol`

**Deployed addresses:** see `DEPLOYMENTS.md`. VaultFactory and SlotVault are identical to v5.
SlotFactory and Slot were redeployed for v6.

**Preset:** max (all severity tiers)

**Tools used:** internal rule corpus (solidity-auditor + functional-auditor), Slither 0.11.x static analysis, Foundry PoC tests (`contracts/test/poc/AuditV6PoC.t.sol`)

> This review is based on an internal rule corpus and Slither and is NOT a substitute for an independent
> third-party audit before production deployment with real user funds.

---

## Summary

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 1 (new) |
| Medium | 1 (new) + 3 carried (Slither false positives) |
| Low | 1 re-opened (L-4) + 4 carried |
| Info | 2 carried |

---

## v5 Finding Status

| ID | Description | Status in v6 |
|---|---|---|
| H-1 | Front-run slot creation, attacker locks fee parameters | **Fixed** (see H-1 analysis below) |
| M-1 | Slither `reentrancy-balance` | Carried (false positive, unchanged) |
| M-2 | Slither `incorrect-equality` | Carried (false positive, unchanged) |
| M-3 | Slither `uninitialized-local` | Carried (false positive, unchanged) |
| L-1 | `resolveQuarantine` emits no event | **Fixed** - `QuarantineResolved` added |
| L-2 | `sweepMany` unbounded batch | Carried (NatSpec warning added, no code change) |
| L-3 | `block.timestamp` comparisons | Carried (negligible, unchanged) |
| L-4 | `initiateRecovery` can overwrite pending recovery | **Re-opened** - PoC confirms timer extension |
| L-5 | VaultFactory event after external call | Carried (unchanged) |
| L-6 | Unused return value from `ECDSA.tryRecover` | Carried (unchanged) |
| I-1 | Immutable factory config | Carried (by design) |
| I-2 | ChainConfig omits several testnets | Carried (by design) |

---

## New / Changed Findings

### [H-1 FIX] v5 front-run finding — verified fixed

**v5 problem:** `_salt(merchant, payRef)` meant an attacker could front-run at the merchant's expected slot address.

**v6 fix:** `_salt(creator, merchant, payRef)` binds the slot address to `msg.sender`. An attacker observing a pending `createSlot` and copying `(merchant, payRef)` lands on a **different address** because `creator` differs. The merchant's intended address (predicted with their own `msg.sender`) is never touched by the attacker.

**Verification:** `test_FrontRunnerLandsOnDifferentAddress` (PoC 1) confirms the two addresses are distinct and the merchant can still deploy at their predicted address even after the attacker front-runs.

**New concern introduced by the fix:** The `slots[merchant][payRef]` uniqueness mapping that existed in v5 is gone. Multiple creators can now deploy separate slots for the same `(merchant, payRef)`. This is an accepted design tradeoff documented in `DEPLOYMENTS.md`: the slot address is the canonical payment identifier. See M-1 (new) below.

---

### [C-1] Reverting-merchant permanent fund lock — no rescue path

**Severity:** Critical
**Status:** New finding (not present in v5 review)
**Location:** `Slot.sol` - `_sweep()` lines 281-290; `resolveQuarantine()` lines 313-329

**Description:**

`_sweep()` calls `safeTransfer(_merchant, net)` (and optionally `safeTransfer(_feeRecipient, fee)`). If either target address is a smart contract that reverts on receiving ERC-20 tokens — a proxy not yet initialised, a multisig with a misconfigured receive hook, a contract whose fallback reverts, or (on Arc) a precompile address that does not accept ERC-20 transfers — then `safeTransfer` propagates the revert and the entire sweep reverts.

The critical gap is that this condition does NOT trigger the USDC blacklist check, so `quarantined` is never set to `true`. Because `resolveQuarantine()` requires `quarantined == true`, the merchant has no on-chain path to redirect the funds to a working address. The slot accumulates USDC indefinitely with no rescue.

**Concrete attack scenarios:**

1. **Misconfigured contract merchant.** A merchant sets their payout address to a contract that upgrades or changes behaviour after slot creation (e.g. a proxy pointing to an implementation with no `transfer` receiver). All future sweeps revert silently. The merchant cannot call `resolveQuarantine` because `quarantined` is false.

2. **Precompile recipient on Arc.** Arc precompile addresses (e.g. `0x1800...0004`) can be passed as merchant or feeRecipient at create-time or at `resolveQuarantine` time; the non-zero check does not reject them. If the precompile reverts on receiving a transfer, the slot is permanently locked. This is harder to trigger in practice (a human would have to deliberately set a precompile address), but `resolveQuarantine` can be called by the current merchant with a new `newMerchant` set to any non-zero address, including a precompile — so a compromised or malicious merchant call can lock a slot post-quarantine.

**Impact:** USDC deposited into the affected slot is permanently inaccessible. There is no owner, no admin, no emergency withdrawal, and no upgrade path. Severity is rated Critical because funds are irretrievably lost.

**PoC:** `test_RevertingMerchantLocksSlotFunds` in `contracts/test/poc/AuditV6PoC.t.sol`. Output:
```
CONFIRMED: Slot with reverting merchant = permanent fund lock, no rescue path
```

**Suggested fix (two options):**

*Option A — Enter quarantine on transfer failure.* Wrap each `safeTransfer` in a try/catch-style pattern (not directly available for internal calls, but achievable with a helper contract or a low-level call that returns a bool). If the merchant transfer fails, set `quarantined = true` and emit the appropriate event. This allows the merchant to subsequently call `resolveQuarantine()` to replace the address.

*Option B — Validate recipient addresses at create/resolve time.* Reject known precompile ranges and optionally probe the recipient with a zero-value transfer (or a `code.length == 0` heuristic) before accepting the address. Simpler but less complete — it cannot anticipate every future reverting contract.

Option A is the stronger defense as it handles runtime failures from any cause.

---

### [H-2] SlotVault relayer fee is capturable by any front-runner

**Severity:** High
**Status:** New finding
**Location:** `SlotVault.sol` - `withdrawDigest()` line 100; `withdraw()` line 139

**Description:**

`withdrawDigest` encodes `(WITHDRAW_TAG, chainid, address(this), nonce, to, amount, relayerFee, deadline)`. The `msg.sender` who submits the transaction is not part of the signed payload. In `withdraw()`, `relayerFee` is transferred to `msg.sender` (line 139).

A mempool observer can copy the owner's signed payload and submit the same transaction with their own address as the origin. The first transaction to land receives `relayerFee`; the second gets `BadPQSignature` / `BadOwnerSignature` (nonce already incremented). The intended relayer is displaced and earns nothing. The main transfer (`to`, `amount`) is unaffected.

This is a practical attack on Arc: Arc has sub-second finality and visible mempool. Any bot scanning for `SlotVault.withdraw` calls can extract the fee reliably.

**Impact:** Relayer economics are broken. Relayer services operating for SlotVault users cannot reliably earn their fee. The vault owner still pays the fee (taken from vault balance) but the intended relayer does not receive it. Depending on relayer business model, this may prevent relayer services from operating at all.

**PoC:** `test_FrontRunnerStealRelayerFee` in `contracts/test/poc/AuditV6PoC.t.sol`. The test shows a front-runner capturing the full 5 USDC fee while the intended relayer receives zero. `test_NoncePreventsReplay` confirms the nonce protects against double-spend (the finding is fee-theft, not double-spend).

**Suggested fix:** Bind the executor in the signed digest:

```solidity
function withdrawDigest(
    address to,
    uint256 amount,
    uint256 relayerFee,
    uint256 deadline,
    address executor     // NEW: address that is allowed to submit
) public view returns (bytes32) {
    return keccak256(abi.encode(
        WITHDRAW_TAG, block.chainid, address(this), nonce,
        to, amount, relayerFee, deadline, executor
    ));
}
```

In `withdraw()`, require `msg.sender == executor` (or allow `executor == address(0)` to mean "anyone", which opts into the current behaviour for fully permissionless relaying). This is a breaking change to the digest format and requires a new deployment; any in-flight signed withdrawals would need to be re-signed.

---

### [M-1 new] (merchant, payRef) global uniqueness removed — lookalike slot risk

**Severity:** Medium
**Status:** New finding introduced by the H-1 fix
**Location:** `SlotFactory.sol` - `_salt()` line 303; `createSlot` / `createRequest` / `requestOf`

**Description:**

In v5, `slots[merchant][payRef]` was a mapping that guaranteed at most one slot per `(merchant, payRef)` pair. That mapping is absent in v6. Because `_salt` now commits to `(creator, merchant, payRef)`, N different callers can each deploy a distinct slot for the same `(merchant, payRef)`, all with different addresses, all legitimately forwarding to the same merchant.

There is no registry function that answers "show me all slots for this merchant+payRef". `requestOf(slot)` requires the slot address as input. `requestsOf(creator, offset, limit)` is scoped by creator. Off-chain tooling that uses `(merchant, payRef)` as a lookup key — rather than the slot address itself — cannot determine which slot is "real".

**Concrete risk:** A third party (not the merchant) creates a slot for the same `(merchant, payRef)` with `feeBps = 0` (all fees blocked off-Arc; on Arc they could be set to max 10%). On Arc, this third party could set `feeRecipient` to themselves. If a payer is deceived into paying the attacker's slot address, funds reach the real merchant minus the fee — the merchant receives less than expected and the attacker skims the fee.

**PoC:** `test_TwoCreatorsSameMerchantPayRef` and `test_NoGlobalUniquenessPerMerchantPayRef` in PoC 1 and PoC 3.

**Impact:** Social-engineering / UI spoofing risk. No protocol-level exploit if the payment link carries the slot address (not just merchant+payRef). Severity is Medium because it requires the payer to be deceived and the attacker to produce a convincing lookalike link.

**Suggested fix:** The simplest mitigation is to enforce "one canonical slot per merchant+payRef" by keeping an optional `canonicalSlot[merchant][payRef]` mapping that the merchant themselves can register. Alternatively, the app layer must always use the slot address as the payment identifier and provide a `predict(creator, merchant, payRef)` QR/link, not a plain `(merchant, payRef)` lookup.

---

## Carried Findings (status unchanged from v5)

### [M-1 slither] Reentrancy-balance (false positive)
Unchanged. `ReentrancyGuard` blocks reentry. Factory is trusted.

### [M-2 slither] Incorrect-equality on `gross == 0` (false positive)
Unchanged.

### [M-3 slither] Uninitialized local `reimbursement` (false positive)
Unchanged. Solidity 0.8.x defaults to 0.

### [L-2] `sweepMany` unbounded batch
Unchanged. NatSpec warning added in v6. No code change. Individual `sweep()` always available.

### [L-3] `block.timestamp` for deadlines and recovery delay
Unchanged. Negligible (12 s max drift on Arc, recovery minimum is 1 day).

### [L-4 re-opened] `initiateRecovery` resets timer indefinitely

**Severity:** Low (re-confirmed by PoC)
**Location:** `SlotVault.sol` - `initiateRecovery()` lines 176-181

In v5 this was flagged. It remains unfixed (deferred per `DEPLOYMENTS.md`) because fixing it would change vault bytecode and orphan existing vaults.

The owner wallet can call `initiateRecovery(newKey)` again at any time, resetting `recoveryReadyAt = block.timestamp + recoveryDelay`. If done repeatedly just before the delay expires, `completeRecovery()` can be blocked indefinitely. The PQ key holder must call `cancelRecovery()` with a fresh signature on each re-initiation to prevent completion.

**PoC:** `test_OwnerCanExtendRecoveryWindowIndefinitely` confirms the timer extends: first readyAt = 86,401 s, second readyAt = 172,800 s after one re-initiation.

**Impact:** If the PQ key is lost, the owner's legitimate recovery is inconvenienced (they must keep initiating until they stop). If the PQ key is contested (adversary controls it), they are forced to pay gas to cancel each re-initiation. No fund loss in either scenario.

### [L-5] VaultFactory emits VaultCreated after initialize call
Unchanged. Negligible. No callback risk in current initialize implementation.

### [L-6] Unused return value from ECDSA.tryRecover
Unchanged. errArg is intentionally discarded; err is checked.

### [I-1] Immutable factory configuration
Unchanged. By design.

### [I-2] ChainConfig omits some chains
Unchanged. By design.

---

## Slither Findings (v6)

Run: `slither . --filter-paths "node_modules,lib,test,script"` — 30 results across 53 contracts.

**High** (1): `reentrancy-balance` in `Slot._sweep` — false positive (M-1 from v5, unchanged).

**Medium** (3): `incorrect-equality`, `uninitialized-local`, `unused-return` — all false positives or accepted non-issues from v5.

**Low** (new/changed from v5):
- `calls-loop` in `sweepMany` — L-2 carried.
- `reentrancy-benign` in `createRequest` — state written after `_deploy` which calls `initialize`. Not exploitable because `_deploy` is internal and there is no cross-function reentry path. False positive.
- `reentrancy-events` (×4): events emitted after external calls in `_deploy`, `createRequest`, `VaultFactory.createVault`, `SlotVault.resolveSlotQuarantine`. Minor ordering concern; no exploit. L-5 carried.
- `timestamp` (×3) — L-3 carried.
- `low-level-calls` (×2): blacklist probe and PQ precompile probe. Both are intentional staticcall-based probes documented in NatSpec.
- `missing-inheritance`: `Slot` should inherit `ISlotQuarantine`; `SlotFactory` should inherit `ISlotFactoryStats`. Informational — the contracts satisfy the interfaces without the formal declaration. No exploit.
- `naming-convention` (×13): underscore-prefixed initialize parameters flagged as not mixedCase. Informational style note.

---

## Areas Checked and Found Clean (v6)

- **H-1 fix correctness.** The salt `keccak256(creator, merchant, payRef)` does bind the address to the creator. A mempool copy-cat lands on a different address and cannot claim the creator's predicted address. Verified by PoC.
- **Clone re-initialization.** `_initialised` flag prevents a second `initialize` call on any clone. The implementation contract itself can be initialized once (by any caller), which sets `factory = msg.sender` on the implementation — this does not affect clones but could confuse the implementation's `recordCollect` callback. However, `isSlot[implementation_address]` is false in the factory, so even a swept implementation would fail with `NotSlot`. No impact.
- **Collector leaderboard injection.** `isSlot[msg.sender]` guard prevents arbitrary contracts from writing to the leaderboard. Unchanged from v5.
- **VaultFactory salt uniqueness.** `keccak256(owner, pqKey, twoKey, recoveryDelay, salt)` still commits all parameters. No-one can pre-deploy the same vault address with different keys.
- **SlotVault replay.** Nonce increments on every authorized action. `cancelDigest` includes `pendingKey`, so a stale cancel signature (from when pendingKey was X) cannot cancel a new recovery (pendingKey = Y, different nonce and different digest). Verified by `test_NoncePreventsReplay`.
- **SlotVault off-Arc mode.** PQ is skipped off-Arc; only owner ECDSA required. Intentional for wrong-chain recovery vaults.
- **Gas reimbursement extraction.** Pricing at `min(tx.gasprice, block.basefee)` prevents priority-fee inflation. `maxReimbursement` cap enforced before transfers. No overflow possible (max `gas * price / 1e12` stays well within uint256). Unchanged from v5.
- **Arc native/ERC-20 double-counting.** No change from v5. All paths use only the 6-decimal ERC-20 view.
- **`sweepFor` via `sweepMany`.** Outer `msg.sender` is the factory; `sweepFor(msg.sender)` inside the slot routes the reimbursement to the `sweepMany` caller (forwarded as `rewardTo`). Correct.
- **Integer overflow.** `uint192` cast for `st.delivered` is practically safe (max ~6.3e51 USDC). Unchanged.

---

## PoC Test Results

All 10 PoC tests pass:

```
contracts/test/poc/AuditV6PoC.t.sol:PoC_H1_FixVerification
  [PASS] test_FrontRunnerLandsOnDifferentAddress
  [PASS] test_TwoCreatorsSameMerchantPayRef
  [PASS] test_LookalikeSlotIsDistinctAddress

contracts/test/poc/AuditV6PoC.t.sol:PoC_C1_RevertingMerchantLocksSlot
  [PASS] test_RevertingMerchantLocksSlotFunds
  [PASS] test_LockIsConditionalNotAlwaysPermanent

contracts/test/poc/AuditV6PoC.t.sol:PoC_M1_LookalikeSlots
  [PASS] test_NoGlobalUniquenessPerMerchantPayRef

contracts/test/poc/AuditV6PoC.t.sol:PoC_H2_RelayerFeeFrontRun
  [PASS] test_FrontRunnerStealRelayerFee
  [PASS] test_NoncePreventsReplay

contracts/test/poc/AuditV6PoC.t.sol:PoC_L4_RecoveryTimerReset
  [PASS] test_OwnerCanExtendRecoveryWindowIndefinitely
  [PASS] test_RecoveryCompletesIfOwnerStops

Ran 5 test suites: 10 passed, 0 failed, 0 skipped
```

---

## Scope

**In scope:** All logic in the five listed `.sol` files, including all internal functions, modifiers, events, errors, and the `ChainConfig` library.

**Out of scope:**
- Integration tests and unit test files (`contracts/test/`, `contracts/test-integration/`, `contracts/test/poc/`)
- Deploy scripts (`contracts/script/`)
- Frontend TypeScript code (`src/`)
- The Arc PQ precompile at `0x1800000000000000000000000000000000000004` (treated as a trusted black box)
- The Circle USDC FiatToken contract (treated as a trusted external dependency)
- On-chain collector bots or relayer implementations
- Mainnet economic analysis of `tip` / `minSweep` / `maxReimbursement` parameter choices

---

## Limitations

- All PoC tests run off-Arc (chainid = 11155111, Ethereum Sepolia). The precompile-recipient scenario (C-1) is demonstrated with a mock reverting contract rather than a live Arc precompile. Behaviour on a live Arc fork may differ in gas accounting but not in the structural finding.
- Slither is not a substitute for symbolic execution or formal verification.
- This review does not cover economic parameter correctness (`tip`, `minSweep`, `maxReimbursement`) or relayer viability under real Arc gas conditions.

---

## Audit Provenance

| Reviewer | Files audited | Notes |
|---|---|---|
| solidity-auditor (max) | 5 | Corpus rules: signed-payload-must-bind-intended-executor and full rule set |
| functional-auditor (max) | 5 | Functional, adversary-resistance, Arc-specific review |
| Slither 0.11.x | 5 | --filter-paths: node_modules, lib, test, script; 30 results |
| Foundry PoC | contracts/test/poc/AuditV6PoC.t.sol | 10 tests, 0 failures |
