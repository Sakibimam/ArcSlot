// Plan how to recover USDC a payer sent to a Slot address on the wrong chain.
// Slot, factory and vault addresses are identical on every chain (deterministic
// deploy), so recovery deploys whatever is missing there and collects.

export type RecoveryStep = 'createVault' | 'createSlot' | 'collect' | 'withdraw'

export interface VaultSettings {
  owner: string
  pqKey: string
  twoKey: boolean
  recoveryDelay: string
  salt: string
}

export type RecoveryPlan =
  | { ok: true; steps: RecoveryStep[] }
  | { ok: false; reason: 'not-deployed' | 'vault-settings-missing' | 'not-yours' }

export function planRecovery(s: {
  /** SlotFactory deployed on the foreign chain */
  factoryThere: boolean
  slotThere: boolean
  /** Who the slot pays: the connected wallet, the wallet's vault, or someone else */
  payout: 'wallet' | 'vault' | 'other'
  vaultThere?: boolean
  vault?: VaultSettings
}): RecoveryPlan {
  if (s.payout === 'other') return { ok: false, reason: 'not-yours' }
  if (!s.factoryThere) return { ok: false, reason: 'not-deployed' }
  const steps: RecoveryStep[] = []
  if (s.payout === 'vault') {
    if (!s.vaultThere && !s.vault) return { ok: false, reason: 'vault-settings-missing' }
    if (!s.vaultThere) steps.push('createVault')
  }
  if (!s.slotThere) steps.push('createSlot')
  steps.push('collect')
  if (s.payout === 'vault') steps.push('withdraw')
  return { ok: true, steps }
}
