import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { wagmiState, wagmiModule, connectkitModule, resetWagmi } from '@/test/wagmi-mock'

vi.mock('wagmi', () => wagmiModule)
vi.mock('connectkit', () => connectkitModule)
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { PayPage } from './PayPage'

const SLOT = '0x10C2D81E0197F64Bd3e4c460a516eaDB0C348b7F'
const MERCHANT = '0x6192176de4b9f8Ac224521d13fc3979F7275E63b'
const ME = '0x1111111111111111111111111111111111111111'
const USDC = '0x3600000000000000000000000000000000000000'

function slotReads({ balance = 0n, merchant = MERCHANT, isError = false } = {}) {
  wagmiState.readContracts = {
    isLoading: false, isError,
    data: isError ? undefined : [{ result: merchant }, { result: balance }],
  }
}
const props = { chainId: 5042002 as const, slot: SLOT, amount: 1_500_000n, label: 'Invoice #42' }

beforeEach(() => {
  resetWagmi()
  slotReads()
})

describe('PayPage', () => {
  it('shows what is being paid, to whom, and on which network', () => {
    render(<PayPage {...props} />)
    expect(screen.getByText('Invoice #42')).toBeInTheDocument()
    expect(screen.getByTestId('pay-amount')).toHaveTextContent('1.50 USDC')
    expect(screen.getByText(/0x6192…E63b/)).toBeInTheDocument()
    expect(screen.getAllByText(/arc testnet/i).length).toBeGreaterThan(0)
  })

  it('asks to connect a wallet before paying', () => {
    render(<PayPage {...props} />)
    expect(screen.getByRole('button', { name: /connect wallet/i })).toBeInTheDocument()
  })

  it('offers a network switch when the wallet is elsewhere', () => {
    wagmiState.account = { address: ME, chainId: 5042 }
    render(<PayPage {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /switch to arc testnet/i }))
    expect(wagmiState.switchChain).toHaveBeenCalledWith({ chainId: 5042002 })
  })

  it('pays the exact amount with a USDC transfer to the slot', () => {
    wagmiState.account = { address: ME, chainId: 5042002 }
    wagmiState.readByFn = { balanceOf: 5_000_000n }
    render(<PayPage {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /pay 1\.50 usdc/i }))
    expect(wagmiState.writeContract).toHaveBeenCalledWith(expect.objectContaining({
      address: USDC, functionName: 'transfer', args: [SLOT, 1_500_000n], chainId: 5042002,
    }))
  })

  it('lets the payer enter an amount when the link has none', () => {
    wagmiState.account = { address: ME, chainId: 5042002 }
    wagmiState.readByFn = { balanceOf: 5_000_000n }
    render(<PayPage {...props} amount={undefined} />)
    fireEvent.change(screen.getByLabelText(/amount to pay/i), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: /pay 2\.00 usdc/i }))
    expect(wagmiState.writeContract).toHaveBeenCalledWith(expect.objectContaining({ args: [SLOT, 2_000_000n] }))
  })

  it('warns about insufficient balance and links the faucet on testnet', () => {
    wagmiState.account = { address: ME, chainId: 5042002 }
    wagmiState.readByFn = { balanceOf: 200_000n }
    render(<PayPage {...props} />)
    expect(screen.getByText(/not enough usdc/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /pay 1\.50 usdc/i })).toBeDisabled()
    expect(screen.getByRole('link', { name: /get test usdc/i })).toHaveAttribute('href', 'https://faucet.circle.com')
  })

  it('shows the manual option with the deposit address', () => {
    render(<PayPage {...props} />)
    fireEvent.click(screen.getByRole('tab', { name: /send manually/i }))
    expect(screen.getByText(SLOT)).toBeInTheDocument()
    expect(screen.getByText(/only send usdc on arc testnet/i)).toBeInTheDocument()
  })

  it('confirms once the slot holds the requested amount', () => {
    slotReads({ balance: 1_500_000n })
    render(<PayPage {...props} />)
    expect(screen.getByText(/payment received/i)).toBeInTheDocument()
  })

  it('confirms after the payer’s own transfer succeeds', () => {
    wagmiState.account = { address: ME, chainId: 5042002 }
    wagmiState.readByFn = { balanceOf: 5_000_000n }
    wagmiState.write = { data: '0xbeef', isPending: false, error: null }
    wagmiState.waitReceipt = { data: {}, isLoading: false, isSuccess: true }
    render(<PayPage {...props} />)
    expect(screen.getByText(/payment sent/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /view transaction/i })).toHaveAttribute('href', expect.stringContaining('/tx/0xbeef'))
  })

  it('rejects a link that does not point at a payment slot', () => {
    slotReads({ isError: true })
    render(<PayPage {...props} />)
    expect(screen.getByText(/this payment link is not valid/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pay/i })).not.toBeInTheDocument()
  })
})

describe('PayPage — vault badge', () => {
  it('shows that the payee is a quantum-safe vault', () => {
    wagmiState.readByFn = { pqKey: `0x${'ab'.repeat(32)}` }
    render(<PayPage {...props} />)
    expect(screen.getByText(/pays into a quantum-safe vault/i)).toBeInTheDocument()
  })

  it('shows no badge for a plain wallet', () => {
    wagmiState.readByFn = { pqKey: undefined }
    render(<PayPage {...props} />)
    expect(screen.queryByText(/quantum-safe vault/i)).not.toBeInTheDocument()
  })
})
