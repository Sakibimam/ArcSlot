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
  /** usePublicClient().readContract — keyed by functionName. */
  publicReads: {} as Record<string, unknown>,
  publicReadContract: vi.fn(),
  signMessageAsync: vi.fn(),
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
  wagmiState.publicReads = {}
  wagmiState.publicReadContract = vi.fn((args: { functionName: string }) => {
    if (!(args.functionName in wagmiState.publicReads)) return Promise.reject(new Error(`no mock for ${args.functionName}`))
    return Promise.resolve(wagmiState.publicReads[args.functionName])
  })
  wagmiState.signMessageAsync = vi.fn(() => Promise.resolve(`0x${'0b'.repeat(65)}`))
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
  usePublicClient: () => ({ readContract: wagmiState.publicReadContract }),
  useSignMessage: () => ({ signMessageAsync: wagmiState.signMessageAsync }),
}

export const connectkitModule = {
  ConnectKitButton: () => <button type="button">Connect Wallet</button>,
}
