import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { wagmiState, wagmiModule, connectkitModule, resetWagmi } from '@/test/wagmi-mock'

vi.mock('wagmi', () => wagmiModule)
vi.mock('connectkit', () => connectkitModule)
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import App from './App'
import { saveSlots } from '@/lib/slot-logic'

const SLOT = '0x10C2D81E0197F64Bd3e4c460a516eaDB0C348b7F'

beforeEach(() => {
  resetWagmi()
  window.location.hash = ''
})

describe('App', () => {
  it('opens the merchant view on the network that is live (testnet for now)', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: /request a payment/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /testnet/i })).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows a friendly empty state', () => {
    render(<App />)
    expect(screen.getByText(/no payment requests yet/i)).toBeInTheDocument()
  })

  it('lists saved requests for the selected network', () => {
    saveSlots([
      { address: SLOT, chainId: 5042002, label: 'Coffee', amount: 3_000_000n },
      { address: '0x00000000000000000000000000000000000000aa', chainId: 5042, label: 'Mainnet one' },
    ])
    wagmiState.readContracts = { data: [{ result: false }, { result: 100_000n }, { result: 0n }], isLoading: false, isError: false }
    render(<App />)
    expect(screen.getByText('Coffee')).toBeInTheDocument()
    expect(screen.queryByText('Mainnet one')).not.toBeInTheDocument()
  })

  it('renders the payer page for a pay link', () => {
    window.location.hash = `#/pay/5042002/${SLOT}?amount=1&for=Coffee`
    wagmiState.readContracts = { data: [{ result: '0x6192176de4b9f8Ac224521d13fc3979F7275E63b' }, { result: 0n }], isLoading: false, isError: false }
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Coffee' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /request a payment/i })).not.toBeInTheDocument()
  })

  it('follows hash changes', () => {
    render(<App />)
    wagmiState.readContracts = { data: [{ result: '0x6192176de4b9f8Ac224521d13fc3979F7275E63b' }, { result: 0n }], isLoading: false, isError: false }
    act(() => {
      window.location.hash = `#/pay/5042002/${SLOT}?for=Tea`
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(screen.getByRole('heading', { name: 'Tea' })).toBeInTheDocument()
  })

  it('explains a broken pay link', () => {
    window.location.hash = '#/pay/5042002/0x123'
    render(<App />)
    expect(screen.getByText(/this payment link is not valid/i)).toBeInTheDocument()
  })
})
