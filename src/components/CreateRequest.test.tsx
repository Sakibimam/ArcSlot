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
    expect(wagmiState.switchChain).toHaveBeenCalledWith({ chainId: 5042002 })
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
