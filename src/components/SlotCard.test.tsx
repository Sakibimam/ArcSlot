import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { encodeAbiParameters, encodeEventTopics, keccak256, toHex } from 'viem'
import { SLOT_ABI } from '@/lib/abis'
import { wagmiState, wagmiModule, resetWagmi } from '@/test/wagmi-mock'

vi.mock('wagmi', () => wagmiModule)
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { toast } from 'sonner'
import { SlotCard } from './SlotCard'

const SLOT = '0x00000000000000000000000000000000000000aa'
const payRef = keccak256(toHex('order-1'))

function slotReads({ balance, quarantined = false, minSweep = 100_000n }: { balance: bigint; quarantined?: boolean; minSweep?: bigint }) {
  wagmiState.readContracts = {
    isLoading: false,
    data: [
      { result: payRef },
      { result: 0 },
      { result: quarantined },
      { result: minSweep },
      { result: balance },
    ],
  }
}

const sweepButton = () => screen.getByRole('button', { name: /sweep/i })

beforeEach(() => {
  resetWagmi()
  vi.mocked(toast.success).mockClear()
})

describe('SlotCard', () => {
  it('shows Awaiting payment and disables Sweep when empty', () => {
    slotReads({ balance: 0n })
    render(<SlotCard slotAddress={SLOT} chainId={5042} onSwept={vi.fn()} />)
    expect(screen.getByText('Awaiting payment')).toBeInTheDocument()
    expect(sweepButton()).toBeDisabled()
  })

  it('gates Sweep below the on-chain minimum', () => {
    slotReads({ balance: 50_000n })
    render(<SlotCard slotAddress={SLOT} chainId={5042} onSwept={vi.fn()} />)
    expect(screen.getByText('Below minimum (0.10 USDC)')).toBeInTheDocument()
    expect(sweepButton()).toBeDisabled()
  })

  it('enables Sweep when funded and calls sweep() on the slot', () => {
    slotReads({ balance: 100_000n })
    render(<SlotCard slotAddress={SLOT} chainId={5042} onSwept={vi.fn()} />)
    expect(screen.getByText('Funded')).toBeInTheDocument()
    fireEvent.click(sweepButton())
    expect(wagmiState.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: SLOT, functionName: 'sweep', chainId: 5042 }),
    )
  })

  it('shows Quarantined and disables Sweep', () => {
    slotReads({ balance: 1_000_000n, quarantined: true })
    render(<SlotCard slotAddress={SLOT} chainId={5042} onSwept={vi.fn()} />)
    expect(screen.getAllByText(/Quarantined/).length).toBeGreaterThan(0)
    expect(sweepButton()).toBeDisabled()
  })

  it('reports the receipt from the sweep tx exactly once, across re-renders', () => {
    slotReads({ balance: 1_000_000n })
    const sweeper = '0x00000000000000000000000000000000000000bb'
    wagmiState.write = { data: '0xfeed', isPending: false, error: null }
    wagmiState.waitReceipt = {
      isLoading: false,
      isSuccess: true,
      data: {
        logs: [{
          address: SLOT,
          topics: encodeEventTopics({ abi: SLOT_ABI, eventName: 'Received', args: { payRef_: payRef, sweeper } }),
          data: encodeAbiParameters(
            [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
            [1_000_000n, 997_000n, 0n, 3_000n],
          ),
        }],
      },
    }
    const onSwept = vi.fn()
    const { rerender } = render(<SlotCard slotAddress={SLOT} chainId={5042} onSwept={onSwept} />)
    rerender(<SlotCard slotAddress={SLOT} chainId={5042} onSwept={onSwept} />)
    rerender(<SlotCard slotAddress={SLOT} chainId={5042} onSwept={onSwept} />)

    expect(onSwept).toHaveBeenCalledTimes(1)
    expect(onSwept).toHaveBeenCalledWith(SLOT, expect.objectContaining({ gross: 1_000_000n, reimbursement: 3_000n, txHash: '0xfeed' }))
    expect(toast.success).toHaveBeenCalledTimes(1)
  })

  it('renders the receipt panel for a swept slot', () => {
    slotReads({ balance: 0n })
    const receipt = { gross: 1_000_000n, net: 947_000n, fee: 50_000n, reimbursement: 3_000n, sweeper: '0x00000000000000000000000000000000000000bb', txHash: '0xfeed' }
    render(<SlotCard slotAddress={SLOT} chainId={5042} receipt={receipt} onSwept={vi.fn()} />)
    expect(screen.getByText('Swept')).toBeInTheDocument()
    expect(screen.getByText('0.947')).toBeInTheDocument()
    expect(screen.getByText('0.003')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /view transaction/i })).toHaveAttribute('href', expect.stringContaining('/tx/0xfeed'))
  })
})
