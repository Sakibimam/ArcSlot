import { describe, it, expect } from 'vitest'
import { candidates, worthCollecting, priorityCost6 } from './collector-logic'

const MIN = 100_000n
const TIP = 2_000n

describe('candidates', () => {
  it('keeps slots holding at least the minimum and not on hold', () => {
    const slots = [
      { slot: '0xa', balance: 150_000n, quarantined: false },
      { slot: '0xb', balance: 50_000n, quarantined: false },  // below minimum
      { slot: '0xc', balance: 900_000n, quarantined: true },  // on hold
      { slot: '0xd', balance: 0n, quarantined: false },        // empty
      { slot: '0xe', balance: 100_000n, quarantined: false },  // exactly the minimum
    ]
    expect(candidates(slots, MIN).map((s) => s.slot)).toEqual(['0xa', '0xe'])
  })

  it('collects the biggest first', () => {
    const slots = [
      { slot: '0xa', balance: 150_000n, quarantined: false },
      { slot: '0xb', balance: 5_000_000n, quarantined: false },
    ]
    expect(candidates(slots, MIN).map((s) => s.slot)).toEqual(['0xb', '0xa'])
  })
})

describe('priorityCost6', () => {
  it('converts priority fee x gas into 6-decimal USDC', () => {
    // 1 gwei * 200k gas = 2e14 wei of native USDC = 200 micro-USDC
    expect(priorityCost6(200_000n, 1_000_000_000n)).toBe(200n)
  })
})

describe('worthCollecting', () => {
  it('collects when the simulation passed and the priority fee is below the tip', () => {
    expect(worthCollecting({ simulated: true, gasEstimate: 200_000n, priorityFee: 1_000_000_000n, tip: TIP })).toBe(true)
  })
  it('skips when the simulation reverted (gas too high, already collected)', () => {
    expect(worthCollecting({ simulated: false, gasEstimate: 0n, priorityFee: 1_000_000_000n, tip: TIP })).toBe(false)
  })
  it('skips when a high priority fee would eat the tip', () => {
    expect(worthCollecting({ simulated: true, gasEstimate: 200_000n, priorityFee: 20_000_000_000n, tip: TIP })).toBe(false)
  })
})
