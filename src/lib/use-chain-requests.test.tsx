import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { wagmiState, wagmiModule, resetWagmi } from '@/test/wagmi-mock'

vi.mock('wagmi', () => wagmiModule)

import { useChainRequests } from './use-chain-requests'

const ME = '0x1111111111111111111111111111111111111111'
const S1 = '0x00000000000000000000000000000000000000a1'
const S2 = '0x00000000000000000000000000000000000000a2'

beforeEach(() => resetWagmi())

describe('useChainRequests', () => {
  it('returns nothing without a wallet', () => {
    const { result } = renderHook(() => useChainRequests(5042002, undefined))
    expect(result.current).toEqual([])
  })

  it('turns the creator index into stored-slot entries, newest first', () => {
    wagmiState.readByFn = { requestsOf: [S1, S2] }
    wagmiState.readContracts = {
      isLoading: false, isError: false,
      data: [
        { result: { exists: true, creator: ME, merchant: ME, amount: 1_000_000n, createdAt: 100n, expiresAt: 0n, label: 'One' } },
        { result: { exists: true, creator: ME, merchant: ME, amount: 0n, createdAt: 200n, expiresAt: 0n, label: 'Two' } },
      ],
    }
    const { result } = renderHook(() => useChainRequests(5042002, ME))
    expect(result.current).toEqual([
      { address: S2, chainId: 5042002, label: 'Two', amount: undefined, createdAt: 200_000 },
      { address: S1, chainId: 5042002, label: 'One', amount: 1_000_000n, createdAt: 100_000 },
    ])
  })
})
