// Loads the payment requests a wallet created, straight from the SlotFactory's
// on-chain index, so the dashboard works on any device.

import { useReadContract, useReadContracts } from 'wagmi'
import { SLOT_FACTORY_ABI } from './abis'
import { type SupportedChainId, getFactoryAddress } from './chains'
import type { StoredSlot } from './slot-logic'

const PAGE = 200n

export interface ChainRequest {
  exists: boolean
  creator: string
  merchant: string
  amount: bigint
  createdAt: bigint
  expiresAt: bigint
  label: string
}

export function useChainRequests(chainId: SupportedChainId, owner: string | undefined): StoredSlot[] {
  const factory = getFactoryAddress(chainId)
  const { data: slots } = useReadContract({
    address: factory ?? undefined,
    abi: SLOT_FACTORY_ABI,
    functionName: 'requestsOf',
    args: owner ? [owner as `0x${string}`, 0n, PAGE] : undefined,
    chainId,
    query: { enabled: !!factory && !!owner, refetchInterval: 15_000 },
  })
  const list = (slots as readonly string[] | undefined) ?? []
  const { data } = useReadContracts({
    contracts: list.map((s) => ({
      address: factory!,
      abi: SLOT_FACTORY_ABI,
      functionName: 'requestOf' as const,
      args: [s as `0x${string}`] as const,
      chainId,
    })),
    query: { enabled: !!factory && list.length > 0 },
  })
  if (!owner || !factory) return []

  const out: StoredSlot[] = []
  list.forEach((address, i) => {
    const r = data?.[i]?.result as ChainRequest | undefined
    if (!r?.exists) return
    out.push({
      address,
      chainId,
      label: r.label,
      amount: r.amount > 0n ? r.amount : undefined,
      createdAt: Number(r.createdAt) * 1000,
    })
  })
  return out.reverse()
}
