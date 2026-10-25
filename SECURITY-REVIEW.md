# ArcSlot security review

## v8: fixes for the independent review of v7

The developer's independent attack review of v7 found 2 High, 6 Medium and 10 Low issues. Each one now has a regression test that fails if the attack works again. The tests are in `contracts/test/HardeningV8.t.sol` and the frontend test files.

| # | v7 issue | v8 fix | Test |
|---|---|---|---|
| H-1 | A blacklisted merchant redirected frozen funds through `resolveQuarantine`, including via a SlotVault relay | `resolveQuarantine` is removed and payout terms are immutable. A blacklisted merchant's funds stay frozen until Circle clears the address. | `BlacklistFreezeTest`, `VaultOwnedSlotBlacklistTest` |
| H-2 | A native USDC send to a slot reverted on Arc | `receive()` accepts native USDC on Arc (it's the same balance) and refuses native coins elsewhere | `NativeReceiveTest`, fork `test_Fork_NativeUsdcSendPaysSlot` |
| M-1 | Wrong-chain recovery needed the creator's key | `recoverSlot(creator, merchant, payRef)`: anyone can call it off Arc, with fees forced to 0; `creatorOf` records the creator | `RecoverSlotTest`, `recovery*.test.ts` |
| M-2 | A quarantine let the merchant strip the platform fee | Fee terms can't be changed. A blacklisted fee wallet's fee is held and paid out later via `releaseHeldFees` | `BlacklistFreezeTest` |
| M-3 | A small payment could lose up to 50% to a collector | The reward is capped at 10% of each payment, on top of the merchant's own cap | `RewardCapTest` (fuzzed over 1–500 gwei) |
| M-4 | Non-USDC tokens were stuck | `rescueToken(token)` always pays the merchant | `RescueTest` |
| M-5 | A stolen wallet key could take over a vault after 7 days, with no alert | `scripts/vault-watch.ts` alerts by console or webhook. Fixing this in-contract would move the vault addresses. | `vault-watch.test.ts` |
| M-6 | "Verified" badges could be gamed; labels allowed bidi and invisible characters | Neutral wording ("created by the payee's own wallet", "fixed in the contract"), a note on who wrote the label, and labels sanitised | `PayPage.test.tsx`, `slot-logic.test.ts` |
| L-1, L-2 | Collector griefing and leaderboard spoofing via `sweepFor(other)` | `sweepFor` only pays the caller (or the factory's `sweepMany` caller); the leaderboard explains what it measures | `CollectorRulesTest` |
| L-3 | Expiry is UI-only | Plain token transfers can't be refused on-chain. The UI hides every payment option once a request expires, and late payments still reach the payee. | — |
| L-4 | The refund overpaid real gas | Measured at +3% of measured gas on a fork, and about +8% live. The difference covers the 1 gwei priority fee, which isn't refunded. Kept, with a fork test bounding it at ≤15%. | `test_Fork_GasRefundCoversRealCost_*` |
| L-5 | The cross-chain quote wasn't checked | Quotes that don't deliver the exact amount are refused, and fees above 25% get a warning | `crosschain.test.ts` |
| L-6 | No security headers | CSP (`script-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`), X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy | `security-headers.test.ts` |
| L-7 | Weak vault key storage | PBKDF2 at 600k iterations (old boxes still open), encrypted backup files, passwords of at least 12 characters | `pq.test.ts`, `VaultCard.test.tsx` |
| L-8 | Dependency advisories | Down from 38 (2 critical) to 13 (0 critical): vitest 4, plus undici and grpc patch overrides. See below for the rest. | `bun audit` |
| L-10 | Build output tracked in git | `node_modules`, `dist` and `contracts/out` are no longer tracked | — |

### Stress tests

- **1,000-actor stress suite** (`bun run contracts:test:stress`). The token mock behaves like Circle's: transfers to or from a blacklisted address revert.
  - **Deterministic simulation.** 20,000 pseudo-random actions with all invariants checked every 500 steps: 888 requests, 6,467 collections by 821 collectors, 3,785 sweeps that hit a blacklisted merchant (funds frozen), 1,774 sweeps that held a blacklisted wallet's fee, and about 14.9M test-USDC moved.
  - **Randomised invariant campaign.** 64 runs of 2,000 calls for each invariant.
  - **What held throughout:** USDC is conserved; a blacklisted address is never paid; no reward exceeds 10% of a payment or the merchant's cap; held fees are always covered; leaderboard totals equal the per-collector stats.
  - **An earlier version was mostly hollow.** Random inputs mostly hit empty slots, so few real collections ran. A coverage check caught this, and the handler now targets funded slots, realistic fees and real merchant or fee wallets.
- **1,000-user local chain test** (`bun run stress:local`, on `arc-anvil` with Arc's native USDC and 1-second blocks):
  - 400 merchants created 800 requests concurrently, with 0 failures. Bursts queue about 14 s because of block gas limits.
  - 500 payers made 800 payments (40% native, 60% token), with 0 failures.
  - 50 collector bots raced: every slot was collected exactly once, and the losers reverted harmlessly.
  - All 48 attacker transactions failed.
  - Accounting: 20,091.457506 USDC paid in and 20,091.457506 USDC swept out, matched to the micro-USDC against on-chain events. The largest reward was 1.66% of a payment.
  - RPC load: 1,000 open pay pages produce about 167 requests per second. Pages stop polling once paid, and hidden tabs don't poll.

### Accepted risks (not fixable in code here)

- **Vault contracts are unchanged.** That keeps existing vault addresses valid. So L-4 (recovery re-initiation), relayer-fee front-running and raw-digest signing are mitigated outside the contract (the watcher script, and the app never sets a relayer fee).
- **Remaining dependency advisories.** zod, elliptic and uuid come in through Circle's SDKs and ethers v5. elliptic has no patched release, and the app never signs with it. toml, stream-json, postcss-selector-parser and decode-uri-component are build or dev tooling that never parse untrusted input.
- **Operations.** One hot key deploys on testnet, and deploys run from a laptop. Before mainnet, use a separate deployer, a multisig and CI deploys.
- **Native dust.** Native sends finer than 1e-6 USDC leave sub-micro dust in a slot (the ERC-20 view has 6 decimals).
- **Old commits.** Commits from before the history rewrite stay fetchable by SHA on GitHub until it garbage-collects them.

This is not a substitute for an independent third-party audit before mainnet.

---

## v7 and earlier

This covers the v6 → v7 security work:

1. **Arc Studio's audits.** [`AUDIT.md`](AUDIT.md) covers v5 and [`AUDIT-v6.md`](AUDIT-v6.md) covers v6. Both were written by Arc Studio and are included unedited.
2. **A white-hat attack pass by the developer.** Each attack is written as a Foundry or Vitest test, so anyone can re-run it.
3. **A triage of every Studio v6 finding**, with the evidence for each verdict.

Neither is a substitute for an independent third-party audit before mainnet.

## Fixed in v7

| # | Finding | Found by | Fix | Tests |
|---|---|---|---|---|
| 1 | **Look-alike payment page (frontend, High).** The pay page accepted any contract that answered `merchant()`. An attacker could deploy a contract that impersonates a known payee. The page showed "Paid to ‹payee› — verified on-chain", but the USDC went to the attacker. | white-hat | The pay page now requires `SlotFactory.isSlot(address)`. | PoC `WhiteHat.t.sol::test_PoC_FakeSlotImpersonatesMerchantAndKeepsPayment`; `PayPage.test.tsx` "rejects a look-alike contract" |
| 2 | **Fake vault badge (frontend, Low).** Any contract answering `pqKey()` got the "quantum-safe vault" badge, and could "verify" a request through a fake `owner()`. | white-hat | The badge and vault-owner trust now require the payee's code to be an exact EIP-1167 clone of the SlotVault implementation. | `WhiteHat.t.sol::test_PoC_FakeVaultAnswersPqKey`; `PayPage.test.tsx` "does not trust a fake vault"; `slot-logic.test.ts` |
| 3 | **Blacklisted payout locks funds (contracts, Medium).** Circle blacklists the USDC contract itself (checked on real Arc USDC). A slot paying out to it, or to any blacklisted address that can't call `resolveQuarantine`, quarantines on the first sweep and stays stuck. | white-hat fork test, while checking Studio's C-1 | `SlotFactory` rejects a blacklisted merchant or fee recipient with `BlacklistedPayout()`. `Slot.resolveQuarantine` refuses the USDC contract or a blacklisted new payout with `BadPayout()`. The app warns before signing. | `WhiteHat.t.sol::BlacklistedPayoutTest` (7), fork `test_Fork_RejectsUsdcContractAsPayout`, `CreateRequest.test.tsx`; live `cast call` reverts with `0x0b68498e` |
| — | v6 fixes: H-1 front-running and L-1 missing event | Studio v5 audit | See [`DEPLOYMENTS.md`](DEPLOYMENTS.md) | `SlotFrontRun.t.sol` |

## Attacks that failed (kept as regression tests)

All of these are in `contracts/test/WhiteHat.t.sol`, `contracts/test/WhiteHatVault.t.sol` and the fork suite:

- **Re-initialising a slot**, or initialising the shared implementation to affect clones.
- **A stranger redirecting a quarantined slot's funds.** Only the merchant can resolve a quarantine.
- **Gas-starving the blacklist probe** (63/64 rule) so fail-closed quarantine freezes a clean slot. This was fuzzed over 256 gas limits, against mock USDC and **real Arc USDC on a fork**.
- **Inflating the gas refund** with a 1000× priority fee. The refund is priced at base fee, and the overpayer got no more.
- **Locking merchant funds with high gas** (`GasTooHigh`). The merchant can always sweep their own slot.
- **Forging collector-leaderboard stats.** Only factory slots can record.
- **Hostile entries in `sweepMany`.** They are skipped, and real slots still sweep.
- **Setting a fee above 10%.**
- **Vault attacks:**
  - cross-chain replay;
  - reusing a rotate signature as a withdrawal;
  - changing the recipient or fee of a signed withdrawal;
  - a stolen owner key racing recovery;
  - re-initiation griefing. It never completes early, because every attempt restarts the full delay.
- **Real Arc USDC paying out** to a contract with a reverting fallback, to the PQ precompile, and to a fresh address. All three received the funds on a fork.
- **Frontend:**
  - There are no `innerHTML`, `eval` or unvalidated `href` sinks.
  - Pay-link addresses are checked with `isAddress`.
  - The PQ seed is stored only AES-GCM-encrypted (PBKDF2-SHA256, 310k iterations).

## Triage of Arc Studio's v6 audit (`AUDIT-v6.md`)

| Studio ID | Studio severity | Verdict | Evidence |
|---|---|---|---|
| C-1 "reverting merchant permanently locks slot" | Critical | **Refuted as written; a narrower real issue was found and fixed (#3 above).** | Studio's PoC uses a mock USDC rigged to revert on a chosen recipient. Real USDC is a plain ERC-20 with no receiver hooks. On an Arc fork, real USDC paid a reverting contract, the PQ precompile and a fresh address without trouble. The one real lock case is a *blacklisted* payout (including the USDC contract). That case quarantines rather than reverts, and v7 now rejects it. |
| H-2 "relayer fee front-run" | High | **Downgraded to Info and not changed.** | The signed recipient and amount can't be altered. Only the fee goes to whoever submits first. The app always signs `relayerFee = 0` (`VaultCard.tsx`, `recovery-exec.ts`), and the owner submits personally, so there is no impact here. Binding the executor would change SlotVault's bytecode and move every vault's address. Revisit only if a relayer service is added. Test: `WhiteHatVault.t.sol::test_Info_RelayerFeeGoesToFirstSubmitter`. |
| M-1 "no global (merchant, payRef) uniqueness" | Medium | **Refuted as a new risk.** | v5 already let anyone create a slot for any merchant with any fresh `payRef`, so uniqueness of one pair never prevented look-alikes. Links carry the slot address. The pay page shows "created by someone other than the payee" whenever the creator isn't the payee or the payee's vault owner. |
| L-4 recovery re-initiation | Low | **Accepted (unchanged).** | No fund loss. A fix would move the vault addresses. Test: `test_Attack_RecoveryReinitiationGriefingNeverCompletesEarly`. |
| M-1..M-3 (Slither), L-2, L-3, L-5, L-6, I-1, I-2 | — | Agree with Studio's own assessment | — |

## Known limitations (accepted)

- **The collector leaderboard can be gamed.** Someone can recycle their own USDC through their own slots to inflate their stats. It's a display, not a reward pool. The 0.002 USDC tip comes out of the swept payment, so self-dealing gains nothing.
- **Off-Arc vaults release funds with the owner's ECDSA signature alone**, over a raw 32-byte digest. This is by design: there is no PQ precompile off Arc, and those vaults only hold wrong-chain funds. Moving to EIP-712 would make the signing prompt readable, but it changes the vault bytecode.
- **The downloadable vault backup holds the PQ seed in plain text** so it can be restored. Users must store it safely.
