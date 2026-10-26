import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'

vi.mock('connectkit', () => ({ ConnectKitButton: () => null }))

import { LogoMark, PrintMark, ISSUE_PAPER, ISSUE_SLOT } from './Logo'
import { Header } from './Header'
import { LandingPage } from './LandingPage'

const SERIAL_RED = '#C8372D'

describe('The Issue logo', () => {
  it('draws a strip of paper arcing out of a slot, engraved (three strokes)', () => {
    const { container } = render(<LogoMark />)
    const svg = container.querySelector('svg')!
    expect(svg).toHaveAttribute('viewBox', '0 0 64 64')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    const strokes = svg.querySelectorAll(`path[d="${ISSUE_PAPER}"]`)
    expect([...strokes].map((p) => p.getAttribute('stroke-width'))).toEqual(['10', '6', '1'])
    const slot = svg.querySelector('rect')!
    for (const [k, v] of Object.entries(ISSUE_SLOT)) expect(slot).toHaveAttribute(k, String(v))
  })

  it('the favicon is the same mark: paper strip, red slot, on bank-note green', () => {
    const fav = readFileSync('public/favicon.svg', 'utf8')
    expect(fav).toContain(`d="${ISSUE_PAPER}"`)
    expect(fav).toContain('fill="#12352B"')
    expect(fav).toMatch(new RegExp(`<rect x="7" y="45" width="50" height="10" rx="5" fill="${SERIAL_RED}"`))
  })

  it('the app header home link shows the mark next to the name', () => {
    render(<Header />)
    const home = screen.getByRole('link', { name: 'ArcSlot' })
    expect(home).toHaveAttribute('href', '#/')
    expect(home.querySelector('svg[viewBox="0 0 64 64"]')).not.toBeNull()
  })

  it('the landing nav shows the mark next to the name', () => {
    render(<LandingPage />)
    const home = screen.getAllByRole('link', { name: 'ArcSlot' })[0]
    expect(home.querySelector('svg[viewBox="0 0 64 64"]')).not.toBeNull()
  })

  describe('PrintMark (the payment animation)', () => {
    it('sending: paper keeps feeding at the slot', () => {
      render(<PrintMark state="sending" />)
      const svg = screen.getByRole('img', { name: /sending payment/i })
      expect(svg.querySelector('[data-part="paper"]')!.getAttribute('class')).toMatch(/motion-safe:animate-receipt-feed/)
      expect(svg.querySelector('[data-part="slot"]')).not.toBeNull()
    })

    it('paid: a receipt prints out of the slot and ends in a red PAID', () => {
      render(<PrintMark state="paid" />)
      const svg = screen.getByRole('img', { name: /^paid$/i })
      expect(svg.querySelector('[data-part="paper"]')!.getAttribute('class')).toMatch(/motion-safe:animate-receipt-print/)
      const stamp = svg.querySelector('text')!
      expect(stamp.textContent).toBe('*PAID*')
      expect(stamp).toHaveAttribute('fill', SERIAL_RED)
    })

    it('reduced motion: no animation runs outside motion-safe', () => {
      for (const state of ['sending', 'paid'] as const) {
        const { container, unmount } = render(<PrintMark state={state} />)
        for (const el of container.querySelectorAll('[class]'))
          for (const c of el.getAttribute('class')!.split(/\s+/))
            if (c.includes('animate-')) expect(c.startsWith('motion-safe:')).toBe(true)
        unmount()
      }
    })

    it('tone="current" draws in the text colour (for use inside buttons)', () => {
      const { container } = render(<PrintMark state="sending" tone="current" />)
      expect(container.querySelector('[data-part="slot"]')).toHaveAttribute('fill', 'currentColor')
    })
  })
})
