import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { wagmiState, wagmiModule, connectkitModule, resetWagmi } from '@/test/wagmi-mock'

vi.mock('wagmi', () => wagmiModule)
vi.mock('connectkit', () => connectkitModule)

import { Leaderboard } from './Leaderboard'

const ALICE = '0x00000000000000000000000000000000000000a1'
const BOB = '0x00000000000000000000000000000000000000b2'
const ME = '0x1111111111111111111111111111111111111111'

function board(rows: [string, bigint, bigint][], totals = { collections: 0n, delivered: 0n }) {
  wagmiState.readContracts = {
    isLoading: false, isError: false,
    data: [
      { result: totals.collections },
      { result: totals.delivered },
      { result: [rows.map((r) => r[0]), rows.map((r) => ({ collections: r[1], delivered: r[2] }))] },
    ],
  }
}

beforeEach(() => resetWagmi())

describe('Leaderboard', () => {
  // v8 (audit L-2): a collector can only credit itself, but it can still
  // recycle its own USDC; the board says what it measures.
  it('explains that rankings are raw on-chain activity', () => {
    render(<Leaderboard chainId={5042002} />)
    expect(screen.getByText(/raw on-chain activity/i)).toBeInTheDocument()
  })

  it('shows network totals', () => {
    board([[ALICE, 2n, 300_000n]], { collections: 2n, delivered: 300_000n })
    render(<Leaderboard chainId={5042002} />)
    expect(screen.getByTestId('total-collections')).toHaveTextContent('2')
    expect(screen.getByTestId('total-delivered')).toHaveTextContent('0.30 USDC')
  })

  it('ranks collectors by collections, then USDC delivered', () => {
    board([[ALICE, 2n, 300_000n], [BOB, 5n, 100_000n], [ME, 2n, 900_000n]])
    render(<Leaderboard chainId={5042002} />)
    const rows = screen.getAllByTestId('collector-row')
    expect(rows.map((r) => within(r).getByTestId('rank').textContent)).toEqual(['1', '2', '3'])
    expect(within(rows[0]).getByText(/0x0000…00b2/)).toBeInTheDocument()
    expect(within(rows[1]).getByText(/0x1111…1111/)).toBeInTheDocument()
    expect(within(rows[2]).getByText(/0x0000…00a1/)).toBeInTheDocument()
  })

  it('highlights the connected wallet', () => {
    wagmiState.account = { ...wagmiState.account, address: ME, chainId: 5042002 }
    board([[ALICE, 2n, 300_000n], [ME, 1n, 150_000n]])
    render(<Leaderboard chainId={5042002} />)
    expect(screen.getByText('You')).toBeInTheDocument()
  })

  it('invites people to start when nobody has collected yet', () => {
    board([])
    render(<Leaderboard chainId={5042002} />)
    expect(screen.getByText(/no collectors yet/i)).toBeInTheDocument()
  })

  it('shows how to run a collector', () => {
    board([])
    render(<Leaderboard chainId={5042002} />)
    expect(screen.getByText(/bun run collect/)).toBeInTheDocument()
  })
})
