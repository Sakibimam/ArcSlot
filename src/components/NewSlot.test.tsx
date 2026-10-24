import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { wagmiState, wagmiModule, resetWagmi } from '@/test/wagmi-mock'

vi.mock('wagmi', () => wagmiModule)
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const FACTORY = '0x00000000000000000000000000000000000000f0'
const factories: Record<number, string | null> = { 5042: FACTORY, 5042002: null }
vi.mock('@/lib/chains', async (orig) => ({
  ...(await orig<typeof import('@/lib/chains')>()),
  getFactoryAddress: (id: number) => factories[id],
}))

import { NewSlot } from './NewSlot'

const MERCHANT = '0x1111111111111111111111111111111111111111'
const PREDICTED = '0x2222222222222222222222222222222222222222'

function fill(label: RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

beforeEach(() => {
  resetWagmi()
  wagmiState.account = { address: MERCHANT, chainId: 5042 }
})

describe('NewSlot', () => {
  it('never shows a predicted address when the factory is not deployed', () => {
    wagmiState.readContract = { data: PREDICTED }
    wagmiState.account = { address: MERCHANT, chainId: 5042002 }
    render(<NewSlot chainId={5042002} onSlotCreated={vi.fn()} />)
    fill(/merchant address/i, MERCHANT)
    fill(/payment reference/i, 'order-1')
    expect(screen.queryByText(PREDICTED)).not.toBeInTheDocument()
    expect(screen.getByText(/not yet deployed/i)).toBeInTheDocument()
  })

  it('shows the predicted address before confirming', () => {
    wagmiState.readContract = { data: PREDICTED }
    render(<NewSlot chainId={5042} onSlotCreated={vi.fn()} />)
    fill(/merchant address/i, MERCHANT)
    fill(/payment reference/i, 'order-1')
    expect(screen.getByText(PREDICTED)).toBeInTheDocument()
  })

  it('defaults max reimbursement to 0.05 USDC and passes it to createSlot', () => {
    wagmiState.readContract = { data: PREDICTED }
    render(<NewSlot chainId={5042} onSlotCreated={vi.fn()} />)
    fill(/merchant address/i, MERCHANT)
    fill(/payment reference/i, 'order-1')
    expect(screen.getByLabelText(/max sweeper reimbursement/i)).toHaveValue('0.05')
    fireEvent.click(screen.getByRole('button', { name: /create slot/i }))
    const call = wagmiState.writeContract.mock.calls[0][0] as { functionName: string; address: string; args: unknown[] }
    expect(call.functionName).toBe('createSlot')
    expect(call.address).toBe(FACTORY)
    expect(call.args[0]).toBe(MERCHANT)
    expect(call.args[4]).toBe(50_000n)
  })

  it('blocks creation when max reimbursement is invalid', () => {
    wagmiState.readContract = { data: PREDICTED }
    render(<NewSlot chainId={5042} onSlotCreated={vi.fn()} />)
    fill(/merchant address/i, MERCHANT)
    fill(/payment reference/i, 'order-1')
    fill(/max sweeper reimbursement/i, 'abc')
    expect(screen.getByRole('button', { name: /create slot/i })).toBeDisabled()
  })

  it('reports the created slot exactly once across re-renders', () => {
    wagmiState.readContract = { data: PREDICTED }
    wagmiState.write = { data: '0xabc', isPending: false, error: null }
    wagmiState.waitReceipt = { data: {}, isLoading: false, isSuccess: true }
    const onCreated = vi.fn()
    const { rerender } = render(<NewSlot chainId={5042} onSlotCreated={onCreated} />)
    fill(/merchant address/i, MERCHANT)
    fill(/payment reference/i, 'order-1')
    rerender(<NewSlot chainId={5042} onSlotCreated={onCreated} />)
    rerender(<NewSlot chainId={5042} onSlotCreated={onCreated} />)
    expect(onCreated).toHaveBeenCalledTimes(1)
    expect(onCreated).toHaveBeenCalledWith(PREDICTED)
  })
})
