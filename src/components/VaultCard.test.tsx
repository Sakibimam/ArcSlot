import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { wagmiState, wagmiModule, connectkitModule, resetWagmi } from '@/test/wagmi-mock'

vi.mock('wagmi', () => wagmiModule)
vi.mock('connectkit', () => connectkitModule)
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const SEED = `0x${'5e'.repeat(48)}`
const VK = `0x${'ab'.repeat(32)}`
vi.mock('@/lib/pq', () => ({
  newVaultSeed: () => SEED,
  vaultKeyFromSeed: () => VK,
  encryptSeed: (_s: string, pw: string) => Promise.resolve(`box:${pw}`),
  decryptSeed: (box: string, pw: string) =>
    box === `box:${pw}` ? Promise.resolve(SEED) : Promise.reject(new Error('Wrong password')),
  signDigest: (_seed: string, digest: string) => `0xpq${digest.slice(2, 6)}`,
  backupText: () => '{"kind":"slot-vault-backup"}',
  parseBackup: () => ({ vault: VAULT, chainId: 5042002, seed: SEED }),
}))

import { VaultCard } from './VaultCard'
import { saveVault, loadVault } from '@/lib/vault-store'

const ME = '0x1111111111111111111111111111111111111111'
const VAULT = '0x00000000000000000000000000000000000000aa'
const FACTORY = '0x16cFCACE90Be16C52F1243746626Afd3878Aeb22'
const DIGEST = `0x${'cd'.repeat(32)}`

function vaultReads({ balance = 1_000_000n, pendingKey = `0x${'00'.repeat(32)}`, readyAt = 0n } = {}) {
  wagmiState.readContracts = {
    isLoading: false, isError: false,
    data: [{ result: balance }, { result: VK }, { result: pendingKey }, { result: readyAt }, { result: true }],
  }
}
const type = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

beforeEach(() => {
  resetWagmi()
  wagmiState.account = { address: ME, chainId: 5042002 }
})

describe('VaultCard — setup', () => {
  it('renders nothing without a wallet', () => {
    wagmiState.account = { address: undefined, chainId: undefined }
    const { container } = render(<VaultCard chainId={5042002} onVaultChange={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('offers to set up a quantum-safe vault', () => {
    render(<VaultCard chainId={5042002} onVaultChange={vi.fn()} />)
    expect(screen.getByText(/quantum-safe vault/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /set up vault/i })).toBeInTheDocument()
  })

  it('requires matching passwords of at least 8 characters', () => {
    render(<VaultCard chainId={5042002} onVaultChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /set up vault/i }))
    type(/^vault password$/i, 'short')
    type(/confirm password/i, 'short')
    expect(screen.getByRole('button', { name: /generate key/i })).toBeDisabled()
    type(/^vault password$/i, 'long-enough-pw')
    type(/confirm password/i, 'different-pw!')
    expect(screen.getByRole('button', { name: /generate key/i })).toBeDisabled()
    expect(screen.getByText(/passwords don.t match/i)).toBeInTheDocument()
  })

  it('makes the user save a backup before creating the vault, then creates it two-key', async () => {
    wagmiState.publicReads = { predict: VAULT }
    render(<VaultCard chainId={5042002} onVaultChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /set up vault/i }))
    type(/^vault password$/i, 'long-enough-pw')
    type(/confirm password/i, 'long-enough-pw')
    fireEvent.click(screen.getByRole('button', { name: /generate key/i }))

    await screen.findByText(/save your backup/i)
    expect(screen.getByText(VAULT)).toBeInTheDocument()
    const create = screen.getByRole('button', { name: /create vault/i })
    expect(create).toBeDisabled()
    fireEvent.click(screen.getByLabelText(/i saved my backup/i))
    fireEvent.click(create)

    const call = wagmiState.writeContract.mock.calls[0][0] as { address: string; functionName: string; args: unknown[] }
    expect(call.address).toBe(FACTORY)
    expect(call.functionName).toBe('createVault')
    expect(call.args.slice(0, 4)).toEqual([ME, VK, true, 604_800n])
    expect(call.args[4]).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it('stores the encrypted key and reports the vault once the tx confirms', async () => {
    wagmiState.publicReads = { predict: VAULT }
    const onVaultChange = vi.fn()
    const { rerender } = render(<VaultCard chainId={5042002} onVaultChange={onVaultChange} />)
    fireEvent.click(screen.getByRole('button', { name: /set up vault/i }))
    type(/^vault password$/i, 'long-enough-pw')
    type(/confirm password/i, 'long-enough-pw')
    fireEvent.click(screen.getByRole('button', { name: /generate key/i }))
    await screen.findByText(/save your backup/i)
    fireEvent.click(screen.getByLabelText(/i saved my backup/i))
    fireEvent.click(screen.getByRole('button', { name: /create vault/i }))

    wagmiState.write = { data: '0xabc', isPending: false, error: null }
    wagmiState.waitReceipt = { data: {}, isLoading: false, isSuccess: true }
    vaultReads()
    rerender(<VaultCard chainId={5042002} onVaultChange={onVaultChange} />)
    rerender(<VaultCard chainId={5042002} onVaultChange={onVaultChange} />)

    await waitFor(() => expect(onVaultChange).toHaveBeenCalledWith(VAULT))
    expect(onVaultChange).toHaveBeenCalledTimes(1)
    const saved = loadVault(5042002, ME)
    expect(saved).toMatchObject({ vault: VAULT, box: 'box:long-enough-pw', pqKey: VK, twoKey: true, recoveryDelay: '604800' })
    // The salt is kept so the vault can be recreated at the same address on another chain.
    expect(saved?.salt).toMatch(/^0x[0-9a-f]{64}$/)
  })
})

describe('VaultCard — existing vault', () => {
  beforeEach(() => {
    saveVault({ chainId: 5042002, owner: ME, vault: VAULT, box: 'box:right-password' })
  })

  it('shows the balance and the two-key protection', () => {
    vaultReads({ balance: 1_250_000n })
    render(<VaultCard chainId={5042002} onVaultChange={vi.fn()} />)
    expect(screen.getByTestId('vault-balance')).toHaveTextContent('1.25 USDC')
    expect(screen.getByText(/quantum-safe key \+ your wallet/i)).toBeInTheDocument()
  })

  it('rejects a wrong password without signing anything', async () => {
    vaultReads()
    render(<VaultCard chainId={5042002} onVaultChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /withdraw/i }))
    type(/amount/i, '0.5')
    type(/vault password/i, 'nope-nope')
    fireEvent.click(screen.getByRole('button', { name: /sign & withdraw/i }))
    expect(await screen.findByText(/wrong password/i)).toBeInTheDocument()
    expect(wagmiState.signMessageAsync).not.toHaveBeenCalled()
    expect(wagmiState.writeContract).not.toHaveBeenCalled()
  })

  it('signs with both keys and submits the withdrawal to the wallet by default', async () => {
    vaultReads()
    wagmiState.publicReads = { withdrawDigest: DIGEST }
    render(<VaultCard chainId={5042002} onVaultChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /withdraw/i }))
    type(/amount/i, '0.5')
    type(/vault password/i, 'right-password')
    fireEvent.click(screen.getByRole('button', { name: /sign & withdraw/i }))

    await waitFor(() => expect(wagmiState.writeContract).toHaveBeenCalled())
    expect(wagmiState.signMessageAsync).toHaveBeenCalledWith({ message: { raw: DIGEST } })
    const read = wagmiState.publicReadContract.mock.calls[0][0] as { functionName: string; args: unknown[] }
    expect(read.functionName).toBe('withdrawDigest')
    expect(read.args.slice(0, 3)).toEqual([ME, 500_000n, 0n])
    const call = wagmiState.writeContract.mock.calls[0][0] as { address: string; functionName: string; args: unknown[] }
    expect(call.address).toBe(VAULT)
    expect(call.functionName).toBe('withdraw')
    expect(call.args[0]).toBe(ME)
    expect(call.args[1]).toBe(500_000n)
    expect(call.args[2]).toBe(0n)
    expect(call.args[3]).toBe(read.args[3])
    expect(call.args[4]).toBe('0xpqcdcd')
    expect(call.args[5]).toBe(`0x${'0b'.repeat(65)}`)
  })

  it('refuses to withdraw more than the balance', () => {
    vaultReads({ balance: 100_000n })
    render(<VaultCard chainId={5042002} onVaultChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /withdraw/i }))
    type(/amount/i, '5')
    type(/vault password/i, 'right-password')
    expect(screen.getByRole('button', { name: /sign & withdraw/i })).toBeDisabled()
  })

  it('warns about a pending recovery and lets the key holder cancel it', async () => {
    vaultReads({ pendingKey: `0x${'ee'.repeat(32)}`, readyAt: 1_900_000_000n })
    wagmiState.publicReads = { cancelDigest: DIGEST }
    render(<VaultCard chainId={5042002} onVaultChange={vi.fn()} />)
    expect(screen.getByText(/key recovery was started/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /cancel recovery/i }))
    type(/vault password/i, 'right-password')
    fireEvent.click(screen.getByRole('button', { name: /sign & cancel/i }))
    await waitFor(() => expect(wagmiState.writeContract).toHaveBeenCalled())
    const call = wagmiState.writeContract.mock.calls[0][0] as { functionName: string; args: unknown[] }
    expect(call.functionName).toBe('cancelRecovery')
    expect(call.args).toEqual(['0xpqcdcd'])
  })
})

describe('VaultCard — restore on a new device', () => {
  function restore() {
    render(<VaultCard chainId={5042002} onVaultChange={onVaultChange} />)
    fireEvent.click(screen.getByRole('button', { name: /restore from backup/i }))
    type(/backup file contents/i, '{"kind":"slot-vault-backup"}')
    type(/^vault password$/i, 'new-device-pw')
    type(/confirm password/i, 'new-device-pw')
    fireEvent.click(screen.getByRole('button', { name: /restore vault/i }))
  }
  const onVaultChange = vi.fn()
  beforeEach(() => onVaultChange.mockClear())

  it('restores after checking the key and owner on-chain', async () => {
    wagmiState.publicReads = { pqKey: VK, owner: ME }
    restore()
    await waitFor(() => expect(onVaultChange).toHaveBeenCalledWith(VAULT))
    expect(loadVault(5042002, ME)).toMatchObject({ vault: VAULT, box: 'box:new-device-pw' })
  })

  it('refuses a backup for a vault owned by another wallet', async () => {
    wagmiState.publicReads = { pqKey: VK, owner: '0x2222222222222222222222222222222222222222' }
    restore()
    expect(await screen.findByText(/belongs to a different wallet/i)).toBeInTheDocument()
    expect(loadVault(5042002, ME)).toBeNull()
  })

  it('refuses a backup whose key was rotated away', async () => {
    wagmiState.publicReads = { pqKey: `0x${'99'.repeat(32)}`, owner: ME }
    restore()
    expect(await screen.findByText(/no longer matches/i)).toBeInTheDocument()
  })
})
