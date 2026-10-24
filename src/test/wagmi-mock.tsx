// Controllable wagmi hook mock for component integration tests.
import { vi } from 'vitest'

type ReadArgs = { functionName?: string; args?: readonly unknown[]; query?: { enabled?: boolean } }

export const wagmiState = {
  account: { address: undefined as string | undefined, chainId: undefined as number | undefined },
  readContracts: { data: undefined as unknown, isLoading: false, isError: false },
  /** Default result for useReadContract. */
  readContract: { data: undefined as unknown },
  /** Per-functionName overrides for useReadContract. */
  readByFn: {} as Record<string, unknown>,
  write: { data: undefined as string | undefined, isPending: false, error: null as Error | null },
  waitReceipt: { data: undefined as unknown, isLoading: false, isSuccess: false },
  writeContract: vi.fn(),
  switchChain: vi.fn(),
  refetch: vi.fn(),
  resetWrite: vi.fn(),
}

export function resetWagmi() {
  wagmiState.account = { address: undefined, chainId: undefined }
  wagmiState.readContracts = { data: undefined, isLoading: false, isError: false }
  wagmiState.readContract = { data: undefined }
  wagmiState.readByFn = {}
  wagmiState.write = { data: undefined, isPending: false, error: null }
  wagmiState.waitReceipt = { data: undefined, isLoading: false, isSuccess: false }
  wagmiState.writeContract = vi.fn()
  wagmiState.switchChain = vi.fn()
  wagmiState.refetch = vi.fn()
  wagmiState.resetWrite = vi.fn()
}

export const wagmiModule = {
  useAccount: () => wagmiState.account,
  useReadContracts: () => ({ ...wagmiState.readContracts, refetch: wagmiState.refetch }),
  useReadContract: (args: ReadArgs) => {
    if (args.query?.enabled === false) return { data: undefined, refetch: wagmiState.refetch }
    const fn = args.functionName ?? ''
    const data = fn in wagmiState.readByFn ? wagmiState.readByFn[fn] : wagmiState.readContract.data
    return { data, refetch: wagmiState.refetch }
  },
  useWriteContract: () => ({ ...wagmiState.write, writeContract: wagmiState.writeContract, reset: wagmiState.resetWrite }),
  useWaitForTransactionReceipt: () => wagmiState.waitReceipt,
  useSwitchChain: () => ({ switchChain: wagmiState.switchChain, isPending: false }),
}

export const connectkitModule = {
  ConnectKitButton: () => <button type="button">Connect Wallet</button>,
}
