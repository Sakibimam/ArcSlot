import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'

vi.mock('connectkit', () => ({ ConnectKitButton: () => null }))

import { LogoMark, DROP_COIN, DROP_SLOT } from './Logo'
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
})
