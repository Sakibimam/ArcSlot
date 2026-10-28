import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, fireEvent, within } from '@testing-library/react'
import { wagmiState, wagmiModule, connectkitModule, resetWagmi } from '@/test/wagmi-mock'

vi.mock('wagmi', () => wagmiModule)
vi.mock('connectkit', () => connectkitModule)
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/RecoverPanel', () => ({ RecoverPanel: () => null }))

import App from './App'
import { saveSlots } from '@/lib/slot-logic'

const SLOT = '0x10C2D81E0197F64Bd3e4c460a516eaDB0C348b7F'

beforeEach(() => {
  resetWagmi()
  window.location.hash = ''
})

describe('App — landing page', () => {
  it('shows the landing page at the root hash', () => {
    window.location.hash = ''
    render(<App />)
    expect(screen.getByRole('heading', { name: /cents, not percent/i })).toBeInTheDocument()
  })

  it('shows the landing page at #/', () => {
    window.location.hash = '#/'
    render(<App />)
    expect(screen.getByRole('heading', { name: /cents, not percent/i })).toBeInTheDocument()
  })
})

describe('App', () => {
  beforeEach(() => { window.location.hash = '#/app'; localStorage.removeItem('arcslot:network') })

  it('opens on Arc Mainnet by default, shown as one clear network chip', () => {
    localStorage.removeItem('arcslot:network')
    render(<App />)
    expect(screen.getByRole('heading', { name: /create a payment link/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /network: arc mainnet/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^testnet$/i })).not.toBeInTheDocument()
  })

  it('the chip opens a menu that explains both networks; picking testnet switches and is remembered', () => {
    localStorage.removeItem('arcslot:network')
    const { unmount } = render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /network: arc mainnet/i }))
    const menu = screen.getByRole('menu')
    expect(within(menu).getByRole('menuitemradio', { name: /arc mainnet.*real usdc/i })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: /arc testnet.*free test usdc/i }))
    expect(screen.getByRole('button', { name: /network: arc testnet/i })).toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    unmount()
    render(<App />)
    expect(screen.getByRole('button', { name: /network: arc testnet/i })).toBeInTheDocument()
    localStorage.removeItem('arcslot:network')
  })

  it('the network menu closes on Escape and on a click outside', () => {
    render(<App />)
    const chip = screen.getByRole('button', { name: /network:/i })
    fireEvent.click(chip)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    fireEvent.click(chip)
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('shows a friendly empty state', () => {
    render(<App />)
    expect(screen.getByText(/no payment links yet/i)).toBeInTheDocument()
  })

  it('lists saved requests for the selected network', () => {
    localStorage.setItem('arcslot:network', '5042002') // a testnet feature
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
    wagmiState.readContracts = { data: [{ result: '0x6192176de4b9f8Ac224521d13fc3979F7275E63b' }, { result: 0n }, { result: 0n }, { result: undefined }, { result: true }], isLoading: false, isError: false }
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Coffee' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /create a payment link/i })).not.toBeInTheDocument()
  })

  it('follows hash changes', () => {
    render(<App />)
    wagmiState.readContracts = { data: [{ result: '0x6192176de4b9f8Ac224521d13fc3979F7275E63b' }, { result: 0n }, { result: 0n }, { result: undefined }, { result: true }], isLoading: false, isError: false }
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

describe('App — vault', () => {
  beforeEach(() => { window.location.hash = '#/app' })

  it('shows the quantum-safe vault panel to a connected merchant', () => {
    localStorage.setItem('arcslot:network', '5042002') // a testnet feature
    wagmiState.account = { address: '0x1111111111111111111111111111111111111111', chainId: 5042002 }
    render(<App />)
    expect(screen.getByRole('heading', { name: /quantum-safe vault/i })).toBeInTheDocument()
  })

  it('defaults new requests to an existing vault', () => {
    localStorage.setItem('arcslot:network', '5042002') // a testnet feature
    const ME = '0x1111111111111111111111111111111111111111'
    wagmiState.account = { address: ME, chainId: 5042002 }
    localStorage.setItem(`arc-slot:vault:v1:5042002:${ME}`, JSON.stringify({ chainId: 5042002, owner: ME, vault: '0x00000000000000000000000000000000000000aa', box: '{}' }))
    render(<App />)
    // Both the CreateRequest payout line and the VaultCard heading show the vault;
    // at least one must be present.
    expect(screen.getAllByText(/your quantum-safe vault/i).length).toBeGreaterThan(0)
  })
})

describe('App — requests from the chain', () => {
  beforeEach(() => { window.location.hash = '#/app' })

  it('shows requests created on another device', () => {
    const ME = '0x1111111111111111111111111111111111111111'
    wagmiState.account = { address: ME, chainId: 5042002 }
    wagmiState.readByFn = { requestsOf: ['0x00000000000000000000000000000000000000a1'] }
    wagmiState.readContracts = {
      isLoading: false, isError: false,
      data: [{ result: { exists: true, creator: ME, merchant: ME, amount: 1_000_000n, createdAt: 100n, expiresAt: 0n, label: 'From my phone' } }],
    }
    render(<App />)
    expect(screen.getByText('From my phone')).toBeInTheDocument()
  })
})

describe('App — collectors page', () => {
  it('renders the leaderboard at #/collect', () => {
    window.location.hash = '#/collect'
    wagmiState.readContracts = { isLoading: false, isError: false, data: [{ result: 0n }, { result: 0n }, { result: [[], []] }] }
    render(<App />)
    expect(screen.getByRole('heading', { name: /collectors/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /create a payment link/i })).not.toBeInTheDocument()
  })
})

describe('App — docs', () => {
  it('shows the docs at #/docs/<id>', () => {
    window.location.hash = '#/docs/architecture'
    render(<App />)
    expect(screen.getByRole('heading', { level: 1, name: 'Architecture' })).toBeInTheDocument()
  })

  it('the dashboard links to the docs, on phones too (footer)', () => {
    window.location.hash = '#/app'
    render(<App />)
    const links = screen.getAllByRole('link', { name: /^docs$/i })
    expect(links.length).toBeGreaterThanOrEqual(2)
    for (const l of links) expect(l).toHaveAttribute('href', '#/docs')
  })

  it('the landing page links to the docs', () => {
    window.location.hash = '#/'
    render(<App />)
    expect(screen.getAllByRole('link', { name: /^docs$/i })[0]).toHaveAttribute('href', '#/docs')
  })
})

describe('App — stats', () => {
  it('the stats page is reachable from both footers', () => {
    window.location.hash = '#/'
    const { unmount } = render(<App />)
    expect(screen.getAllByRole('link', { name: /^stats$/i })[0]).toHaveAttribute('href', '#/stats')
    unmount()
    window.location.hash = '#/app'
    render(<App />)
    expect(screen.getAllByRole('link', { name: /^stats$/i })[0]).toHaveAttribute('href', '#/stats')
  })
})
