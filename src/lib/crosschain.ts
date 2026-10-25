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
}

const TESTNET_SOURCES: SourceChain[] = [
  { key: 'Base_Sepolia', name: 'Base Sepolia', chainId: 84532 },
  { key: 'Ethereum_Sepolia', name: 'Ethereum Sepolia', chainId: 11155111 },
  { key: 'Arbitrum_Sepolia', name: 'Arbitrum Sepolia', chainId: 421614 },
]

const MAINNET_SOURCES: SourceChain[] = [
  { key: 'Base', name: 'Base', chainId: 8453 },
  { key: 'Ethereum', name: 'Ethereum', chainId: 1 },
  { key: 'Arbitrum', name: 'Arbitrum', chainId: 42161 },
  { key: 'Optimism', name: 'OP Mainnet', chainId: 10 },
  { key: 'Polygon', name: 'Polygon', chainId: 137 },
  { key: 'Avalanche', name: 'Avalanche', chainId: 43114 },
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
