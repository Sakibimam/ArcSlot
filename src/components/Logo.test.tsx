import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'

vi.mock('connectkit', () => ({ ConnectKitButton: () => null }))

import { LogoMark, DropMark, DROP_COIN, DROP_SLOT } from './Logo'
import { Header } from './Header'
import { LandingPage } from './LandingPage'

describe('The Drop logo', () => {
  it('draws a half coin over a slot on the 64 grid', () => {
    const { container } = render(<LogoMark />)
    const svg = container.querySelector('svg')!
    expect(svg).toHaveAttribute('viewBox', '0 0 64 64')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg.querySelector('path')).toHaveAttribute('d', DROP_COIN)
    const slot = svg.querySelector('rect')!
    for (const [k, v] of Object.entries(DROP_SLOT)) expect(slot).toHaveAttribute(k, String(v))
  })

  it('the favicon is the same mark', () => {
    const fav = readFileSync('public/favicon.svg', 'utf8')
    expect(fav).toContain(`d="${DROP_COIN}"`)
    expect(fav).toMatch(/<rect x="8" y="37" width="48" height="8" rx="4"/)
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

  describe('DropMark (the animated mark)', () => {
    it('sending: a whole coin keeps falling into the slot and vanishes inside it', () => {
      render(<DropMark state="sending" />)
      const svg = screen.getByRole('img', { name: /sending payment/i })
      const coin = svg.querySelector('circle')!
      expect(coin.getAttribute('class')).toMatch(/motion-safe:animate-drop-fall/)
      // Clipped at the slot's top edge, so the coin disappears into the slot.
      const clip = svg.querySelector('clipPath rect')!
      expect(clip).toHaveAttribute('height', String(DROP_SLOT.y))
      expect(coin.closest('g')).toHaveAttribute('clip-path', expect.stringContaining(svg.querySelector('clipPath')!.id))
    })

    it('paid: the half coin lands in the slot and turns paid green', () => {
      render(<DropMark state="paid" />)
      const svg = screen.getByRole('img', { name: /^paid$/i })
      const coin = svg.querySelector('path')!
      expect(coin).toHaveAttribute('d', DROP_COIN)
      expect(coin).toHaveAttribute('fill', '#0B7A4B')
      expect(coin.getAttribute('class')).toMatch(/motion-safe:animate-drop-land/)
    })

    it('reduced motion: no animation runs outside motion-safe', () => {
      for (const state of ['sending', 'paid'] as const) {
        const { container, unmount } = render(<DropMark state={state} />)
        for (const el of container.querySelectorAll('[class]'))
          for (const c of el.getAttribute('class')!.split(/\s+/))
            if (c.includes('animate-')) expect(c.startsWith('motion-safe:')).toBe(true)
        unmount()
      }
    })

    it('tone="current" draws in the text colour (for use inside buttons)', () => {
      const { container } = render(<DropMark state="sending" tone="current" />)
      expect(container.querySelector('circle')).toHaveAttribute('fill', 'currentColor')
      expect(container.querySelector('svg > rect')).toHaveAttribute('fill', 'currentColor')
    })
  })
})
