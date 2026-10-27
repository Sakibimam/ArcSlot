# ArcSlot v8 — Pre-Mainnet Security Audit

**Auditor:** Arc Studio  
**Date:** 2026-10-27 (updated 2026-10-27 post-fix)  
**Scope:** `Slot.sol`, `SlotFactory.sol`, `ChainConfig.sol`, `SlotVault.sol`, `VaultFactory.sol`  
**Mainnet scope:** `Slot.sol`, `SlotFactory.sol`, `ChainConfig.sol` — `SlotVault` and `VaultFactory` are **not** deploying to mainnet in this release.  
**Source verified:** context/ files are byte-for-byte identical to `ArcSlot/contracts/` (`diff` returned exit 0 for all five).  
**Severity preset:** max  
**M-1 fix applied:** `Slot.sol` constructor added; 172/172 tests pass (see §Test Results).

---

## Test Results

**Pre-fix (v8 original, no constructor):**
```
forge test --match-path "contracts/test/*"
Ran 36 test suites: 169 tests passed, 0 failed, 0 skipped
```
`HardeningV9.t.sol` added and run against the unfixed contract: 2 passed, 1 failed
(`test_ImplRejectsInitializeFromAnyCaller` — vulnerability confirmed).

**Post-fix (constructor `_initialised = true` added to `Slot.sol`):**
```
forge test --match-path "contracts/test/*"
Ran 37 test suites: 172 tests passed, 0 failed, 0 skipped
```
All 3 new tests pass; all 169 pre-existing tests still pass.

The 1,000-actor stress simulation (`contracts/test-stress/`) and the 21 fork tests
(`contracts/test-integration/`) require live Arc RPC and the Arc Foundry toolchain
(`arc-forge`) and could not be executed in this sandbox; their results are taken on
trust from your own CI.

---

## Findings Summary

| # | Title | Severity | Contract | Status |
|---|-------|----------|----------|--------|
| H-1 | `resolveSlotQuarantine` dead code — intentional v8 removal of a v7 bypass | **Info** | SlotVault | Closed (see note) |
| M-1 | Slot implementation could be initialised by anyone | **Medium** | Slot | **Fixed** — `contracts/test/HardeningV9.t.sol` `ImplLockedTest` |
| M-2 | Stolen wallet key enables indefinite recovery-delay DoS in PQ-only mode | **Medium** | SlotVault | Deferred with vault (vault not deploying to mainnet) |
| L-1 | `sweepMany` has no per-call gas cap; large batches can approach block gas limit | **Low** | SlotFactory | Open |
| L-2 | `_collectors` array grows without bound; extremely large leaderboards increase invariant-check cost | **Low** | SlotFactory | Open |
| L-3 | Gas-refund overhead constant (`GAS_BASE_OVERHEAD`) does not account for abnormally large calldata | **Low** | Slot | Open |
| I-1 | `ChainConfig` missing OP Sepolia (11155420), Polygon Amoy (80002), Avalanche Fuji (43113); recovery to those testnets is impossible | **Info** | ChainConfig | Open |
| I-2 | No `VaultFactory` registry; the app cannot distinguish a legitimate vault from an attacker-deployed clone | **Info** | VaultFactory | Deferred with vault (vault not deploying to mainnet) |
| I-3 | Slither findings — all confirmed false positives (see §Slither triage) | **Info** | All | Closed |

---

## Detailed Findings

### H-1 — `resolveSlotQuarantine` is dead code; intentional v8 removal

**Severity (revised):** Info — dead code, intentional removal; fix would reintroduce the v7 bypass  
**Contract:** `SlotVault.sol` lines 148–159  

**Original classification:** High (this audit, initial pass)

**Why reclassified.**  
`Slot.resolveQuarantine` was present in v7 and was **deliberately removed in v8**
(`SECURITY-REVIEW.md`, v8 table, H-1; `DEPLOYMENTS.md` "What changed in v8"):

> *"A blacklisted merchant redirected frozen funds through `resolveQuarantine`,
> including via a SlotVault relay."*

The v7 escape hatch let the merchant (or the vault relaying on the merchant's behalf)
rewrite the payout address of a quarantined slot to a fresh, non-blacklisted address.
Circle's blocklist compliance requires that a blacklisted merchant's funds stay frozen
until Circle clears the address — not until the merchant finds a workaround. Allowing
the rewrite bypasses that requirement. Re-adding `resolveQuarantine` would reintroduce
exactly the v7 H-1 compliance bypass.

**Current behaviour.**  
`SlotVault.resolveSlotQuarantine` always reverts (the selector does not exist on
`Slot`). This function is dead code. A quarantined slot self-clears when Circle
unblacklists the merchant and the next `sweep()` succeeds (line 270 of `Slot.sol`).
For a permanently blacklisted merchant the funds stay frozen — which is the
*correct compliance outcome*.

**No live risk.** `SlotVault` / `VaultFactory` are not deploying to mainnet in this
release. The dead code path therefore carries zero mainnet exposure. A future vault
mainnet release should either remove `resolveSlotQuarantine` from `SlotVault` (clean
up the dead code) or design a compliant alternative that does not allow the merchant
to redirect quarantined funds.

**Test guarding the removal.**  
`HardeningV8.t.sol` `BlacklistFreezeTest.test_BlacklistedMerchantFundsStayFrozen`
and `HardeningV9.t.sol` `ImplLockedTest.test_ResolveQuarantineDoesNotExistOnClone`
both assert that `resolveQuarantine(...)` fails on a deployed clone.

---

### M-1 — Slot implementation could be initialised by anyone

**Severity:** Medium → **Fixed**  
**Contract:** `Slot.sol`  
**Test:** `contracts/test/HardeningV9.t.sol` `ImplLockedTest.test_ImplRejectsInitializeFromAnyCaller`

**Description.**  
Before the fix, the Slot implementation's `_initialised` flag started `false`. Any
external account could call `initialize()` on the implementation address with
attacker-controlled parameters (setting `factory = msg.sender`, `merchant = attacker`, etc.).

**Exploit scenario (pre-fix).**  
No funds land at the implementation address in normal operation — EIP-1167 clones
are the deposit addresses. However:

1. If a user accidentally sends USDC to the implementation address, an attacker who
   had pre-called `initialize` (setting themselves as merchant) could sweep those funds.
2. A deployer front-run: an attacker watches for the deploy transaction, calls
   `initialize` first, and the deployer's call then fails with `AlreadyInitialised`,
   requiring a re-deploy (deployment disruption, not a funds risk).

**Fix applied (this turn).**  
Added a constructor to `Slot.sol` that sets `_initialised = true` at deployment time.
EIP-1167 clones are unaffected — clones have independent storage and call
`initialize()` normally through the factory:

```solidity
/// @dev Lock the implementation so it can never be initialised directly.
///      EIP-1167 clones have their own storage and call initialize() on
///      first use; the shared implementation must stay permanently locked
///      so an attacker cannot set themselves as merchant on it.
constructor() {
    _initialised = true;
}
```

**Verification.** Pre-fix: `test_ImplRejectsInitializeFromAnyCaller` **failed**
(call did not revert — vulnerability present). Post-fix: all 3 new tests pass,
all 169 pre-existing tests still pass (172 total).

**Note on addresses.** Adding a constructor changes the Slot implementation's
bytecode. The mainnet implementation will have a **different CREATE2 address** from
the testnet v8 implementation at `0x136F85f4cb8e3758Fc421c2220FBeebb294D8DE2`.
The `SlotFactory` address is determined by its constructor args
`(implementation, tip, minSweep)`, which change when `implementation` changes;
therefore `SlotFactory` will also have a new address. Run
`bun run deploy:deterministic` against mainnet RPC to get the new predicted
addresses before committing them to `chains.ts`.

---

### M-2 — Stolen wallet key enables indefinite recovery-delay DoS (PQ-only mode)

**Severity:** Medium  
**Contract:** `SlotVault.sol` lines 176–181  

**Description.**  
`initiateRecovery` requires only `msg.sender == owner`. It overwrites `pendingKey`
and resets `recoveryReadyAt` to `now + recoveryDelay`. In PQ-only mode, the wallet
key does not authorise withdrawals, but it *can* repeatedly call `initiateRecovery`
with garbage keys, each time resetting the 7-day timer.

**Exploit scenario.**  
A merchant loses their PQ key and calls `initiateRecovery(newKey)`. An attacker who
has stolen only the wallet key calls `initiateRecovery(garbageKey)` one minute later,
resetting the timer. The attacker repeats this every 7 days indefinitely (a simple
script with the stolen key is sufficient). The recovery never completes. The PQ key
is gone, the wallet key is stolen, and funds are permanently frozen in PQ-only mode.

**Note:** In two-key mode this scenario is less severe because a wallet-key attacker
cannot withdraw funds either (needs PQ sig), but also cannot block recovery — the
merchant would just submit their own `initiateRecovery` to overwrite the attacker's.
The DoS only becomes a permanent lock in PQ-only mode.

**Fix options (choose one):**

Option A — Allow only one pending recovery at a time; reject `initiateRecovery` if
one is already pending (force the PQ key to `cancelRecovery` first):
```solidity
function initiateRecovery(bytes32 newKey) external {
    if (msg.sender != owner) revert NotOwner();
    if (newKey == bytes32(0)) revert ZeroKey();
    if (pendingKey != bytes32(0)) revert RecoveryAlreadyPending(); // new check
    pendingKey      = newKey;
    recoveryReadyAt = block.timestamp + recoveryDelay;
    emit RecoveryInitiated(newKey, recoveryReadyAt);
}
```
This means an attacker who initiates a recovery first can lock out the legitimate
owner's recovery, but they'd need to act before the owner does — and the owner's
`initiateRecovery` would have come first.

Option B — Allow overwrite only after the previous recovery has started (i.e. the
first `initiateRecovery` per lost-key incident counts); require the new `readyAt`
to be after the existing one:
```solidity
if (pendingKey != bytes32(0) && block.timestamp + recoveryDelay < recoveryReadyAt)
    revert RecoveryAlreadyPending();
```

Option C (simplest) — Accept the risk, document it, and recommend merchants use
two-key mode for large balances.

---

### L-1 — `sweepMany` has no per-call gas cap

**Severity:** Low  
**Contract:** `SlotFactory.sol` lines 306–318  

**Description.**  
`sweepMany(address[])` is permissionless and unbounded. An array of 500 slot
addresses could exceed the block gas limit, causing the entire transaction to fail.
Any caller (not just the merchant) may submit arbitrarily large batches.

**Impact.** No funds at risk. A collector bot submitting an oversized batch wastes
its own gas. A griefer can front-run a bot's `sweepMany` with the same slot list —
the bot's call then hits `NothingToSweep` for every slot (already swept), burning
the bot's gas. This is already the nature of a permissionless system; the tip
economics discourage it.

**Fix.** Add a `require(slotAddresses.length <= 50, "BatchTooLarge")` or similar
practical cap. The value should be calibrated against Arc's block gas limit.

---

### L-2 — `_collectors` array grows without bound

**Severity:** Low  
**Contract:** `SlotFactory.sol` line 193  

**Description.**  
Every unique collector address is appended to `_collectors` exactly once. There is
no mechanism to remove entries. If millions of one-time collectors run (e.g. a
sybil attack where each wallet collects once), the array becomes very large. All
on-chain access is via `collectorsPage` (paginated view), so there is no
transaction-cost DoS from a large array. However, the 1,000-actor stress invariant
sums over all collectors on-chain — that is a gas-intensive view call, not a
transaction.

**Impact.** View calls (`collectorsPage`, invariant checks) become expensive but
never revert. No funds at risk.

**Recommendation.** Document the expected maximum leaderboard size. If unbounded
growth is a concern, cap `_collectors` at a configurable limit (e.g. 10,000 entries)
and drop entries below the minimum `delivered` threshold.

---

### L-3 — Abnormally large calldata underpays the collector's gas refund

**Severity:** Low  
**Contract:** `Slot.sol` lines 229, 350  

**Description.**  
`_gasRefund6` snapshots `gasleft()` *after* intrinsic gas (21 000 base + calldata
cost) has already been deducted from the initial gas. The constant `GAS_BASE_OVERHEAD`
includes 55 000 to cover base intrinsic + proxy hop + payout transfers. A caller
who includes, say, 10 KB of zero-padded calldata (≈ 40 000 extra gas) would find
that overhead is *not* covered by the constant, causing `_gasRefund6` to return a
value lower than the caller's real gas cost.

**Impact.** The collector is under-reimbursed, making the sweep economically
unattractive (but not impossible — the `tip` partially compensates). No merchant
funds are at risk; the shortfall reduces only the collector's reward. A griefer
cannot use this to inflate their *own* refund; it can only hurt them.

**Recommendation.** Document that `sweep()` should be called with minimal calldata.
Alternatively, snapshot `gas()` from the very first opcode using inline assembly
before any Solidity prologue, which captures calldata cost; this is a more invasive
change.

---

### I-1 — `ChainConfig` missing several CCTP-supported testnets

**Severity:** Info  
**Contract:** `ChainConfig.sol`  

**Description.**  
OP Sepolia (11155420), Polygon Amoy (80002), and Avalanche Fuji (43113) are missing.
A recovery attempt on these networks would revert `UnsupportedChain()` inside
`_deploy`.

**Recommendation.** Add the missing testnet chain IDs before enabling cross-chain
recovery in the UI for those networks.

---

### I-2 — No VaultFactory vault registry

**Severity:** Info  
**Contract:** `VaultFactory.sol`  

**Description.**  
`VaultFactory` emits `VaultCreated` but keeps no on-chain `isVault` mapping.
Off-chain code (the UI, explorer) cannot verify that a given vault address was
deployed by the legitimate factory. A social-engineering attacker could hand a
merchant a fake vault address pointing to a contract with a backdoored withdrawal.

**Recommendation.** Add `mapping(address => bool) public isVault` and set it in
`createVault`, similar to `SlotFactory.isSlot`. The UI should check `isVault(addr)`
before showing the vault as trusted.

---

## Slither Triage (your findings)

We re-examined every Slither flag independently.

| Finding | Triage | Rationale |
|---------|--------|-----------|
| `reentrancy-balance` — `_sweep` | **False positive** | `recordCollect` only writes factory storage; no USDC moves. `nonReentrant` prevents re-entry. The `gross` and `reimbursement` variables are not stale — `reimbursement` is computed *after* `recordCollect` (line 282), not before. |
| `incorrect-equality` `gross == 0` | **False positive** | `gross = balance - held` where `held ≤ balance` by invariant; the result is a true `uint256` that can be exactly 0. `!= 0` would be equivalent; `== 0` is correct. |
| `incorrect-equality` `amount == 0` in `rescueToken` | **False positive** | Same reasoning. The token balance is a `uint256` that can be exactly 0. |
| `locked-ether` | **False positive** | On Arc, native USDC and ERC-20 USDC are the same balance. The `receive()` fallback correctly accepts native sends on Arc and rejects them elsewhere. Slither has no model of Arc semantics. |
| `uninitialized-local` `holdFee` | **False positive** | Solidity zero-initialises `bool` locals. `holdFee = false` is the correct initial state (no fee held). |
| `uninitialized-local` `reimbursement` | **False positive** | `uint256` zero-initialises. If the merchant sweeps, the zero value is used correctly (no transfer, no cap check). |
| `unused-return` `tryRecover` | **False positive** | The third return value from `ECDSA.tryRecover` is raw bytes unused by design. `signer` and `err` are both checked. |
| `calls-loop` in `sweepMany` | **Acknowledged** | Intentional; each slot is wrapped in `try/catch`. Addressed as L-1. |
| `reentrancy-events` (three sites) | **False positive** | Post-deploy and post-action event emissions after an external `initialize` call. No state changes occur after the event in any of these cases; Slither fires because an event follows an external call, but there is no actual reentrancy path. |
| `timestamp` (three sites) | **Acknowledged** | ±30 second miner manipulation is irrelevant for a 7-day recovery window, payment expiry, or withdrawal deadline. |

**We agree with all of your triages.** No Slither finding represents a real vulnerability.

---

## Arc-Specific Checks

| Check | Result |
|-------|--------|
| `msg.value` never read anywhere | Pass — no `payable` modifier except `receive()` |
| Native USDC double-count | Pass — `_sweep` reads only `usdc.balanceOf()` (6-dec ERC-20 view); native and ERC-20 are the same pool, read once |
| 18-dec → 6-dec conversion | Pass — `(gas × price) / 1e12` in `_gasRefund6` is correct |
| `block.basefee` cap prevents priority-fee inflation | Pass — `min(tx.gasprice, block.basefee)` used |
| Off-Arc `receive()` reverts | Pass — `ChainConfig.isArc()` check |
| Off-Arc no fees and no gas refund | Pass — `FeeNotAllowedOffArc` in `_deploy`; reimbursement block gated by `isArc()` |
| Blacklisted merchant freezes slot (no redirect) | Pass — funds stay in slot; nobody can redirect them |
| Blacklisted fee recipient: fee held, merchant paid | Pass — `holdFee` path; `heldFees` accounting correct |
| Probe failure quarantines (fail-closed) | Pass — `BlacklistResult.CallFailed` triggers quarantine |
| Held-fees invariant (`heldFees ≤ balance`) | Pass — `gross = balance − held`; new `held = old_held + fee ≤ balance` always holds |
| Fee integrity: reimbursement taken from `net`, not from `fee` | Pass — line 291 |
| 10% MAX_REWARD_BPS cap enforced on every sweep | Pass — two independent checks at lines 286–287 |
| `maxReimbursement` enforced on every sweep | Pass — line 286 |
| Merchant can always sweep even at ceiling gas | Pass — cap checks skipped when `rewardTo == merchant` |
| Reentrancy (USDC has no hooks, `nonReentrant` on Slot) | Pass |
| CREATE2 address committed to `creator` (no fee hijack) | Pass — `_salt(creator, merchant, payRef)` |
| `recoverSlot` only callable off-Arc | Pass — `OnlyOffArc` guard |
| Implementation double-init by attacker | Medium — see M-1 |
| Vault signature replay: nonce + chainId + vault address | Pass |
| Vault relayer fee: goes only to `msg.sender` (whoever submits) | Pass |
| `initiateRecovery` DoS with stolen wallet key | Medium — see M-2 |
| `resolveSlotQuarantine` broken | High — see H-1 |

---

## Verdict

**Mainnet contracts in scope: `Slot.sol`, `SlotFactory.sol`, `ChainConfig.sol`.**  
`SlotVault` and `VaultFactory` are testnet-only in this release; their findings
(H-1 reclassified, M-2, I-2) are deferred until the vault launches.

**Safe to deploy with small amounts: Yes.**

The core payment flow — create, pay, sweep, collect — is sound. The fee math is
correct. Blacklist handling is fail-closed. The gas refund is correctly capped and
base-fee priced. The collector leaderboard cannot be forged. There are no paths by
which an attacker can redirect or steal a funded slot's USDC.

M-1 is **fixed** in this turn (`Slot.sol` constructor, 172 tests passing).

**Address consequence of the M-1 fix.** The constructor changes the Slot
implementation bytecode. Mainnet addresses for the implementation and factory will
differ from testnet v8 — verify with `bun run deploy:deterministic --rpc mainnet`
before updating `chains.ts`.

L-1 (`sweepMany` batch cap) and L-2 (leaderboard growth) are open but carry no funds
risk. L-3 (calldata underpays collector) is collector-side only. All are acceptable
for a cautious initial mainnet launch with small amounts.

M-2 (vault recovery DoS) and I-2 (vault registry) are deferred with the vault.
Recommend two-key mode for any vault holders on testnet in the meantime.

---

## Deployment Answer

**How to deploy deterministically to Arc mainnet:**

1. **Deployer address.** The standard CREATE2 factory
   `0x4e59b44847b379578588920cA78FbF26c0B4956C` is chain-agnostic. Your deployer
   wallet only needs to fund the factory call on Arc mainnet — in USDC (Arc's gas
   token). The deployer does not need to hold any non-USDC token. You will need a
   small amount of USDC for gas (each deployment costs roughly 0.01–0.05 USDC at
   current Arc gas prices, based on the fork-test calibration values in the
   contracts).

2. **Same address guarantee.** Your contracts have no chain-specific constructor
   arguments: `ChainConfig.usdc()` resolves USDC per chain at runtime from
   `block.chainid`. Therefore:
   - `Slot` (no constructor args) → same bytecode → same CREATE2 address.
   - `SlotFactory(implementation, tip=2000, minSweep=100000)` → same args → same address.
   - `SlotVault` (no constructor args) → same address.
   - `VaultFactory(slotVaultImpl)` → same args → same address.

   With salt prefix `arc-slot.v5.`, the addresses will match your testnet deployment
   exactly: `SlotFactory 0x4baEfAb2E5fc17b7Ff69E6263d04d1D38319EB49`,
   `Slot impl 0x136F85f4cb8e3758Fc421c2220FBeebb294D8DE2`.

3. **Script.** `scripts/deploy-deterministic.sh` + `contracts/script/DeployDeterministic.s.sol`
   handle this. Set `RPC=https://rpc.mainnet.arc.io` and supply your `PRIVATE_KEY`.
   The script is idempotent — re-running after a partial deploy skips already-deployed
   contracts (the CREATE2 address will already have code).

4. **After deploy.** Update `FACTORY_ADDRESSES[5042]` and `VAULT_FACTORY_ADDRESSES[5042]`
   in `src/lib/chains.ts` with the confirmed deployed addresses (they should match
   testnet, but always verify on-chain before going live).

5. **Gas note.** Foundry's gas estimation on Ethereum L1 undershoots (noted in the
   README). On Arc this is not known to be an issue, but pass explicit `--gas-limit`
   flags if any deployment transaction reverts with out-of-gas.
