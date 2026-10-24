# Slot / SlotFactory Security Review

**Date:** 2026-10-24  
**Contracts:** `contracts/Slot.sol`, `contracts/SlotFactory.sol`  
**Chain:** Arc Testnet / Arc Mainnet (chain ID 5042002 / 5042001)  
**Review depth:** max (Critical + High + Medium + Low)

> This review covers the internal rule corpus only and is NOT a substitute
> for an independent third-party audit before production deployment.

---

## Before Fixes — Findings

### [Critical] Quarantine unresolvable when feeRecipient is blacklisted

**Location:** `Slot.sol` — `resolveQuarantine()`, `_checkBlacklist()`

The original `resolveQuarantine(address newMerchant)` only replaced `merchant`.
If the quarantine was triggered because `feeRecipient` is blacklisted, calling
`resolveQuarantine` would clear the flag and update `merchant`, but the next
`sweep()` would immediately re-quarantine because `feeRecipient` was still the
blacklisted address. Funds would be permanently stuck in any slot where a
non-zero-fee `feeRecipient` ended up on the USDC blacklist.

### [High] Blacklist probe fails open — quarantine silently skipped

**Location:** `Slot.sol` — `_isBlacklisted()`, called from `sweep()`

When the `isBlacklisted(address)` staticcall failed (reverted, or returned
fewer than 32 bytes), the original code returned `false` and treated the
address as clean. `sweep()` would then proceed with transfers even though
the blacklist status was unknown. In practice this means:
- A USDC contract upgrade that changes the `isBlacklisted` interface would
  silently disable quarantine enforcement on all existing slots.
- Any call-level failure (out-of-gas, unexpected revert) would produce a
  sweep that the USDC contract might then revert at transfer time, with no
  `quarantined` flag set and no way to recover via `resolveQuarantine()`.

---

## After Fixes

### Critical fix — `resolveQuarantine` now accepts `newFeeRecipient` and `newFeeBps`

**New signature:**
```solidity
function resolveQuarantine(
    address newMerchant,
    address newFeeRecipient,
    uint16  newFeeBps
) external
```

The merchant can now:
- Replace `merchant` alone (pass old merchant address, `address(0)`, `0`).
- Replace `feeRecipient` with a clean address.
- Zero out the fee entirely (`newFeeBps = 0`, `newFeeRecipient = address(0)`)
  when the blacklisted feeRecipient cannot be replaced.

Validation mirrors `initialize()`: `newMerchant` must be non-zero;
if `newFeeBps > 0` then `newFeeRecipient` must be non-zero;
`newFeeBps` must be <= 1000.

### High fix — Blacklist probe is now fail-closed

`_probeBlacklist()` returns a `BlacklistResult` enum:
- `Clear` — call succeeded, address is not blacklisted.
- `Blacklisted` — call succeeded, address is blacklisted.
- `CallFailed` — call reverted or returned short data.

`sweep()` now quarantines on `CallFailed` and emits a distinct
`QuarantinedCheckFailed(slot, payRef_)` event so operators can distinguish
a confirmed blacklisting from a probe failure. Funds stay in the slot until
the merchant calls `resolveQuarantine()`, which lets them inspect the
situation and decide how to proceed.

---

## Medium findings

None identified.

## Low findings

None identified.

---

## After-fixes test results

```
Ran 10 test suites: 44 tests passed, 0 failed, 0 skipped
  QuarantineTest    12 tests (expanded from 8)
  SweepManyTest      5 tests
  SweepBasicTest     5 tests
  PredictTest        5 tests (fuzz x256)
  SweepFeeTest       3 tests (fuzz x256)
  SweepReimbursement 4 tests (fuzz x256)
  CreateSlotRevert   5 tests
  InitialiseGuard    2 tests
  ReentrancyTest     1 test
  ArcSafetyTest      2 tests
```

New tests that directly exercise the two fixes:
- `test_ResolveQuarantineThenSweepSucceeds_FeeRecipientBlacklisted`
- `test_ResolveQuarantineCanZeroOutFee`
- `test_BlacklistCallFailureQuarantinesFailClosed`
- `test_ResolveQuarantineRejectsHighFeeBps`
- `test_ResolveQuarantineRejectsZeroFeeRecipientWithFee`

---

## Audit Provenance

| Subagent | Dispatched | Files audited | Corpus rules cited |
|---|---|---|---|
| solidity-auditor | yes | 3 | none |
| functional-auditor | yes | 2 | — |
