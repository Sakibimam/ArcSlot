import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { wagmiState, wagmiModule, connectkitModule, resetWagmi } from '@/test/wagmi-mock'

vi.mock('wagmi', () => wagmiModule)
vi.mock('connectkit', () => connectkitModule)
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const FACTORY = '0x00000000000000000000000000000000000000f0'
const factories: Record<number, string | null> = { 5042: null, 5042002: FACTORY }
vi.mock('@/lib/chains', async (orig) => ({
  ...(await orig<typeof import('@/lib/chains')>()),
  getFactoryAddress: (id: number) => factories[id],
}))

import { CreateRequest } from './CreateRequest'

const ME = '0x1111111111111111111111111111111111111111'
const OTHER = '0x3333333333333333333333333333333333333333'
const PREDICTED = '0x2222222222222222222222222222222222222222'
const fill = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const createBtn = () => screen.getByRole('button', { name: /create payment link/i })

beforeEach(() => {
  resetWagmi()
  wagmiState.account = { address: ME, chainId: 5042002 }
  wagmiState.readByFn = { predict: PREDICTED }
})

describe('CreateRequest', () => {
  it('asks to connect a wallet first', () => {
    wagmiState.account = { address: undefined, chainId: undefined }
    render(<CreateRequest chainId={5042002} onCreated={vi.fn()} />)
    expect(screen.getByRole('button', { name: /connect wallet/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create payment link/i })).not.toBeInTheDocument()
  })

  it('on a phone browser with no wallet, offers to open the dashboard inside a wallet app', () => {
    wagmiState.account = { address: undefined, chainId: undefined }
    delete (window as { ethereum?: unknown }).ethereum
    render(<CreateRequest chainId={5042002} onCreated={vi.fn()} />)
    for (const name of ['Phantom', 'MetaMask', 'Coinbase Wallet', 'Trust Wallet'])
      expect(screen.getByRole('link', { name: new RegExp(`open in ${name}`, 'i') })).toBeInTheDocument()
    expect(decodeURIComponent(screen.getByRole('link', { name: /open in trust wallet/i }).getAttribute('href')!)).toContain(window.location.href)
  })

  it('with a wallet in the browser, shows only the connect button', () => {
    wagmiState.account = { address: undefined, chainId: undefined }
    ;(window as unknown as { ethereum: unknown }).ethereum = { request: vi.fn() }
    render(<CreateRequest chainId={5042002} onCreated={vi.fn()} />)
    expect(screen.queryByRole('link', { name: /open in phantom/i })).not.toBeInTheDocument()
    delete (window as { ethereum?: unknown }).ethereum
  })

  it('pays out to the connected wallet by default — no merchant address needed', () => {
    render(<CreateRequest chainId={5042002} onCreated={vi.fn()} />)
    expect(screen.getByText('Funds go to')).toBeInTheDocument()
    expect(screen.getByText('0x1111…1111')).toBeInTheDocument()
    fill(/amount/i, '1.5')
    fill(/what is it for/i, 'Invoice #42')
    fireEvent.click(createBtn())
    const call = wagmiState.writeContract.mock.calls[0][0] as { functionName: string; address: string; args: unknown[] }
    expect(call.functionName).toBe('createRequest')
    expect(call.address).toBe(FACTORY)
    expect(call.args[0]).toBe(ME)
    expect(call.args[1]).toMatch(/^0x[0-9a-f]{64}$/)
    expect(call.args[2]).toBe(0)
    expect(call.args[4]).toBe(50_000n)
    expect(call.args[5]).toBe(1_500_000n)
    expect(call.args[6]).toBe('Invoice #42')
    expect(call.args[7]).toBe(0n)
  })

  it('can send payouts to a different address', () => {
    render(<CreateRequest chainId={5042002} onCreated={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /change/i }))
    fill(/payout address/i, OTHER)
    fireEvent.click(createBtn())
    const call = wagmiState.writeContract.mock.calls[0][0] as { args: unknown[] }
    expect(call.args[0]).toBe(OTHER)
  })

  // Circle blacklists some addresses, even the USDC contract itself; a slot
  // paying out to one would quarantine and could lock the payment for good.
  it('refuses a payout address that USDC has blacklisted', () => {
    wagmiState.readByFn = { predict: PREDICTED, isBlacklisted: true }
    render(<CreateRequest chainId={5042002} onCreated={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /change/i }))
    fill(/payout address/i, '0x3600000000000000000000000000000000000000')
    expect(screen.getByText(/can.t receive usdc/i)).toBeInTheDocument()
    expect(createBtn()).toBeDisabled()
  })

  // The slot address commits to its creator (audit H-1), so predict must ask
  // for the address the connected wallet will get — not anyone's.
  it('predicts the slot address for the connected wallet as creator', () => {
    render(<CreateRequest chainId={5042002} onCreated={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /change/i }))
    fill(/payout address/i, OTHER)
    const predicts = wagmiState.readCalls.filter((c) => c.functionName === 'predict')
    const predict = predicts[predicts.length - 1]
    expect(predict?.args?.[0]).toBe(ME)
    expect(predict?.args?.[1]).toBe(OTHER)
    expect(predict?.args?.[2]).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it('hides fee and gas settings under Advanced', () => {
    render(<CreateRequest chainId={5042002} onCreated={vi.fn()} />)
    expect(screen.queryByLabelText(/platform fee/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /advanced/i }))
    expect(screen.getByLabelText(/platform fee/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/max collector reward/i)).toHaveValue('0.05')
  })

  it('takes the fee as a percentage', () => {
    render(<CreateRequest chainId={5042002} onCreated={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /advanced/i }))
    fill(/platform fee/i, '2.5')
    fill(/fee goes to/i, OTHER)
    fireEvent.click(createBtn())
    const call = wagmiState.writeContract.mock.calls[0][0] as { args: unknown[] }
    expect(call.args[2]).toBe(250)
    expect(call.args[3]).toBe(OTHER)
  })

  it('rejects an invalid amount', () => {
    render(<CreateRequest chainId={5042002} onCreated={vi.fn()} />)
    fill(/amount/i, 'abc')
    expect(createBtn()).toBeDisabled()
  })

  it('offers a network switch when the wallet is on the wrong chain', () => {
    wagmiState.account = { address: ME, chainId: 5042 }
    render(<CreateRequest chainId={5042002} onCreated={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /switch to arc testnet/i }))
    expect(wagmiState.switchChainAsync).toHaveBeenCalledWith({ chainId: 5042002 })
  })

  it('when the wallet refuses the switch, explains how to fix it', async () => {
    wagmiState.account = { address: ME, chainId: 5042, connector: { id: 'app.phantom', name: 'Phantom' } }
    wagmiState.switchChainAsync = vi.fn(() => Promise.reject(Object.assign(new Error('Unrecognized chain ID'), { code: 4902 })))
    render(<CreateRequest chainId={5042002} onCreated={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /switch to arc testnet/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Testnet Mode/)
  })

  it('explains when the network is not live yet', () => {
    wagmiState.account = { address: ME, chainId: 5042 }
    render(<CreateRequest chainId={5042} onCreated={vi.fn()} />)
    expect(screen.getByText(/not live on arc mainnet yet/i)).toBeInTheDocument()
  })

  it('reports the request once and shows a share link with the amount', () => {
    const onCreated = vi.fn()
    const { rerender } = render(<CreateRequest chainId={5042002} onCreated={onCreated} />)
    fill(/amount/i, '1.5')
    fill(/what is it for/i, 'Invoice #42')
    fireEvent.click(createBtn())
    wagmiState.write = { data: '0xabc', isPending: false, error: null }
    wagmiState.waitReceipt = { data: {}, isLoading: false, isSuccess: true }
    rerender(<CreateRequest chainId={5042002} onCreated={onCreated} />)
    rerender(<CreateRequest chainId={5042002} onCreated={onCreated} />)

    expect(onCreated).toHaveBeenCalledTimes(1)
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({
      address: PREDICTED, chainId: 5042002, label: 'Invoice #42', amount: 1_500_000n,
    }))
    expect(screen.getByText(/payment link ready/i)).toBeInTheDocument()
    expect(screen.getByTestId('pay-link').textContent).toMatch(new RegExp(`#/pay/5042002/${PREDICTED}$`))
  })
})

describe('CreateRequest — quantum-safe vault payouts', () => {
  const VAULT = '0x00000000000000000000000000000000000000aa'

  it('pays into the vault by default when one exists', () => {
    render(<CreateRequest chainId={5042002} vault={VAULT} onCreated={vi.fn()} />)
    expect(screen.getByText(/your quantum-safe vault/i)).toBeInTheDocument()
    fireEvent.click(createBtn())
    const call = wagmiState.writeContract.mock.calls[0][0] as { args: unknown[] }
    expect(call.args[0]).toBe(VAULT)
  })

  it('can switch back to the plain wallet', () => {
    render(<CreateRequest chainId={5042002} vault={VAULT} onCreated={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /use wallet/i }))
    fireEvent.click(createBtn())
    const call = wagmiState.writeContract.mock.calls[0][0] as { args: unknown[] }
    expect(call.args[0]).toBe(ME)
  })
})

describe('CreateRequest — on-chain request data', () => {
  it('stores an optional expiry', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-01T00:00:00Z'))
    render(<CreateRequest chainId={5042002} onCreated={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/expires/i), { target: { value: '7d' } })
    fireEvent.click(createBtn())
    const call = wagmiState.writeContract.mock.calls[0][0] as { args: unknown[] }
    expect(call.args[7]).toBe(BigInt(Math.floor(Date.parse('2026-11-08T00:00:00Z') / 1000)))
    vi.useRealTimers()
  })

  it('uses "Payment request" when no description is given', () => {
    render(<CreateRequest chainId={5042002} onCreated={vi.fn()} />)
    fireEvent.click(createBtn())
    const call = wagmiState.writeContract.mock.calls[0][0] as { args: unknown[] }
    expect(call.args[6]).toBe('Payment request')
    expect(call.args[5]).toBe(0n)
  })
})

describe('CreateRequest — description limit', () => {
  it('blocks descriptions over 80 bytes (emoji count as 4)', () => {
    render(<CreateRequest chainId={5042002} onCreated={vi.fn()} />)
    fill(/what is it for/i, '☕'.repeat(27) + '🍰'.repeat(1)) // 81 bytes, 28 characters
    expect(screen.getByText(/too long/i)).toBeInTheDocument()
    expect(createBtn()).toBeDisabled()
  })
})

describe('CreateRequest — accessible amount field', () => {
  it('names the amount field with its unit, "Amount (USDC)"', () => {
    render(<CreateRequest chainId={5042002} onCreated={vi.fn()} />)
    expect(screen.getByLabelText(/^amount \(usdc\)$/i)).toBeInTheDocument()
  })
})

describe('CreateRequest — live receipt preview', () => {
  it('shows the receipt preview when a wallet is connected', () => {
    render(<CreateRequest chainId={5042002} onCreated={vi.fn()} />)
    expect(screen.getByLabelText(/receipt preview/i)).toBeInTheDocument()
  })

  it('updates the preview label as the user types', () => {
    render(<CreateRequest chainId={5042002} onCreated={vi.fn()} />)
    fill(/what is it for/i, 'Logo design')
    expect(screen.getByTestId('preview-label')).toHaveTextContent('Logo design')
  })

  it('updates the preview amount as the user types', () => {
    render(<CreateRequest chainId={5042002} onCreated={vi.fn()} />)
    fill(/amount/i, '100')
    expect(screen.getByTestId('preview-amount')).toHaveTextContent('100.00 USDC')
  })

  it('shows the receive amount derived from the typed amount', () => {
    render(<CreateRequest chainId={5042002} onCreated={vi.fn()} />)
    fill(/amount/i, '1000')
    // An estimate (the real fee depends on gas), so it must say so.
    expect(screen.getByTestId('preview-receive')).toHaveTextContent(/^about 999\.98 USDC$/)
    expect(screen.getByText(/after network fees/i)).toBeInTheDocument()
  })

  it('on mainnet, warns that the contracts are unaudited and to use small amounts', () => {
    wagmiState.account = { address: ME, chainId: 5042 }
    render(<CreateRequest chainId={5042} onCreated={vi.fn()} />)
    expect(screen.getByRole('note')).toHaveTextContent(/real USDC.*unaudited.*small amounts/i)
  })

  it('on testnet, no mainnet warning', () => {
    wagmiState.account = { address: ME, chainId: 5042002 }
    render(<CreateRequest chainId={5042002} onCreated={vi.fn()} />)
    expect(screen.queryByText(/unaudited/i)).not.toBeInTheDocument()
  })


  it('on testnet, says plainly it is test money', () => {
    wagmiState.account = { address: ME, chainId: 5042002 }
    render(<CreateRequest chainId={5042002} onCreated={vi.fn()} />)
    expect(screen.getByRole('note')).toHaveTextContent(/testnet.*test USDC.*not real/i)
  })
})
