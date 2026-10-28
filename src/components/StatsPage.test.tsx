import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { wagmiModule, connectkitModule } from '@/test/wagmi-mock'

vi.mock('wagmi', () => wagmiModule)
vi.mock('connectkit', () => connectkitModule)

import { StatsPage } from './StatsPage'
import type { NetworkStats } from '@/lib/stats'

const stats = (o: Partial<NetworkStats>): NetworkStats => ({ requests: 0, paid: 0, received: 0n, collected: 0n, waiting: 0n, largest: 0n, ...o })
const load = (byChain: Record<number, NetworkStats | Error>) =>
  vi.fn((chainId: number) => { const v = byChain[chainId]; return v instanceof Error ? Promise.reject(v) : Promise.resolve(v) })

describe('StatsPage', () => {
  it('shows live mainnet numbers first, as real USDC, with a link to verify on explorer.arc.io', async () => {
    render(<StatsPage load={load({ 5042: stats({ requests: 2, paid: 1, received: 1_000_000n, collected: 1_000_000n, largest: 1_000_000n }), 5042002: stats({ requests: 11, paid: 7, received: 3_000_000n }) })} />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/stats/i)
    const main = await screen.findByRole('region', { name: /arc mainnet/i })
    expect(within(main).getByText(/real usdc/i)).toBeInTheDocument()
    expect(within(main).getByTestId('received')).toHaveTextContent('1.00')
    expect(within(main).getByTestId('requests')).toHaveTextContent('2')
    expect(within(main).getByTestId('paid')).toHaveTextContent('1')
    expect(within(main).getByRole('link', { name: /verify on explorer\.arc\.io/i })).toHaveAttribute('href', 'https://explorer.arc.io/address/0x849eE5AEd72d1Ba5ADa092e0d68C4B2D161BE9c3')
  })

  it('labels testnet as test money, shown below mainnet', async () => {
    render(<StatsPage load={load({ 5042: stats({}), 5042002: stats({ requests: 11, paid: 7, received: 3_000_000n }) })} />)
    const test = await screen.findByRole('region', { name: /arc testnet/i })
    expect(within(test).getByText(/test money/i)).toBeInTheDocument()
    expect(within(test).getByTestId('received')).toHaveTextContent('3.00')
    const regions = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))
    expect(regions.indexOf('Arc Mainnet')).toBeLessThan(regions.indexOf('Arc Testnet'))
  })

  it('says it is reading from the chain while loading', () => {
    render(<StatsPage load={vi.fn(() => new Promise<NetworkStats>(() => {}))} />)
    expect(screen.getAllByText(/reading from the chain/i).length).toBeGreaterThan(0)
  })

  it('if Arc cannot be reached, says so (never shows zeros) and can retry', async () => {
    const l = load({ 5042: new Error('blocked'), 5042002: stats({}) })
    render(<StatsPage load={l} />)
    const main = await screen.findByRole('region', { name: /arc mainnet/i })
    expect(await within(main).findByText(/can.t reach arc/i)).toBeInTheDocument()
    expect(within(main).queryByTestId('received')).not.toBeInTheDocument()
    fireEvent.click(within(main).getByRole('button', { name: /try again/i }))
    expect(l.mock.calls.filter(([id]) => id === 5042).length).toBe(2)
  })
})
