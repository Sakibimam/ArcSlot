import { describe, it, expect } from 'vitest'
import { sourceChainsFor, arcBridgeChain, buildPaymentParams, summarizeQuote } from './crosschain'

const SLOT = '0x047508895350F679424507a7ae62e13bc2e015a9'

describe('sourceChainsFor', () => {
  it('offers testnet sources for Arc testnet', () => {
    const keys = sourceChainsFor(5042002).map((c) => c.key)
    expect(keys).toEqual(['Base_Sepolia', 'Ethereum_Sepolia', 'Arbitrum_Sepolia'])
    expect(sourceChainsFor(5042002)[0]).toEqual({ key: 'Base_Sepolia', name: 'Base Sepolia', chainId: 84532 })
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
