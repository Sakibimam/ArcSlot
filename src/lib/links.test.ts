import { describe, it, expect } from 'vitest'
import { buildPayHash, parseRoute } from './links'

const SLOT = '0x10C2D81E0197F64Bd3e4c460a516eaDB0C348b7F'

describe('buildPayHash', () => {
  it('encodes chain, slot, amount and label', () => {
    expect(buildPayHash({ chainId: 5042002, slot: SLOT, amount: 1_500_000n, label: 'Invoice #42' }))
      .toBe(`#/pay/5042002/${SLOT}?amount=1.5&for=Invoice+%2342`)
  })
  it('omits optional fields', () => {
    expect(buildPayHash({ chainId: 5042, slot: SLOT })).toBe(`#/pay/5042/${SLOT}`)
  })
})

describe('parseRoute', () => {
  it('routes empty hash and #/ to the landing page', () => {
    expect(parseRoute('')).toEqual({ page: 'landing' })
    expect(parseRoute('#/')).toEqual({ page: 'landing' })
  })
  it('routes #/app to the merchant dashboard', () => {
    expect(parseRoute('#/app')).toEqual({ page: 'merchant' })
  })
  it('routes unknown hashes to the landing page', () => {
    expect(parseRoute('#/nonsense')).toEqual({ page: 'landing' })
  })
  it('round-trips a pay link', () => {
    const hash = buildPayHash({ chainId: 5042002, slot: SLOT, amount: 1_500_000n, label: 'Invoice #42' })
    expect(parseRoute(hash)).toEqual({ page: 'pay', chainId: 5042002, slot: SLOT, amount: 1_500_000n, label: 'Invoice #42' })
  })
  it('accepts a pay link without amount or label', () => {
    expect(parseRoute(`#/pay/5042/${SLOT}`)).toEqual({ page: 'pay', chainId: 5042, slot: SLOT, amount: undefined, label: undefined })
  })
  it('rejects unsupported chains and bad addresses', () => {
    expect(parseRoute(`#/pay/1/${SLOT}`)).toEqual({ page: 'invalid-pay' })
    expect(parseRoute('#/pay/5042/0x1234')).toEqual({ page: 'invalid-pay' })
  })
  it('ignores a malformed amount instead of trusting it', () => {
    expect(parseRoute(`#/pay/5042/${SLOT}?amount=-5`)).toMatchObject({ page: 'pay', amount: undefined })
  })
  it('caps the label length', () => {
    const r = parseRoute(`#/pay/5042/${SLOT}?for=${'x'.repeat(500)}`)
    expect(r.page === 'pay' && r.label?.length).toBe(80)
  })
})

describe('parseRoute — collectors', () => {
  it('routes #/collect to the collector leaderboard', () => {
    expect(parseRoute('#/collect')).toEqual({ page: 'collectors' })
  })
})

describe('parseRoute — docs', () => {
  it('routes #/docs to the docs home and #/docs/<id> to a section', () => {
    expect(parseRoute('#/docs')).toEqual({ page: 'docs', section: undefined })
    expect(parseRoute('#/docs/')).toEqual({ page: 'docs', section: undefined })
    expect(parseRoute('#/docs/architecture')).toEqual({ page: 'docs', section: 'architecture' })
  })
  it('keeps only a url-safe section id', () => {
    expect(parseRoute('#/docs/<script>')).toEqual({ page: 'docs', section: undefined })
  })
})

describe('parseRoute — stats', () => {
  it('routes #/stats to the public stats page', () => {
    expect(parseRoute('#/stats')).toEqual({ page: 'stats' })
  })
})
