import { describe, it, expect } from 'vitest'
import { recoveryAlert } from './vault-watch'

const ZERO = `0x${'00'.repeat(32)}`
const KEY = `0x${'ab'.repeat(32)}`

// v8 (audit M-5): a stolen wallet key starts a 7-day recovery; the owner must hear about it.
describe('recoveryAlert', () => {
  it('is quiet when no recovery is pending', () => {
    expect(recoveryAlert({ pendingKey: ZERO, recoveryReadyAt: 0n, now: 1_000n })).toBeNull()
  })
  it('alerts with the time left to cancel', () => {
    const a = recoveryAlert({ pendingKey: KEY, recoveryReadyAt: 1_000n + 3n * 86_400n, now: 1_000n })
    expect(a?.level).toBe('warning')
    expect(a?.secondsLeft).toBe(3n * 86_400n)
    expect(a?.message).toMatch(/3 days left to cancel/i)
  })
  it('escalates once the delay has passed (anyone can complete it)', () => {
    const a = recoveryAlert({ pendingKey: KEY, recoveryReadyAt: 500n, now: 1_000n })
    expect(a?.level).toBe('critical')
    expect(a?.message).toMatch(/can be completed now/i)
  })
})
