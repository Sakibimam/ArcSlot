import { describe, it, expect } from 'vitest'
import { planRecovery } from './recovery'

const vaultSettings = { owner: '0x1', pqKey: `0x${'ab'.repeat(32)}`, twoKey: true, recoveryDelay: '604800', salt: `0x${'12'.repeat(32)}` }

describe('planRecovery', () => {
  it('wallet merchant: deploy the slot there, then collect', () => {
    expect(planRecovery({ factoryThere: true, slotThere: false, payout: 'wallet' })).toEqual({ ok: true, steps: ['createSlot', 'collect'] })
  })
  it('wallet merchant: just collect when the slot already exists there', () => {
    expect(planRecovery({ factoryThere: true, slotThere: true, payout: 'wallet' })).toEqual({ ok: true, steps: ['collect'] })
  })
  it('vault merchant: recreate the vault, deploy the slot, collect, withdraw to the owner', () => {
    expect(planRecovery({ factoryThere: true, slotThere: false, payout: 'vault', vaultThere: false, vault: vaultSettings }))
      .toEqual({ ok: true, steps: ['createVault', 'createSlot', 'collect', 'withdraw'] })
  })
  it('vault merchant: skips what already exists', () => {
    expect(planRecovery({ factoryThere: true, slotThere: true, payout: 'vault', vaultThere: true, vault: vaultSettings }))
      .toEqual({ ok: true, steps: ['collect', 'withdraw'] })
  })
  it('is unavailable where the contracts are not deployed', () => {
    expect(planRecovery({ factoryThere: false, slotThere: false, payout: 'wallet' })).toEqual({ ok: false, reason: 'not-deployed' })
  })
  it('needs the vault settings to recreate the vault', () => {
    expect(planRecovery({ factoryThere: true, slotThere: false, payout: 'vault', vaultThere: false, vault: undefined }))
      .toEqual({ ok: false, reason: 'vault-settings-missing' })
  })
  // v8 (audit M-1): recovery no longer depends on the creator's wallet; it only
  // refuses when the factory there would not produce the paid address.
  it('refuses when the redeployed address would not match the paid one', () => {
    expect(planRecovery({ factoryThere: true, slotThere: false, payout: 'wallet', addressMatches: false }))
      .toEqual({ ok: false, reason: 'address-mismatch' })
  })
  it('recovers even when someone else created the request', () => {
    expect(planRecovery({ factoryThere: true, slotThere: false, payout: 'wallet', addressMatches: true }))
      .toEqual({ ok: true, steps: ['createSlot', 'collect'] })
  })
  it('cannot recover for someone else', () => {
    expect(planRecovery({ factoryThere: true, slotThere: false, payout: 'other' })).toEqual({ ok: false, reason: 'not-yours' })
  })
})
