import { describe, it, expect } from 'vitest'
import { sourceChainsFor, arcBridgeChain, buildPaymentParams, summarizeQuote, checkQuote, explainCrossChainError } from './crosschain'

const SLOT = '0x047508895350F679424507a7ae62e13bc2e015a9'

describe('sourceChainsFor', () => {
  it('offers testnet sources for Arc testnet', () => {
    const keys = sourceChainsFor(5042002).map((c) => c.key)
    expect(keys).toEqual(['Base_Sepolia', 'Ethereum_Sepolia', 'Arbitrum_Sepolia'])
    expect(sourceChainsFor(5042002)[0]).toEqual({ key: 'Base_Sepolia', name: 'Base Sepolia', chainId: 84532, gasToken: 'ETH' })
  })
  it('offers mainnet sources for Arc mainnet', () => {
    expect(sourceChainsFor(5042).map((c) => c.key)).toEqual(['Base', 'Ethereum', 'Arbitrum', 'Optimism', 'Polygon', 'Avalanche'])
  })
})

describe('arcBridgeChain', () => {
  it('maps Arc chain ids to bridge names', () => {
    expect(arcBridgeChain(5042002)).toBe('Arc_Testnet')
    expect(arcBridgeChain(5042)).toBe('Arc')
  })
})

describe('buildPaymentParams', () => {
  it('mints straight into the slot via the forwarder, with the payer covering fees', () => {
    expect(buildPaymentParams({ slot: SLOT, amount: 1_500_000n, arcChainId: 5042002 })).toEqual({
      to: { chain: 'Arc_Testnet', recipientAddress: SLOT, useForwarder: true },
      amount: '1.50',
      config: { feePayment: 'source' },
    })
  })
  it('keeps full 6-decimal precision', () => {
    expect(buildPaymentParams({ slot: SLOT, amount: 1_234_567n, arcChainId: 5042 }).amount).toBe('1.234567')
  })
  it('rejects zero', () => {
    expect(() => buildPaymentParams({ slot: SLOT, amount: 0n, arcChainId: 5042 })).toThrow(/amount/i)
  })
})

describe('summarizeQuote', () => {
  it('converts the quote to 6-decimal amounts', () => {
    expect(summarizeQuote({ amountReceived: '1.5', feeTotal: '0.159019', totalDebit: '1.659019' })).toEqual({
      receives: 1_500_000n, fee: 159_019n, debit: 1_659_019n,
    })
  })
  it('throws on a malformed quote', () => {
    expect(() => summarizeQuote({ amountReceived: 'x', feeTotal: '0', totalDebit: '0' })).toThrow()
  })
})

// v8 (audit L-5): never let a quote that short-pays the merchant through.
describe('checkQuote', () => {
  it('accepts a quote that delivers exactly the requested amount', () => {
    expect(checkQuote({ receives: 200_000n, fee: 10_000n, debit: 210_000n }, 200_000n)).toEqual({ ok: true, highFee: false, feePercent: 5 })
  })
  it('refuses a quote that delivers less than requested', () => {
    expect(checkQuote({ receives: 199_999n, fee: 10_000n, debit: 209_999n }, 200_000n)).toEqual({ ok: false })
  })
  it('flags a fee above a quarter of the payment', () => {
    expect(checkQuote({ receives: 200_000n, fee: 145_270n, debit: 345_270n }, 200_000n)).toEqual({ ok: true, highFee: true, feePercent: 73 })
  })
})

describe('explainCrossChainError', () => {
  const eth = { name: 'Ethereum Sepolia', gasToken: 'ETH' }
  const kit = (name: string, message = 'x') => Object.assign(new Error(message), { name })

  it('no gas on the source chain', () => {
    expect(explainCrossChainError(kit('BALANCE_INSUFFICIENT_GAS'), eth, '1.020389')).toMatch(/not enough ETH on Ethereum Sepolia to pay gas/i)
    expect(explainCrossChainError(new Error('insufficient funds for gas * price + value'), eth, '1.020389')).toMatch(/not enough ETH/i)
  })
  it('not enough USDC, naming the exact amount needed', () => {
    expect(explainCrossChainError(kit('BALANCE_INSUFFICIENT_TOKEN'), eth, '1.020389')).toMatch(/need 1\.020389 USDC on Ethereum Sepolia/i)
    expect(explainCrossChainError(new Error('ERC20: transfer amount exceeds balance'), eth, '1.020389')).toMatch(/need 1\.020389 USDC/i)
  })
  it('a blocked or failed connection to Circle (ad blockers, Brave Shields)', () => {
    for (const e of [kit('NETWORK_CONNECTION_FAILED'), kit('NETWORK_TIMEOUT'), new TypeError('Failed to fetch')])
      expect(explainCrossChainError(e, eth, '1')).toMatch(/couldn.t reach Circle.*ad blocker|shields/i)
  })
  it('the wallet did not switch network', () => {
    expect(explainCrossChainError(kit('INPUT_CHAIN_SWITCH_REJECTED'), eth, '1')).toMatch(/switch your wallet to Ethereum Sepolia/i)
    expect(explainCrossChainError(kit('NETWORK_MISMATCH'), eth, '1')).toMatch(/switch your wallet to Ethereum Sepolia/i)
  })
  it('cancelled in the wallet', () => {
    expect(explainCrossChainError(kit('INPUT_USER_CANCELLED'), eth, '1')).toBe('You cancelled the payment.')
    expect(explainCrossChainError(new Error('User rejected the request.'), eth, '1')).toBe('You cancelled the payment.')
  })
  it('an expired quote, and rate limits', () => {
    expect(explainCrossChainError(new Error('Quote expired'), eth, '1')).toMatch(/quote expired.*review/i)
    expect(explainCrossChainError(kit('RATE_LIMIT_EXCEEDED'), eth, '1')).toMatch(/busy.*minute/i)
  })
  it('anything else still says what went wrong, briefly', () => {
    const msg = explainCrossChainError(new Error('execution reverted: FeeManager: bad signature'), eth, '1')
    expect(msg).toMatch(/nothing was sent/i)
    expect(msg).toMatch(/FeeManager: bad signature/)
    expect(explainCrossChainError(new Error('x'.repeat(500)), eth, '1').length).toBeLessThan(220)
  })
})
