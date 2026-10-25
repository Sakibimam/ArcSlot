// Pure slot logic, kept out of components so it can be unit tested.

import { decodeEventLog, isAddressEqual, keccak256, toHex, type Hex } from 'viem'
import { SLOT_ABI } from './abis'

export interface ReceiptData {
  gross: bigint
  net: bigint
  fee: bigint
  reimbursement: bigint
  sweeper: string
  txHash: string
}

export type SlotStatus = 'loading' | 'awaiting' | 'below-minimum' | 'funded' | 'swept' | 'quarantined'

export function deriveSlotStatus(s: {
  loading: boolean
  quarantined: boolean | undefined
  balance: bigint | undefined
  minSweep: bigint | undefined
  receipt: ReceiptData | undefined
}): SlotStatus {
  if (s.loading || s.balance === undefined || s.minSweep === undefined) return 'loading'
  if (s.quarantined) return 'quarantined'
  if (s.balance === 0n) return s.receipt ? 'swept' : 'awaiting'
  return s.balance < s.minSweep ? 'below-minimum' : 'funded'
}

export function canSweep(status: SlotStatus): boolean {
  return status === 'funded'
}

// ─── Payment-request view (merchant + sender UI) ─────────────────────────────

export type RequestStatus = 'loading' | 'waiting' | 'partial' | 'paid' | 'below-minimum' | 'collected' | 'on-hold'

/**
 * Status of a payment request. `collected` is the slot's on-chain totalCollected,
 * so a request reads as collected on any device, not only where it was swept.
 */
export function deriveRequestStatus(
  s: Parameters<typeof deriveSlotStatus>[0] & { amount: bigint | undefined; collected?: bigint },
): RequestStatus {
  const collected = s.collected ?? 0n
  const base = deriveSlotStatus({ ...s, receipt: s.receipt ?? (collected > 0n ? COLLECTED_MARKER : undefined) })
  if (base === 'loading') return 'loading'
  if (base === 'quarantined') return 'on-hold'
  if (base === 'swept') return 'collected'
  if (base === 'awaiting') return 'waiting'
  const balance = s.balance ?? 0n
  if (s.amount !== undefined) return isRequestPaid(s.amount, balance, collected) ? 'paid' : 'partial'
  return base === 'funded' ? 'paid' : 'below-minimum'
}

const COLLECTED_MARKER: ReceiptData = { gross: 0n, net: 0n, fee: 0n, reimbursement: 0n, sweeper: '', txHash: '' }

/** Paid once what's waiting plus what was already collected covers the amount. */
export function isRequestPaid(amount: bigint | undefined, balance: bigint, collected: bigint): boolean {
  const total = balance + collected
  return amount === undefined ? total > 0n : total >= amount
}

/**
 * Anyone can create a request naming any payee, so a request is only "verified"
 * when the payee itself, or the owner of the payee's vault, created it.
 */
export function requestTrust(r: { creator: string; merchant: string; vaultOwner: string | undefined }): 'verified' | 'unverified' {
  const c = r.creator.toLowerCase()
  if (c === r.merchant.toLowerCase()) return 'verified'
  if (r.vaultOwner && c === r.vaultOwner.toLowerCase()) return 'verified'
  return 'unverified'
}

/** EIP-1167 runtime code of a minimal proxy (clone) pointing at `impl`. */
export function minimalProxyCode(impl: string): string {
  return `0x363d3d373d3d3d363d73${impl.slice(2).toLowerCase()}5af43d82803e903d91602b57fd5bf3`
}

/** True only for a genuine clone of `impl` — not a contract that merely mimics its views. */
export function isMinimalProxyTo(code: string | undefined, impl: string): boolean {
  return !!code && code.toLowerCase() === minimalProxyCode(impl)
}

/** The contract accepts a sweep once the balance reaches minSweep. */
export function canCollect(status: RequestStatus, balance: bigint | undefined, minSweep: bigint | undefined): boolean {
  if (status !== 'paid' && status !== 'partial') return false
  return balance !== undefined && minSweep !== undefined && balance >= minSweep
}

/** bytes32 reference: label + random salt, so a merchant can reuse labels. */
export function makePayRef(label: string, salt: string): Hex {
  return keccak256(toHex(`${label}#${salt}`))
}

/** Open on mainnet once it is deployed, otherwise testnet. */
export function pickDefaultChain(factories: Record<5042 | 5042002, string | null>): 5042 | 5042002 {
  return factories[5042] ? 5042 : 5042002
}

/** Parse a user-entered USDC amount ("0.05") into 6-decimal units. */
export function parseUsdc6(input: string): bigint | null {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(input.trim())
  if (!m) return null
  return BigInt(m[1]) * 1_000_000n + BigInt((m[2] ?? '').padEnd(6, '0'))
}

/** Format 6-decimal USDC units: at least 2 decimals, up to 6, trailing zeros trimmed. */
export function formatUsdc6(raw: bigint): string {
  const whole = raw / 1_000_000n
  let frac = (raw % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '')
  if (frac.length < 2) frac = frac.padEnd(2, '0')
  return `${whole}.${frac}`
}

/** Extract the sweep result from the sweep tx's own receipt logs (no eth_getLogs). */
export function decodeSweepReceipt(
  logs: readonly { address: string; topics: readonly Hex[]; data: Hex }[],
  slotAddress: string,
  txHash: string,
): ReceiptData | null {
  for (const log of logs) {
    if (!isAddressEqual(log.address as Hex, slotAddress as Hex)) continue
    try {
      const ev = decodeEventLog({
        abi: SLOT_ABI,
        eventName: 'Received',
        topics: log.topics as [Hex, ...Hex[]],
        data: log.data,
      })
      const { gross, net, fee, reimbursement, sweeper } = ev.args
      return { gross, net, fee, reimbursement, sweeper, txHash }
    } catch {
      // not a Received log
    }
  }
  return null
}

// ─── Persistence ─────────────────────────────────────────────────────────────
// Slots the user created or swept are remembered locally so they survive a
// refresh. Live state is always re-read from view functions.

export interface StoredSlot {
  address: string
  chainId: number
  receipt?: ReceiptData
  /** Human label ("Invoice #42") — on-chain only its hash is stored. */
  label?: string
  /** Requested amount (6-dec). Off-chain; the contract accepts any amount. */
  amount?: bigint
  createdAt?: number
  /** Amount, label and expiry are stored on-chain (SlotFactory.createRequest). */
  onchain?: boolean
}

const STORAGE_KEY = 'arc-slot:slots:v1'

export function saveSlots(slots: StoredSlot[]): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(slots, (_k, v: unknown) => (typeof v === 'bigint' ? { $big: v.toString() } : v)),
    )
  } catch {
    // storage unavailable (private mode) — slots stay in memory only
  }
}

export function loadSlots(): StoredSlot[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw, (_k, v: unknown) => {
      const big = v && typeof v === 'object' ? (v as { $big?: unknown }).$big : undefined
      return typeof big === 'string' ? BigInt(big) : v
    })
    return Array.isArray(parsed) ? (parsed as StoredSlot[]) : []
  } catch {
    return []
  }
}
