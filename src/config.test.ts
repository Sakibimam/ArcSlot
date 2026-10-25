import { describe, it, expect } from 'vitest'
import { config } from './config'
import { sourceChainsFor } from '@/lib/crosschain'

describe('wagmi config', () => {
  it('registers every cross-chain payment source so wallets can switch to it', () => {
    const ids = config.chains.map((c) => c.id)
    for (const s of [...sourceChainsFor(5042002), ...sourceChainsFor(5042)]) expect(ids).toContain(s.chainId)
  })
  it('still has both Arc networks', () => {
    const ids = config.chains.map((c) => c.id)
    expect(ids).toContain(5042)
    expect(ids).toContain(5042002)
  })
})
