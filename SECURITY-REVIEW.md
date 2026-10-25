# ArcSlot security review: white-hat pass and audit triage (2026-10-25)

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
