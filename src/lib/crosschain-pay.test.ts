import { describe, it, expect, vi } from 'vitest'

// Fake App Kit that emits the documented per-step events during bridge().
const handlers = new Map<string, Set<(p: unknown) => void>>()
const bridge = vi.fn(() => {
  for (const ev of ['bridge.approve', 'bridge.burn', 'bridge.fetchAttestation', 'bridge.mint']) {
    handlers.get(ev)?.forEach((h) => h({ values: { txHash: '0x1' } }))
  }
  return Promise.resolve({ state: 'success', steps: [] })
})
vi.mock('@circle-fin/app-kit', () => ({
  AppKit: class {
    on(ev: string, h: (p: unknown) => void) { (handlers.get(ev) ?? handlers.set(ev, new Set()).get(ev)!).add(h) }
    off(ev: string, h: (p: unknown) => void) { handlers.get(ev)?.delete(h) }
    bridge = bridge
  },
}))
vi.mock('@circle-fin/adapter-viem-v2', () => ({ createViemAdapterFromProvider: () => Promise.resolve({}) }))

import { sendCrossChainPayment } from './crosschain-pay'

describe('sendCrossChainPayment', () => {
  const req = { provider: {} as never, source: 'Base_Sepolia', slot: '0x047508895350F679424507a7ae62e13bc2e015a9', amount: 1_500_000n, arcChainId: 5042002, quote: '0xq' }

  it('reports every step in order', async () => {
    const steps: string[] = []
    await sendCrossChainPayment({ ...req, onStep: (s) => steps.push(s) })
    expect(steps).toEqual(['approve', 'burn', 'fetchAttestation', 'mint'])
  })

  it('passes the slot as recipient, forwarder on, receive-exact, with the quote', async () => {
    await sendCrossChainPayment(req)
    const arg = (bridge.mock.lastCall as unknown as [{ from: { chain: string }; to: unknown; amount: string; config: unknown; quote: string }])[0]
    expect(arg.from.chain).toBe('Base_Sepolia')
    expect(arg.to).toEqual({ chain: 'Arc_Testnet', recipientAddress: req.slot, useForwarder: true })
    expect(arg.amount).toBe('1.50')
    expect(arg.config).toEqual({ feePayment: 'source' })
    expect(arg.quote).toBe('0xq')
  })

  it('unsubscribes afterwards so later payments do not double-report', async () => {
    await sendCrossChainPayment(req)
    const total = [...handlers.values()].reduce((n, s) => n + s.size, 0)
    expect(total).toBe(0)
  })
})
