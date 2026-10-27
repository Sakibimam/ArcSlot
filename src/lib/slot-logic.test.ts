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
  deriveRequestStatus,
  canCollect,
  makePayRef,
  pickDefaultChain,
  isRequestPaid,
  requestTrust,
  minimalProxyCode,
  isMinimalProxyTo,
  sanitizeLabel,
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

describe('deriveRequestStatus', () => {
  const base = { loading: false, quarantined: false, balance: 0n, minSweep: MIN, receipt: undefined, amount: 1_000_000n }
  const receipt = { gross: 1n, net: 1n, fee: 0n, reimbursement: 0n, sweeper: '0x1', txHash: '0x2' }

  it('waiting when nothing received', () => {
    expect(deriveRequestStatus(base)).toBe('waiting')
  })
  it('partial when some but not all of the amount arrived', () => {
    expect(deriveRequestStatus({ ...base, balance: 400_000n })).toBe('partial')
  })
  it('paid when the full amount arrived', () => {
    expect(deriveRequestStatus({ ...base, balance: 1_000_000n })).toBe('paid')
    expect(deriveRequestStatus({ ...base, balance: 1_200_000n })).toBe('paid')
  })
  it('collected after a sweep', () => {
    expect(deriveRequestStatus({ ...base, receipt })).toBe('collected')
  })
  it('without a requested amount, any collectable balance counts as paid', () => {
    expect(deriveRequestStatus({ ...base, amount: undefined, balance: MIN })).toBe('paid')
    expect(deriveRequestStatus({ ...base, amount: undefined, balance: 50_000n })).toBe('below-minimum')
  })
  it('on-hold when quarantined, loading while reads pending', () => {
    expect(deriveRequestStatus({ ...base, quarantined: true, balance: MIN })).toBe('on-hold')
    expect(deriveRequestStatus({ ...base, loading: true })).toBe('loading')
  })
})

describe('canCollect', () => {
  it('needs at least minSweep, even if the request is partial', () => {
    expect(canCollect('paid', 1_000_000n, MIN)).toBe(true)
    expect(canCollect('partial', 400_000n, MIN)).toBe(true)
    expect(canCollect('partial', 50_000n, MIN)).toBe(false)
    expect(canCollect('below-minimum', 50_000n, MIN)).toBe(false)
    expect(canCollect('on-hold', 1_000_000n, MIN)).toBe(false)
    expect(canCollect('collected', 0n, MIN)).toBe(false)
  })
})

describe('makePayRef', () => {
  it('is unique per salt so the same label can be reused', () => {
    expect(makePayRef('Coffee', 'a')).not.toBe(makePayRef('Coffee', 'b'))
    expect(makePayRef('Coffee', 'a')).toBe(makePayRef('Coffee', 'a'))
    expect(makePayRef('Coffee', 'a')).toMatch(/^0x[0-9a-f]{64}$/)
  })
})

describe('pickDefaultChain', () => {
  it('defaults to testnet while the contracts are unaudited, even with mainnet deployed (mainnet is one click away)', () => {
    expect(pickDefaultChain({ 5042: '0xabc', 5042002: '0xdef' })).toBe(5042002)
  })
  it('uses mainnet if it is the only network deployed', () => {
    expect(pickDefaultChain({ 5042: '0xabc', 5042002: null })).toBe(5042)
  })
  it('falls back to testnet while mainnet is not deployed', () => {
    expect(pickDefaultChain({ 5042: null, 5042002: '0xdef' })).toBe(5042002)
  })
})

describe('collected requests (any device)', () => {
  const base = { loading: false, quarantined: false, minSweep: MIN, receipt: undefined, amount: 1_000_000n }

  it('is collected when the slot is empty but has paid out before, even without a local receipt', () => {
    expect(deriveRequestStatus({ ...base, balance: 0n, collected: 1_000_000n })).toBe('collected')
  })
  it('counts collected money toward the requested amount', () => {
    expect(deriveRequestStatus({ ...base, balance: 600_000n, collected: 400_000n })).toBe('paid')
    expect(deriveRequestStatus({ ...base, balance: 300_000n, collected: 400_000n })).toBe('partial')
  })
})

describe('isRequestPaid', () => {
  it('is paid once balance plus collected reaches the amount', () => {
    expect(isRequestPaid(1_000_000n, 0n, 1_000_000n)).toBe(true)
    expect(isRequestPaid(1_000_000n, 400_000n, 600_000n)).toBe(true)
    expect(isRequestPaid(1_000_000n, 400_000n, 0n)).toBe(false)
  })
  it('without an amount, anything received counts', () => {
    expect(isRequestPaid(undefined, 0n, 1n)).toBe(true)
    expect(isRequestPaid(undefined, 0n, 0n)).toBe(false)
  })
})

describe('requestTrust', () => {
  const PAYEE = '0x00000000000000000000000000000000000000aa'
  const OWNER = '0x00000000000000000000000000000000000000bb'
  const OTHER = '0x00000000000000000000000000000000000000cc'

  it('is verified when the payee created it', () => {
    expect(requestTrust({ creator: PAYEE, merchant: PAYEE, vaultOwner: undefined })).toBe('verified')
  })
  it('is verified when the owner of the payee vault created it', () => {
    expect(requestTrust({ creator: OWNER, merchant: PAYEE, vaultOwner: OWNER })).toBe('verified')
  })
  it('is unverified when someone else created it', () => {
    expect(requestTrust({ creator: OTHER, merchant: PAYEE, vaultOwner: OWNER })).toBe('unverified')
  })
  it('compares addresses case-insensitively', () => {
    expect(requestTrust({ creator: PAYEE.toUpperCase().replace('0X', '0x'), merchant: PAYEE, vaultOwner: undefined })).toBe('verified')
  })
})

describe('minimalProxyCode / isMinimalProxyTo', () => {
  const IMPL = '0x192C03F98e1Bc1BbF6C50388A7D24ecFcb4280a0'
  it('builds the EIP-1167 runtime code for an implementation', () => {
    expect(minimalProxyCode(IMPL)).toBe('0x363d3d373d3d3d363d73192c03f98e1bc1bbf6c50388a7d24ecfcb4280a05af43d82803e903d91602b57fd5bf3')
  })
  it('recognises a clone of exactly that implementation', () => {
    expect(isMinimalProxyTo(minimalProxyCode(IMPL).toUpperCase().replace('0X', '0x'), IMPL)).toBe(true)
  })
  it('rejects other code, other implementations and missing code', () => {
    expect(isMinimalProxyTo('0x6080604052', IMPL)).toBe(false)
    expect(isMinimalProxyTo(minimalProxyCode('0x5154cec13C1B652FdA465D92fe74aA42FEadfC04'), IMPL)).toBe(false)
    expect(isMinimalProxyTo(undefined, IMPL)).toBe(false)
    expect(isMinimalProxyTo('0x', IMPL)).toBe(false)
  })
})

describe('sanitizeLabel', () => {
  it('removes bidi controls, zero-width and control characters', () => {
    expect(sanitizeLabel('Pay\u202Edsu 001\u202C')).toBe('Paydsu 001')
    expect(sanitizeLabel('a\u200Bb\u200Fc\uFEFFd\u2066e\u2069')).toBe('abcde')
    expect(sanitizeLabel('line\nbreak\ttab\u0007')).toBe('line break tab')
  })
  it('keeps ordinary text, emoji and other scripts', () => {
    expect(sanitizeLabel('Café ☕ — 請求書 #4')).toBe('Café ☕ — 請求書 #4')
  })
  it('collapses whitespace and trims', () => {
    expect(sanitizeLabel('  a   b  ')).toBe('a b')
  })
})
