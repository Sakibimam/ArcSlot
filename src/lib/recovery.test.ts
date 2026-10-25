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
  // Slot addresses commit to their creator (audit H-1): another wallet would deploy elsewhere.
  it('only the wallet that created the request can redeploy its slot', () => {
    expect(planRecovery({ factoryThere: true, slotThere: false, payout: 'wallet', creatorMatches: false }))
      .toEqual({ ok: false, reason: 'not-creator' })
  })
  it('anyone with the payout can collect once the slot exists there', () => {
    expect(planRecovery({ factoryThere: true, slotThere: true, payout: 'wallet', creatorMatches: false }))
      .toEqual({ ok: true, steps: ['collect'] })
  })
  it('cannot recover for someone else', () => {
    expect(planRecovery({ factoryThere: true, slotThere: false, payout: 'other' })).toEqual({ ok: false, reason: 'not-yours' })
  })
})
