// Platform totals, read straight from the contracts: every request the factory created, how much USDC each
// slot has received (collected so far + still waiting), so anyone can verify the numbers on-chain.
import { erc20Abi } from 'viem'
import { SLOT_ABI, SLOT_FACTORY_ABI } from '@/lib/abis'
import { USDC_ADDRESS } from '@/lib/chains'

export interface NetworkStats {
  requests: number
  paid: number
  /** USDC received by all requests: collected + still waiting in the slots */
  received: bigint
  collected: bigint
  waiting: bigint
  largest: bigint
}

export function summarize(rows: { collected: bigint; balance: bigint }[]): NetworkStats {
  let received = 0n, collected = 0n, waiting = 0n, largest = 0n, paid = 0
  for (const r of rows) {
    const total = r.collected + r.balance
    if (total > 0n) paid++
    received += total
    collected += r.collected
    waiting += r.balance
    if (total > largest) largest = total
  }
  return { requests: rows.length, paid, received, collected, waiting, largest }
}

interface StatsClient {
  readContract: (args: { address: `0x${string}`; abi: typeof SLOT_FACTORY_ABI; functionName: 'slotCount' | 'slotsPage'; args?: readonly bigint[] }) => Promise<unknown>
  multicall: (args: { contracts: { address: `0x${string}`; abi: unknown; functionName: string; args?: readonly unknown[] }[]; allowFailure: false }) => Promise<unknown[]>
}

const PAGE = 200n // requests per page and per multicall (2 reads each)

export async function loadNetworkStats(client: StatsClient, factory: `0x${string}`): Promise<NetworkStats> {
  const count = (await client.readContract({ address: factory, abi: SLOT_FACTORY_ABI, functionName: 'slotCount' })) as bigint
  const rows: { collected: bigint; balance: bigint }[] = []
  for (let offset = 0n; offset < count; offset += PAGE) {
    const slots = (await client.readContract({ address: factory, abi: SLOT_FACTORY_ABI, functionName: 'slotsPage', args: [offset, PAGE] })) as `0x${string}`[]
    const results = (await client.multicall({
      allowFailure: false,
      contracts: slots.flatMap((s) => [
        { address: s, abi: SLOT_ABI, functionName: 'totalCollected' },
        { address: USDC_ADDRESS, abi: erc20Abi, functionName: 'balanceOf', args: [s] },
      ]),
    })) as bigint[]
    for (let i = 0; i < slots.length; i++) rows.push({ collected: results[2 * i], balance: results[2 * i + 1] })
  }
  return summarize(rows)
}
