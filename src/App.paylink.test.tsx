import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { useEffect } from 'react'
import { wagmiModule, connectkitModule, resetWagmi } from '@/test/wagmi-mock'

vi.mock('wagmi', () => wagmiModule)
vi.mock('connectkit', () => connectkitModule)
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/RecoverPanel', () => ({ RecoverPanel: () => null }))

// Counts how many fresh pay pages are mounted, and for which slot.
const mounts: string[] = []
vi.mock('@/components/PayPage', () => ({
  PayPage: ({ slot }: { slot: string }) => {
    useEffect(() => { mounts.push(slot) }, [])
    return null
  },
}))

import App from './App'

const A = '0x124Fa5b92C5140F3d9EBA465265683C4eD94725D'
const B = '0x99A2aDf55E6284DaCB49e9D6FA14b4AA6AE7e7a0'

beforeEach(() => {
  resetWagmi()
  mounts.length = 0
})

// Bug seen live: after paying link A, opening link B in the same tab showed B as
// "Payment sent" / PAID, because the pay page (and its sent state) was reused.
describe('App — every payment link gets its own fresh pay page', () => {
  it('remounts the pay page when the link changes in the same tab', () => {
    window.location.hash = `#/pay/5042002/${A}`
    render(<App />)
    expect(mounts).toEqual([A])
    act(() => {
      window.location.hash = `#/pay/5042002/${B}`
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(mounts).toEqual([A, B])
  })
})
