// Pay a Slot from another chain: burn USDC on the payer's chain via CCTP and
// have Circle's Forwarding Service mint it straight into the Slot on Arc.
// "Receive exact" (feePayment: 'source') means the Slot gets exactly the
// requested amount; the payer covers the fees on their side.

import { formatUsdc6, parseUsdc6 } from './slot-logic'

export interface SourceChain {
  /** App Kit chain name */
  key: string
  name: string
  chainId: number
  /** Native token that pays gas on this chain */
  gasToken: string
}

const TESTNET_SOURCES: SourceChain[] = [
  { key: 'Base_Sepolia', name: 'Base Sepolia', chainId: 84532, gasToken: 'ETH' },
  { key: 'Ethereum_Sepolia', name: 'Ethereum Sepolia', chainId: 11155111, gasToken: 'ETH' },
  { key: 'Arbitrum_Sepolia', name: 'Arbitrum Sepolia', chainId: 421614, gasToken: 'ETH' },
]

const MAINNET_SOURCES: SourceChain[] = [
  { key: 'Base', name: 'Base', chainId: 8453, gasToken: 'ETH' },
  { key: 'Ethereum', name: 'Ethereum', chainId: 1, gasToken: 'ETH' },
  { key: 'Arbitrum', name: 'Arbitrum', chainId: 42161, gasToken: 'ETH' },
  { key: 'Optimism', name: 'OP Mainnet', chainId: 10, gasToken: 'ETH' },
  { key: 'Polygon', name: 'Polygon', chainId: 137, gasToken: 'POL' },
  { key: 'Avalanche', name: 'Avalanche', chainId: 43114, gasToken: 'AVAX' },
]

export function sourceChainsFor(arcChainId: number): SourceChain[] {
  return arcChainId === 5042 ? MAINNET_SOURCES : TESTNET_SOURCES
}

export function arcBridgeChain(arcChainId: number): 'Arc' | 'Arc_Testnet' {
  return arcChainId === 5042 ? 'Arc' : 'Arc_Testnet'
}

export function buildPaymentParams(p: { slot: string; amount: bigint; arcChainId: number }) {
  if (p.amount <= 0n) throw new Error('Amount must be greater than zero')
  return {
    to: { chain: arcBridgeChain(p.arcChainId), recipientAddress: p.slot, useForwarder: true as const },
    amount: formatUsdc6(p.amount),
    config: { feePayment: 'source' as const },
  }
}

export interface QuoteSummary {
  receives: bigint
  fee: bigint
  debit: bigint
}

export function summarizeQuote(q: { amountReceived: string; feeTotal: string; totalDebit: string }): QuoteSummary {
  const receives = parseUsdc6(q.amountReceived)
  const fee = parseUsdc6(q.feeTotal)
  const debit = parseUsdc6(q.totalDebit)
  if (receives === null || fee === null || debit === null) throw new Error('Malformed bridge quote')
  return { receives, fee, debit }
}

/**
 * A quote is only payable if the slot receives exactly what was asked; the
 * fee share is surfaced so a payer isn't surprised by a large relayer fee.
 */
export function checkQuote(q: QuoteSummary, requested: bigint): { ok: false } | { ok: true; highFee: boolean; feePercent: number } {
  if (q.receives !== requested) return { ok: false }
  const feePercent = Number((q.fee * 100n + requested / 2n) / requested)
  return { ok: true, highFee: q.fee * 4n > requested, feePercent }
}

/**
 * Turn an App Kit / wallet error from paying on another chain into one plain sentence that
 * says what to do. App Kit errors carry a code in `name` (e.g. BALANCE_INSUFFICIENT_GAS);
 * wallets and RPCs only give a message, so both are checked.
 */
export function explainCrossChainError(e: unknown, chain: { name: string; gasToken: string }, debit: string): string {
  const name = (e as { name?: string } | null)?.name ?? ''
  const raw = e instanceof Error ? e.message : String(e)
  const msg = raw.toLowerCase()
  if (name === 'INPUT_USER_CANCELLED' || /user (rejected|denied)|rejected the request|request rejected|denied transaction/.test(msg))
    return 'You cancelled the payment.'
  if (name === 'BALANCE_INSUFFICIENT_GAS' || /insufficient funds for (gas|intrinsic)|insufficient funds for transfer/.test(msg))
    return `Not enough ${chain.gasToken} on ${chain.name} to pay gas. Add a little ${chain.gasToken} to this wallet and try again. Nothing was sent.`
  if (name === 'BALANCE_INSUFFICIENT_TOKEN' || /exceeds balance|insufficient (usdc|token|balance)/.test(msg))
    return `You need ${debit} USDC on ${chain.name}, and this wallet has less. Nothing was sent.`
  if (name === 'INPUT_CHAIN_SWITCH_REJECTED' || name === 'NETWORK_MISMATCH' || name === 'INPUT_NETWORK_MISMATCH' || /chain mismatch|switch.*chain/.test(msg))
    return `Switch your wallet to ${chain.name}, then try again. Nothing was sent.`
  if (name === 'NETWORK_CONNECTION_FAILED' || name === 'NETWORK_TIMEOUT' || /failed to fetch|network ?error|load failed|timed? ?out/.test(msg))
    return "Couldn't reach Circle's payment service. Check your connection, and if you use an ad blocker or Brave Shields, allow this site. Nothing was sent."
  if (name === 'RATE_LIMIT_EXCEEDED' || /rate limit|too many requests|429/.test(msg))
    return 'Circle is busy right now. Wait a minute and try again. Nothing was sent.'
  if (/quote.*expir|expired/.test(msg))
    return 'The quote expired. Press Review again for a fresh one. Nothing was sent.'
  const short = raw.replace(/\s+/g, ' ').trim()
  return `Payment failed and nothing was sent: ${short.length > 140 ? `${short.slice(0, 140)}…` : short}`
}
