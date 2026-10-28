import { describe, it, expect, vi } from 'vitest'
import { summarize, loadNetworkStats } from './stats'

describe('summarize', () => {
  it('counts requests, paid requests, USDC received (collected + waiting) and the largest payment', () => {
    expect(summarize([
      { collected: 1_000_000n, balance: 0n },
      { collected: 0n, balance: 0n },
      { collected: 150_000n, balance: 250_000n },
    ])).toEqual({ requests: 3, paid: 2, received: 1_400_000n, collected: 1_150_000n, waiting: 250_000n, largest: 1_000_000n })
  })
  it('is all zeros with no requests', () => {
    expect(summarize([])).toEqual({ requests: 0, paid: 0, received: 0n, collected: 0n, waiting: 0n, largest: 0n })
  })
})

describe('loadNetworkStats', () => {
  const slots = Array.from({ length: 450 }, (_, i) => `0x${(i + 1).toString(16).padStart(40, '0')}`)
  const fakeClient = () => ({
    readContract: vi.fn(({ functionName, args }: { functionName: string; args?: readonly bigint[] }) => {
      if (functionName === 'slotCount') return Promise.resolve(BigInt(slots.length))
      const [offset, limit] = args as bigint[]
      return Promise.resolve(slots.slice(Number(offset), Number(offset + limit)))
    }),
    // every slot collected 1 USDC and holds 0.5 more
    multicall: vi.fn(({ contracts }: { contracts: { functionName: string }[] }) =>
      Promise.resolve(contracts.map((c) => (c.functionName === 'totalCollected' ? 1_000_000n : 500_000n)))),
  })

  it('reads every request from the factory in pages and batches the per-request reads', async () => {
    const client = fakeClient()
    const s = await loadNetworkStats(client, '0x849eE5AEd72d1Ba5ADa092e0d68C4B2D161BE9c3')
    expect(s.requests).toBe(450)
    expect(s.paid).toBe(450)
    expect(s.received).toBe(450n * 1_500_000n)
    // pages of 200 requests, and no single multicall bigger than 400 calls (200 requests x 2 reads)
    expect(client.readContract.mock.calls.filter((c) => c[0].functionName === 'slotsPage')).toHaveLength(3)
    for (const [call] of client.multicall.mock.calls) expect(call.contracts.length).toBeLessThanOrEqual(400)
  })

  it('a factory with no requests yet', async () => {
    const client = { readContract: vi.fn(() => Promise.resolve(0n)), multicall: vi.fn() }
    expect((await loadNetworkStats(client, '0x849eE5AEd72d1Ba5ADa092e0d68C4B2D161BE9c3')).requests).toBe(0)
    expect(client.multicall).not.toHaveBeenCalled()
  })
})
