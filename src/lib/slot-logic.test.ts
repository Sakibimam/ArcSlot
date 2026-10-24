import { describe, it, expect } from 'vitest'
import { type Hex, encodeAbiParameters, encodeEventTopics, keccak256, toHex } from 'viem'
import { SLOT_ABI } from './abis'
import {
  deriveSlotStatus,
  canSweep,
  parseUsdc6,
  formatUsdc6,
  decodeSweepReceipt,
  loadSlots,
  saveSlots,
} from './slot-logic'

const MIN = 100_000n

describe('deriveSlotStatus', () => {
  const base = { loading: false, quarantined: false, balance: 0n, minSweep: MIN, receipt: undefined }

  it('is loading while reads are in flight', () => {
    expect(deriveSlotStatus({ ...base, loading: true })).toBe('loading')
  })
  it('is awaiting when empty', () => {
    expect(deriveSlotStatus(base)).toBe('awaiting')
  })
  it('is below-minimum when 0 < balance < minSweep', () => {
    expect(deriveSlotStatus({ ...base, balance: 50_000n })).toBe('below-minimum')
  })
  it('is funded at exactly minSweep', () => {
    expect(deriveSlotStatus({ ...base, balance: MIN })).toBe('funded')
  })
  it('quarantine wins over balance', () => {
    expect(deriveSlotStatus({ ...base, quarantined: true, balance: MIN })).toBe('quarantined')
  })
  it('is swept when a receipt exists and the slot is empty', () => {
    const receipt = { gross: 1n, net: 1n, fee: 0n, reimbursement: 0n, sweeper: '0x1', txHash: '0x2' }
    expect(deriveSlotStatus({ ...base, receipt })).toBe('swept')
  })
  it('a swept slot that is paid again becomes funded again', () => {
    const receipt = { gross: 1n, net: 1n, fee: 0n, reimbursement: 0n, sweeper: '0x1', txHash: '0x2' }
    expect(deriveSlotStatus({ ...base, receipt, balance: MIN })).toBe('funded')
  })
  it('treats unknown balance as loading', () => {
    expect(deriveSlotStatus({ ...base, balance: undefined })).toBe('loading')
  })
})

describe('canSweep', () => {
  it('only allows funded slots', () => {
    expect(canSweep('funded')).toBe(true)
    for (const s of ['loading', 'awaiting', 'below-minimum', 'swept', 'quarantined'] as const) {
      expect(canSweep(s)).toBe(false)
    }
  })
})

describe('parseUsdc6', () => {
  it('parses decimal strings to 6-dec units', () => {
    expect(parseUsdc6('0.05')).toBe(50_000n)
    expect(parseUsdc6('1')).toBe(1_000_000n)
    expect(parseUsdc6('0.000001')).toBe(1n)
  })
  it('rejects bad input', () => {
    expect(parseUsdc6('')).toBeNull()
    expect(parseUsdc6('abc')).toBeNull()
    expect(parseUsdc6('-1')).toBeNull()
    expect(parseUsdc6('0.0000001')).toBeNull()
  })
})

describe('formatUsdc6', () => {
  it('keeps sub-cent precision so tips are visible', () => {
    expect(formatUsdc6(2_000n)).toBe('0.002')
    expect(formatUsdc6(618n)).toBe('0.000618')
  })
  it('shows at least 2 decimals', () => {
    expect(formatUsdc6(1_000_000n)).toBe('1.00')
    expect(formatUsdc6(1_500_000n)).toBe('1.50')
    expect(formatUsdc6(0n)).toBe('0.00')
  })
})

describe('decodeSweepReceipt', () => {
  const slot = '0x00000000000000000000000000000000000000aa' as const
  const sweeper = '0x00000000000000000000000000000000000000bb' as const
  const payRef = keccak256(toHex('order-1'))
  const receivedLog = {
    address: slot,
    topics: encodeEventTopics({ abi: SLOT_ABI, eventName: 'Received', args: { payRef_: payRef, sweeper } }) as Hex[],
    data: encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
      [1_000_000n, 990_000n, 0n, 10_000n],
    ),
  }

  it('decodes the Received event from the sweep tx receipt', () => {
    const r = decodeSweepReceipt([receivedLog], slot, '0xabc')
    expect(r).toEqual({
      gross: 1_000_000n, net: 990_000n, fee: 0n, reimbursement: 10_000n,
      sweeper: sweeper, txHash: '0xabc',
    })
  })
  it('ignores logs from other contracts', () => {
    const other = { ...receivedLog, address: '0x00000000000000000000000000000000000000cc' as const }
    expect(decodeSweepReceipt([other], slot, '0xabc')).toBeNull()
  })
  it('returns null when the sweep quarantined instead', () => {
    expect(decodeSweepReceipt([], slot, '0xabc')).toBeNull()
  })
})

describe('slot persistence', () => {
  it('round-trips slots including bigint receipts', () => {
    const slots = [
      { address: '0xaa', chainId: 5042, receipt: { gross: 5n, net: 4n, fee: 0n, reimbursement: 1n, sweeper: '0xbb', txHash: '0xcc' } },
      { address: '0xdd', chainId: 5042002 },
    ]
    saveSlots(slots)
    expect(loadSlots()).toEqual(slots)
  })
  it('returns [] on corrupt storage', () => {
    localStorage.setItem('arc-slot:slots:v1', '{not json')
    expect(loadSlots()).toEqual([])
  })
})
