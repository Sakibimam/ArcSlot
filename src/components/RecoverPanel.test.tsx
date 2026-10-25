import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { wagmiState, wagmiModule, connectkitModule, resetWagmi } from '@/test/wagmi-mock'

vi.mock('wagmi', () => wagmiModule)
vi.mock('connectkit', () => connectkitModule)
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/recovery-io', () => ({ chainIO: () => ({}) }))
vi.mock('@/lib/recovery-exec', () => ({ probeRecovery: vi.fn(), executeRecovery: vi.fn() }))

import { probeRecovery, executeRecovery } from '@/lib/recovery-exec'
import { RecoverPanel } from './RecoverPanel'
import { saveVault } from '@/lib/vault-store'

const ME = '0x1111111111111111111111111111111111111111'
const SLOT = '0x00000000000000000000000000000000000000a1'
const VAULT = '0x00000000000000000000000000000000000000b2'
const REF = `0x${'77'.repeat(32)}`

const CREATOR = '0x2222222222222222222222222222222222222222'
/** [merchant, payRef, creatorOf, Base Sepolia, Ethereum Sepolia, Arbitrum Sepolia] (sourceChainsFor order) */
function reads(merchant: string, stray: [bigint, bigint, bigint]) {
  wagmiState.readContracts = {
    isLoading: false, isError: false,
    data: [{ result: merchant }, { result: REF }, { result: CREATOR }, ...stray.map((r) => ({ result: r }))],
  }
}

beforeEach(() => {
  resetWagmi()
  wagmiState.account = { ...wagmiState.account, address: ME, chainId: 5042002 }
  vi.mocked(probeRecovery).mockReset().mockResolvedValue({ factoryThere: true, slotThere: false, vaultThere: false, addressMatches: true })
  vi.mocked(executeRecovery).mockReset().mockResolvedValue({ recovered: 50_000n })
})

describe('RecoverPanel', () => {
  it('renders nothing when no USDC landed on another chain', () => {
    reads(ME, [0n, 0n, 0n])
    const { container } = render(<RecoverPanel arcChainId={5042002} slot={SLOT} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('flags USDC sent on the wrong chain', () => {
    reads(ME, [50_000n, 0n, 0n])
    render(<RecoverPanel arcChainId={5042002} slot={SLOT} />)
    expect(screen.getByText(/0\.05 usdc was sent on base sepolia by mistake/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /recover/i })).toBeInTheDocument()
  })

  it('does not offer recovery for someone else’s payment address', () => {
    reads('0x9999999999999999999999999999999999999999', [50_000n, 0n, 0n])
    render(<RecoverPanel arcChainId={5042002} slot={SLOT} />)
    expect(screen.getByText(/only the payee can recover/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /recover/i })).not.toBeInTheDocument()
  })

  it('recovers to the wallet: switch chain, probe, deploy + collect', async () => {
    reads(ME, [0n, 50_000n, 0n])
    render(<RecoverPanel arcChainId={5042002} slot={SLOT} />)
    fireEvent.click(screen.getByRole('button', { name: /recover/i }))
    expect(await screen.findByText(/recovered 0\.05 usdc on ethereum sepolia/i)).toBeInTheDocument()
    expect(wagmiState.switchChainAsync).toHaveBeenCalledWith({ chainId: 11155111 })
    const run = vi.mocked(executeRecovery).mock.calls[0][1]
    expect(run).toMatchObject({ steps: ['createSlot', 'collect'], chainId: 11155111, slot: SLOT, merchant: ME, payRef: REF, wallet: ME })
    expect(run.usdc).toBe('0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238')
  })

  it('explains when recovery is not set up on that chain yet', async () => {
    vi.mocked(probeRecovery).mockResolvedValue({ factoryThere: false, slotThere: false, vaultThere: false, addressMatches: true })
    reads(ME, [0n, 0n, 50_000n])
    render(<RecoverPanel arcChainId={5042002} slot={SLOT} />)
    fireEvent.click(screen.getByRole('button', { name: /recover/i }))
    expect(await screen.findByText(/recovery isn.t set up on arbitrum sepolia yet/i)).toBeInTheDocument()
    expect(executeRecovery).not.toHaveBeenCalled()
  })

  it('probes with the creator recorded on Arc, so any wallet can recover (v8)', async () => {
    reads(ME, [0n, 50_000n, 0n])
    render(<RecoverPanel arcChainId={5042002} slot={SLOT} />)
    fireEvent.click(screen.getByRole('button', { name: /recover/i }))
    await screen.findByText(/recovered/i)
    expect(vi.mocked(probeRecovery).mock.calls[0][1]).toMatchObject({ slot: SLOT, creator: CREATOR, merchant: ME, payRef: REF })
    expect(vi.mocked(executeRecovery).mock.calls[0][1]).toMatchObject({ creator: CREATOR })
  })

  it('refuses when the address there would not match the paid one', async () => {
    vi.mocked(probeRecovery).mockResolvedValue({ factoryThere: true, slotThere: false, vaultThere: false, addressMatches: false })
    reads(ME, [0n, 50_000n, 0n])
    render(<RecoverPanel arcChainId={5042002} slot={SLOT} />)
    fireEvent.click(screen.getByRole('button', { name: /recover/i }))
    expect(await screen.findByText(/would not match/i)).toBeInTheDocument()
    expect(executeRecovery).not.toHaveBeenCalled()
  })

  it('recovers a vault payout through the recreated vault', async () => {
    saveVault({ chainId: 5042002, owner: ME, vault: VAULT, box: '{}', pqKey: `0x${'ab'.repeat(32)}`, salt: `0x${'12'.repeat(32)}`, twoKey: true, recoveryDelay: '604800' })
    reads(VAULT, [50_000n, 0n, 0n])
    render(<RecoverPanel arcChainId={5042002} slot={SLOT} />)
    fireEvent.click(screen.getByRole('button', { name: /recover/i }))
    expect(await screen.findByText(/recovered 0\.05 usdc/i)).toBeInTheDocument()
    const run = vi.mocked(executeRecovery).mock.calls[0][1]
    expect(run.steps).toEqual(['createVault', 'createSlot', 'collect', 'withdraw'])
    expect(run.vault).toMatchObject({ address: VAULT, owner: ME, salt: `0x${'12'.repeat(32)}` })
  })

  it('asks for the vault backup when the vault settings are missing on this device', async () => {
    saveVault({ chainId: 5042002, owner: ME, vault: VAULT, box: '{}' })
    reads(VAULT, [50_000n, 0n, 0n])
    render(<RecoverPanel arcChainId={5042002} slot={SLOT} />)
    fireEvent.click(screen.getByRole('button', { name: /recover/i }))
    expect(await screen.findByText(/restore your vault backup on this device/i)).toBeInTheDocument()
  })
})

describe('RecoverPanel — after recovery', () => {
  it('hides the Recover button and switches the wallet back to Arc', async () => {
    reads(ME, [0n, 50_000n, 0n])
    render(<RecoverPanel arcChainId={5042002} slot={SLOT} />)
    fireEvent.click(screen.getByRole('button', { name: /recover/i }))
    await screen.findByText(/recovered 0\.05 usdc/i)
    expect(screen.queryByRole('button', { name: /recover/i })).not.toBeInTheDocument()
    expect(wagmiState.switchChainAsync).toHaveBeenLastCalledWith({ chainId: 5042002 })
    expect(wagmiState.refetch).toHaveBeenCalled()
  })
})
