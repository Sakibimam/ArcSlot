import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { type Hex, encodeAbiParameters, encodeEventTopics, keccak256, toHex } from 'viem'
import { SLOT_ABI } from '@/lib/abis'
import { wagmiState, wagmiModule, connectkitModule, resetWagmi } from '@/test/wagmi-mock'

vi.mock('wagmi', () => wagmiModule)
vi.mock('connectkit', () => connectkitModule)
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { toast } from 'sonner'
import { RequestCard } from './RequestCard'

const SLOT = '0x00000000000000000000000000000000000000aa'
const payRef = keccak256(toHex('order-1'))
const request = { address: SLOT, chainId: 5042002, label: 'Invoice #42', amount: 1_000_000n }

function reads({ balance, quarantined = false, minSweep = 100_000n, collected = 0n }: { balance: bigint; quarantined?: boolean; minSweep?: bigint; collected?: bigint }) {
  wagmiState.readContracts = {
    isLoading: false, isError: false,
    data: [{ result: quarantined }, { result: minSweep }, { result: balance }, { result: collected }],
  }
}
const collectBtn = () => screen.getByRole('button', { name: /collect/i })

beforeEach(() => {
  resetWagmi()
  vi.mocked(toast.success).mockClear()
})

describe('RequestCard', () => {
  it('shows the label, amount and waiting state', () => {
    reads({ balance: 0n })
    render(<RequestCard request={request} onSwept={vi.fn()} />)
    expect(screen.getByText('Invoice #42')).toBeInTheDocument()
    expect(screen.getByText('Waiting for payment')).toBeInTheDocument()
    expect(screen.getByTestId('received')).toHaveTextContent('0.00 of 1.00 USDC received')
    expect(collectBtn()).toBeDisabled()
  })

  it('shows partial progress and allows collecting what arrived', () => {
    reads({ balance: 400_000n })
    render(<RequestCard request={request} onSwept={vi.fn()} />)
    expect(screen.getByText('Partially paid')).toBeInTheDocument()
    expect(screen.getByTestId('received')).toHaveTextContent('0.40 of 1.00 USDC received')
    expect(collectBtn()).toBeEnabled()
  })

  it('explains the minimum when too little has arrived to collect', () => {
    reads({ balance: 50_000n })
    render(<RequestCard request={request} onSwept={vi.fn()} />)
    expect(collectBtn()).toBeDisabled()
    expect(screen.getByText(/collect from 0\.10 USDC/i)).toBeInTheDocument()
  })

  it('marks a fully paid request and collects via sweep()', () => {
    reads({ balance: 1_000_000n })
    render(<RequestCard request={request} onSwept={vi.fn()} />)
    expect(screen.getByText('Paid')).toBeInTheDocument()
    fireEvent.click(collectBtn())
    expect(wagmiState.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: SLOT, functionName: 'sweep', chainId: 5042002 }),
    )
  })

  it('shows on-hold when quarantined', () => {
    reads({ balance: 1_000_000n, quarantined: true })
    render(<RequestCard request={request} onSwept={vi.fn()} />)
    expect(screen.getByText('On hold')).toBeInTheDocument()
    expect(collectBtn()).toBeDisabled()
  })

  it('opens the share sheet with the payment link', () => {
    reads({ balance: 0n })
    render(<RequestCard request={request} onSwept={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /share/i }))
    expect(screen.getByTestId('pay-link')).toHaveTextContent(`#/pay/5042002/${SLOT}?amount=1&for=Invoice+%2342`)
  })

  it('reports the collect receipt exactly once', () => {
    reads({ balance: 1_000_000n })
    const sweeper = '0x00000000000000000000000000000000000000bb'
    wagmiState.write = { data: '0xfeed', isPending: false, error: null }
    wagmiState.waitReceipt = {
      isLoading: false, isSuccess: true,
      data: { logs: [{
        address: SLOT,
        topics: encodeEventTopics({ abi: SLOT_ABI, eventName: 'Received', args: { payRef_: payRef, sweeper } }) as Hex[],
        data: encodeAbiParameters(
          [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
          [1_000_000n, 1_000_000n, 0n, 0n],
        ),
      }] },
    }
    const onSwept = vi.fn()
    const { rerender } = render(<RequestCard request={request} onSwept={onSwept} />)
    rerender(<RequestCard request={request} onSwept={onSwept} />)
    expect(onSwept).toHaveBeenCalledTimes(1)
    expect(onSwept).toHaveBeenCalledWith(SLOT, expect.objectContaining({ net: 1_000_000n, txHash: '0xfeed' }))
    expect(toast.success).toHaveBeenCalledTimes(1)
  })

  it('shows what the merchant received once collected', () => {
    reads({ balance: 0n })
    const receipt = { gross: 1_000_000n, net: 947_000n, fee: 50_000n, reimbursement: 3_000n, sweeper: '0x00000000000000000000000000000000000000bb', txHash: '0xfeed' }
    render(<RequestCard request={{ ...request, receipt }} onSwept={vi.fn()} />)
    expect(screen.getByText('Collected')).toBeInTheDocument()
    expect(screen.getByText(/you received/i)).toHaveTextContent('0.947 USDC')
    fireEvent.click(screen.getByRole('button', { name: /details/i }))
    expect(screen.getByText('0.003')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /view transaction/i })).toHaveAttribute('href', expect.stringContaining('/tx/0xfeed'))
  })
})

describe('RequestCard — collected on another device', () => {
  it('shows collected from on-chain data without a local receipt', () => {
    reads({ balance: 0n, collected: 1_000_000n })
    render(<RequestCard request={request} onSwept={vi.fn()} />)
    expect(screen.getByText('Collected')).toBeInTheDocument()
    expect(screen.getByTestId('collected')).toHaveTextContent('1.00 USDC collected')
  })
})
