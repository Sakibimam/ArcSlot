# ArcSlot v5 Security Audit

**Date:** 2026-10-25
**Contracts audited:**
- `contracts/Slot.sol`
- `contracts/SlotFactory.sol`
- `contracts/SlotVault.sol`
- `contracts/VaultFactory.sol`
- `contracts/ChainConfig.sol`

**Deployed addresses (Arc Testnet / Ethereum Sepolia — same on both via CREATE2):**
See `DEPLOYMENTS.md`.

**Preset:** balanced (Critical + High severity findings)

**Tools used:** internal rule corpus (solidity-auditor + functional-auditor), Slither 0.11.x static analysis

> This review is based on an internal rule corpus and Slither and is NOT a substitute for an independent third-party audit before production deployment with real user funds.

---

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 1 |
| Medium | 3 |
| Low | 6 |
| Info | 2 |

---

## High Findings

### [H-1] Any caller can front-run slot creation and lock in attacker-chosen fee parameters

**Location:** `SlotFactory.sol` — `createSlot()`, `createRequest()`, `_deploy()` (lines 137–273)

**Description:**
`createSlot` and `createRequest` are fully permissionless: any caller may pass any `merchant` address as a parameter. The CREATE2 salt commits only to `(merchant, payRef)`, not to `feeBps`, `feeRecipient`, or `maxReimbursement`. The `ReferenceAlreadyUsed` guard prevents a second creation for the same `(merchant, payRef)` pair, so the first writer permanently fixes the slot's economics.

A mempool attacker watching for a merchant's `createSlot` transaction can copy `(merchant, payRef)` from the pending transaction and front-run it with `feeBps=1000` (10%) to an attacker-controlled `feeRecipient`, diverting up to 10% of all future payments into that slot. On Arc's EIP-1559 chain (base fee visible pre-confirmation), this is practical.

**Impact:**
All funds deposited into the affected slot are silently siphoned by up to 10% until the merchant notices. The merchant has no on-chain way to recover — the slot is immutable after creation, and quarantine only allows merchant/feeRecipient changes on a blacklisted address path.

**Note on off-Arc chains:** `feeBps > 0` is blocked off Arc (`FeeNotAllowedOffArc`), so this attack only applies on Arc chains.

**Suggested fix (two options; either suffices):**

_Option A — Bind creation to the merchant._ Require `merchant == msg.sender`, or accept an EIP-712 signature from `merchant` over `(merchant, payRef, feeBps, feeRecipient, maxReimbursement, chainId)`. Third-party creation (e.g., a payment provider creating slots on behalf of merchants) is preserved by the signature path.

_Option B — Include fee parameters in the uniqueness key._ Extend `_salt` to `keccak256(abi.encode(merchant, payRef, feeBps, feeRecipient, maxReimbursement))`. An attacker can still deploy a same-`(merchant, payRef)` slot with different fees at a different address, but the merchant's intended slot (their parameters hashed into their expected address) cannot be hijacked. Payment links must carry enough info to verify the expected address.

Option A is the stronger defense; Option B makes the attack economically useless without requiring the merchant to sign.

---

## Medium Findings

### [M-1] Slither: `reentrancy-balance` — balance read before `recordCollect` external call

**Location:** `Slot.sol` — `_sweep()` lines 217 and 261

**Description:**
Slither flags that the USDC balance is read at line 217, and then an external call to `ISlotFactoryStats(factory).recordCollect(rewardTo, gross)` is made at line 261, before the final transfers. If `factory` were a malicious or compromised contract, it could in theory re-enter `_sweep()`. In practice, `ReentrancyGuard` (`nonReentrant` on `sweep()` and `sweepFor()`) blocks reentrant calls, and `factory` is set to `msg.sender` at initialization from the trusted SlotFactory. This is not exploitable in the deployed code, but the pattern merits documentation.

**Impact:** Low in practice given `ReentrancyGuard` and the fixed factory. If the factory contract were ever replaced or if a clone's `factory` slot were set to an untrusted address, this could become exploitable.

**Suggested fix:** No code change required given the current trusted-factory invariant and `ReentrancyGuard`. Consider adding a `factory` immutability note to the Slot NatSpec. If `recordCollect` is moved after all transfers, the Slither flag disappears.

### [M-2] Slither: `incorrect-equality` — strict `== 0` comparison on balance

**Location:** `Slot.sol` — `_sweep()` line 218: `if (gross == 0) revert NothingToSweep()`

**Description:**
Slither flags strict equality on a value derived from an external call. For ERC-20 balance this is actually safe: a balance of exactly zero means nothing to sweep, and a USDC token that returns a non-zero balance when empty is a non-issue. This is a Slither false positive.

**Impact:** None.

**Suggested fix:** No change needed. Accepted false positive.

### [M-3] Slither: `uninitialized-local` — `reimbursement` local variable

**Location:** `Slot.sol` — `_sweep()` line 256: `uint256 reimbursement;`

**Description:**
Slither flags the uninitialized local. In Solidity 0.8.x, a `uint256` local defaults to 0, and the code path that leaves it 0 (when `rewardTo == _merchant` or off-Arc) correctly results in no transfer (`if (reimbursement > 0)`). This is a Slither false positive.

**Impact:** None.

**Suggested fix:** For clarity and to silence the tool, initialize explicitly: `uint256 reimbursement = 0;`. Zero-cost in the compiler.

---

## Low Findings

### [L-1] `resolveQuarantine` emits no event

**Location:** `Slot.sol` — `resolveQuarantine()` lines 304–319

**Description:**
Slither flags that `resolveQuarantine` modifies `merchant`, `feeRecipient`, and `feeBps` but emits no event. Off-chain monitors (Circle compliance tooling, merchant dashboards) cannot detect a quarantine resolution without polling state.

**Impact:** Reduced observability; compliance tooling may miss a merchant/feeRecipient change.

**Suggested fix:** Add a `QuarantineResolved(address indexed slot, bytes32 indexed payRef_, address newMerchant, address newFeeRecipient, uint16 newFeeBps)` event emitted at the end of `resolveQuarantine`.

### [L-2] `sweepMany` makes external calls inside a loop (no gas cap per slot)

**Location:** `SlotFactory.sol` — `sweepMany()` lines 288–300

**Description:**
Each iteration calls `Slot.sweepFor(msg.sender)` with unbounded gas. A very large batch can exceed the block gas limit, causing the entire `sweepMany` transaction to fail. The `try/catch` pattern protects against one slot reverting and blocking others, but does not protect against running out of gas entirely.

**Impact:** Denial-of-service on batch sweeping when the array is too large. No fund loss, as individual `sweep()` calls remain available.

**Suggested fix:** Document a safe batch size in the NatSpec (the unit tests suggest ~50 slots is safe at current gas prices). Alternatively, forward a bounded gas per slot: `Slot(slotAddresses[i]).sweepFor{gas: 200_000}(msg.sender)`.

### [L-3] `block.timestamp` used for deadline and recovery-delay comparisons

**Location:**
- `SlotVault.sol` line 130: `block.timestamp > deadline`
- `SlotVault.sol` line 198: `block.timestamp < recoveryReadyAt`
- `SlotFactory.sol` line 161: `expiresAt <= block.timestamp`

**Description:**
Slither flags these as timestamp-dependent comparisons that a validator can manipulate by a few seconds. For deadline-style enforcement (SlotVault withdrawals, request expiry) a few seconds' slack is acceptable. For the recovery delay (minimum 1 day), the tolerance is negligible.

**Impact:** Negligible. A validator cannot manipulate `block.timestamp` by more than 12 seconds on Arc.

**Suggested fix:** No change required. Standard pattern; document the known tolerance in NatSpec.

### [L-4] `initiateRecovery` can be called repeatedly without cancelling a previous recovery, silently extending or changing it

**Location:** `SlotVault.sol` — `initiateRecovery()` lines 176–181

**Description:**
`initiateRecovery` has no guard for a pending recovery already in progress. The owner wallet can call it again with a different `newKey` (or the same), resetting `recoveryReadyAt` to `now + recoveryDelay`. This means:
- The owner can postpone a PQ-key-holder's cancellation window indefinitely by repeatedly re-initiating recovery just before the delay expires (if the PQ key is lost, this is irrelevant, but if the PQ key is held by a third party, they must keep watching).
- Any in-progress recovery is silently overwritten without event differentiation.

**Impact:** Low. If the PQ key is genuinely lost, the owner re-initiating recovery is correct behavior. If the PQ key holder is actively defending (calling `cancelRecovery`), repeated re-initiation forces them to keep paying gas.

**Suggested fix:** Add a guard that prevents re-initiation while a recovery is pending, or emit a `RecoveryCancelled` / `RecoveryReplaced` event when an existing recovery is overwritten.

### [L-5] VaultFactory `createVault` emits `VaultCreated` after external `initialize` call (event-ordering)

**Location:** `VaultFactory.sol` lines 34–39

**Description:**
Slither flags that `VaultCreated` is emitted after the external call to `SlotVault.initialize()`. If `initialize` reverted, no event would be emitted, which is correct. However, the event-after-external-call pattern is flagged as a minor CEI ordering concern; also, if the vault `initialize` function were ever changed to contain a callback, the event would be emitted in a potentially inconsistent state.

**Impact:** Negligible with the current `initialize` implementation.

**Suggested fix:** Emit the event before the `initialize` call, or record all state before the call and emit after — the standard Checks-Effects-Interactions pattern.

### [L-6] `unused-return` in `SlotVault._authorise` — third return value of `ECDSA.tryRecover` silently discarded

**Location:** `SlotVault.sol` lines 215–217

**Description:**
`ECDSA.tryRecover` returns `(address signer, RecoverError err, bytes32 errArg)`. The code captures `(signer, err,)` with an unnamed third slot. Slither flags this as an unused return value. The third element (`errArg`) is the invalid-length signature argument, which is only informational and not needed for the security check (the `err` enum covers it). This is not a vulnerability.

**Impact:** None.

**Suggested fix:** No change required. The unused `errArg` is intentionally discarded; the security-relevant `err` value IS checked.

---

## Info / Accepted Findings

### [I-1] Factory configuration is immutable — no owner, no upgrade path

**Location:** `SlotFactory.sol` constructor; `VaultFactory.sol` constructor

**Description:**
`tip`, `minSweep`, and `implementation` in `SlotFactory`, and `implementation` in `VaultFactory`, are immutable. Changing them requires deploying a new factory (and new implementation). No admin key, pause, or upgrade path exists.

**Impact:** This is an intentional design decision (documented in the code: "No owner, no admin, no pause, no upgrade path"). On Arc, deterministic addresses are a core feature — they let payers from other chains send to the same address. An upgradeable factory would break address determinism across deployments.

**Note:** If `tip` or `minSweep` need to change due to long-term gas price shifts on Arc, a new factory must be deployed and merchants must re-create their slots. Existing slots are permanently bound to the factory that created them.

### [I-2] ChainConfig omits several testnets and all non-Circle USDC chains

**Location:** `ChainConfig.sol` lines 13–31

**Description:**
The hardcoded chain list covers Arc (mainnet + testnet), Ethereum, Base, Arbitrum, Optimism, Polygon, Avalanche (mainnet), and Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia (testnet). Chains not in the list cause `revert UnsupportedChain()`. This is a deployment-time concern, not an exploit.

**Impact:** A deposit to a slot address on an unlisted chain (e.g., Optimism Sepolia) would revert on any function that calls `ChainConfig.usdc()`. This is by design — the contracts only recover funds on known chains.

**Note:** The USDC address on Arc (`0x3600000000000000000000000000000000000000`) is correct and confirmed live. Other addresses match Circle's official documentation.

---

## Areas Checked and Found Clean

- **Arc native/ERC-20 double-counting:** No code path uses `msg.value`, `address(this).balance`, or the 18-decimal native representation. All balance operations use `usdc.balanceOf(address(this))` exclusively via the 6-decimal ERC-20 interface. No double-counting risk.
- **EIP-1167 clone re-initialization:** The `_initialised` bool guard in both `Slot` and `SlotVault` is set before any external state is written and before any external call, preventing re-initialization. The guard is checked first in the `initialize` function.
- **Slot front-running via initialize:** Because `SlotFactory._deploy` calls `slots[merchant][payRef] = slot` and `isSlot[slot] = true` BEFORE calling `Slot.initialize()`, and `initialize` is guarded by `_initialised`, there is no window for a third party to call `initialize` on a newly-deployed clone — the factory is `msg.sender` and sets it atomically.
- **VaultFactory salt includes all parameters:** `keccak256(abi.encode(owner, pqKey, twoKey, recoveryDelay, salt))` commits the vault's security parameters into the CREATE2 address. An attacker cannot deploy "your" vault at your predicted address with a different PQ key, because the salt is different.
- **SlotVault replay protection:** Every signature-consuming function increments `nonce` (or reads `nonce++`), and the digest includes `chainid`, `address(this)`, and `nonce`. Cross-chain and cross-vault replay is blocked. After `completeRecovery`, `nonce++` invalidates all signatures made under the old PQ key.
- **SlotVault off-Arc mode:** On non-Arc chains (Ethereum Sepolia), the PQ precompile is absent and only the owner ECDSA signature is required. This is documented and intentional — off-Arc vaults only hold funds misdirected from other chains.
- **Gas reimbursement over-extraction:** `_gasRefund6` prices at `min(tx.gasprice, block.basefee)`, so a sweeper submitting with a high priority fee does not inflate their reimbursement. The `maxReimbursement` cap is enforced before any transfer, and the reimbursement is also capped at `net` (the merchant's share after fee), so the merchant can never receive less than zero. The merchant self-sweep bypass (`rewardTo != _merchant`) ensures funds cannot be permanently locked by a high gas price.
- **SlotVault `cancelRecovery` with no pending recovery:** The `NoRecovery` guard (line 187) checks `pendingKey != bytes32(0)` before accepting a signature. The `cancelDigest` including `pendingKey = bytes32(0)` is never verified because the guard reverts first.
- **`recordCollect` guard:** `isSlot[msg.sender]` ensures only factory-deployed slots can write to the leaderboard. An arbitrary contract cannot inject fake stats.
- **SafeERC20 usage:** All USDC transfers use `safeTransfer`, which reverts on a false/missing return value from the token contract.
- **Integer overflow:** Solidity 0.8.x built-in overflow checks cover all arithmetic. The `uint192` cast in `recordCollect` (`st.delivered += uint192(gross)`) could theoretically truncate if a single collector sweeps more than ~6.3 × 10^51 6-decimal USDC (effectively impossible), consistent with the Forge lint warning in the build output.

---

## Scope

**In scope:** All logic in the five listed `.sol` files, including all internal functions, modifiers, events, errors, and the `ChainConfig` library.

**Out of scope:**
- Integration tests and unit test files (`contracts/test/`, `contracts/test-integration/`)
- Deploy scripts (`contracts/script/`)
- Frontend TypeScript code (`src/`)
- The Arc PQ precompile at `0x1800000000000000000000000000000000000004` (treated as a trusted black box)
- The Circle USDC FiatToken contract (treated as a trusted external dependency)
- On-chain collector bots or relayer implementations
- Mainnet economic analysis of `tip` / `minSweep` / `maxReimbursement` parameter choices

---

## Audit Provenance

| Reviewer | Files audited | Notes |
|---|---|---|
| solidity-auditor | 5 | Corpus rules: on-behalf-of-user-account-parameter-bypass |
| functional-auditor | 5 | Functional, adversary-resistance, and deployment-target review |
| Slither 0.11.x | 5 (project root) | Static analysis, filter-paths: node_modules, lib, test, script |
