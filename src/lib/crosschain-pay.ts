// Thin wrapper around Circle App Kit for paying a Slot from another chain.
// Kept separate from the UI so components can be tested with a mock.

import { AppKit, type BridgeResult } from '@circle-fin/app-kit'
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2'
import type { EIP1193Provider } from 'viem'
import { type QuoteSummary, buildPaymentParams, summarizeQuote } from './crosschain'

let kit: AppKit | undefined
const getKit = () => (kit ??= new AppKit())

export interface CrossChainRequest {
  provider: EIP1193Provider
  /** App Kit source chain name, e.g. "Base_Sepolia" */
  source: string
  slot: string
  amount: bigint
  arcChainId: number
}

export interface CrossChainQuote {
  summary: QuoteSummary
  /** Opaque signed quote; passed back unchanged to bridge(). */
  quote: string
}

export type PaymentStep = 'approve' | 'burn' | 'fetchAttestation' | 'mint'

export async function quoteCrossChainPayment(r: CrossChainRequest): Promise<CrossChainQuote> {
  const adapter = await createViemAdapterFromProvider({ provider: r.provider })
  const params = buildPaymentParams(r)
  const est = await getKit().estimateBridge({ from: { adapter, chain: r.source as never }, ...params })
  return { summary: summarizeQuote(est), quote: est.quote }
}

/**
 * Burn on the source chain; Circle's forwarder mints straight into the slot.
 * Only call from an explicit user action. Returns the result for recovery.
 */
export async function sendCrossChainPayment(
  r: CrossChainRequest & { quote: string; onStep?: (step: PaymentStep) => void },
): Promise<BridgeResult> {
  const adapter = await createViemAdapterFromProvider({ provider: r.provider })
  const k = getKit()
  // App Kit emits one event per CCTP step ('bridge.approve', 'bridge.burn', …).
  const steps: PaymentStep[] = ['approve', 'burn', 'fetchAttestation', 'mint']
  const handlers = steps.map((step) => [`bridge.${step}`, () => r.onStep?.(step)] as const)
  for (const [ev, h] of handlers) k.on(ev as never, h)
  try {
    return await k.bridge({
      from: { adapter, chain: r.source as never },
      ...buildPaymentParams(r),
      quote: r.quote,
    })
  } finally {
    for (const [ev, h] of handlers) k.off(ev as never, h)
  }
}

/** Resume a payment that stopped mid-way (never re-run bridge from scratch). */
export async function retryCrossChainPayment(result: BridgeResult, provider: EIP1193Provider): Promise<BridgeResult> {
  const adapter = await createViemAdapterFromProvider({ provider })
  return (await getKit().retryBridge(result, { from: adapter, to: adapter }))
}
