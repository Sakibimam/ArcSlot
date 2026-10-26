import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
import { LandingPage, HERO_RECEIPTS } from './LandingPage'

const setReducedMotion = (reduced: boolean) => {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: reduced && q.includes('reduce'), media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }))
}

let observe: ((entries: { isIntersecting: boolean }[]) => void) | undefined
beforeEach(() => {
  vi.useFakeTimers()
  observe = undefined
  window.IntersectionObserver = class {
    constructor(cb: (e: { isIntersecting: boolean }[]) => void) { observe = cb }
    observe() {}
    disconnect() {}
    unobserve() {}
  } as unknown as typeof IntersectionObserver
})
afterEach(() => {
  vi.useRealTimers()
  // @ts-expect-error test cleanup
  delete window.matchMedia
  // @ts-expect-error test cleanup
  delete window.IntersectionObserver
})

describe('landing motion', () => {
  it('the hero keeps printing new receipts, each with the next serial', () => {
    setReducedMotion(false)
    render(<LandingPage />)
    expect(screen.getByText(/rachel mayer/i)).toBeInTheDocument()
    expect(screen.getByText('No. AS 0042')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(6_000) })
    expect(screen.queryByText(/rachel mayer/i)).not.toBeInTheDocument()
    expect(screen.getByText(new RegExp(HERO_RECEIPTS[1].payee, 'i'))).toBeInTheDocument()
    expect(screen.getByText('No. AS 0043')).toBeInTheDocument()
  })

  it('every receipt adds up: you get the amount minus the 0.02 network fee', () => {
    for (const r of HERO_RECEIPTS) expect(Math.round((r.amount - 0.02) * 100)).toBe(Math.round(r.net * 100))
  })

  it('with reduced motion the hero receipt stays put', () => {
    setReducedMotion(true)
    render(<LandingPage />)
    act(() => { vi.advanceTimersByTime(20_000) })
    expect(screen.getByText(/rachel mayer/i)).toBeInTheDocument()
  })

  it('fee bars start empty and draw in when the ledger scrolls into view', () => {
    setReducedMotion(false)
    render(<LandingPage />)
    const bars = () => [...document.querySelectorAll<HTMLElement>('[data-part="fee-bar"]')]
    expect(bars().map((b) => b.style.width)).toEqual(['0%', '0%', '0%'])
    act(() => { observe?.([{ isIntersecting: true }]) })
    expect(bars().map((b) => b.style.width)).toEqual(['100%', '64%', '0.09%'])
  })

  it('without IntersectionObserver (old browsers) the bars are simply full', () => {
    setReducedMotion(false)
    // @ts-expect-error simulate a browser without it
    delete window.IntersectionObserver
    render(<LandingPage />)
    const widths = [...document.querySelectorAll<HTMLElement>('[data-part="fee-bar"]')].map((b) => b.style.width)
    expect(widths).toEqual(['100%', '64%', '0.09%'])
  })

  it('the rosettes turn slowly, only under motion-safe', () => {
    setReducedMotion(false)
    const { container } = render(<LandingPage />)
    const turning = container.querySelectorAll('g.motion-safe\\:animate-rosette')
    expect(turning.length).toBeGreaterThan(0)
  })
})
