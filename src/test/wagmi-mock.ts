// Controllable wagmi hook mock for component integration tests.
import { vi } from 'vitest'

export const wagmiState = {
  account: { address: undefined as string | undefined, chainId: undefined as number | undefined },
  readContracts: { data: undefined as unknown, isLoading: false },
  readContract: { data: undefined as unknown },
  write: { data: undefined as string | undefined, isPending: false, error: null as Error | null },
  waitReceipt: { data: undefined as unknown, isLoading: false, isSuccess: false },
  writeContract: vi.fn(),
  refetch: vi.fn(),
}

export function resetWagmi() {
  wagmiState.account = { address: undefined, chainId: undefined }
  wagmiState.readContracts = { data: undefined, isLoading: false }
  wagmiState.readContract = { data: undefined }
  wagmiState.write = { data: undefined, isPending: false, error: null }
  wagmiState.waitReceipt = { data: undefined, isLoading: false, isSuccess: false }
  wagmiState.writeContract = vi.fn()
  wagmiState.refetch = vi.fn()
}

export const wagmiModule = {
  useAccount: () => wagmiState.account,
  useReadContracts: () => ({ ...wagmiState.readContracts, refetch: wagmiState.refetch }),
  useReadContract: (args: { query?: { enabled?: boolean } }) =>
    args.query?.enabled === false ? { data: undefined } : wagmiState.readContract,
  useWriteContract: () => ({ ...wagmiState.write, writeContract: wagmiState.writeContract }),
  useWaitForTransactionReceipt: () => wagmiState.waitReceipt,
}
