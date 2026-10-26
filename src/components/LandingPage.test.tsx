import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// LandingPage uses no wagmi hooks so no mock needed
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { LandingPage } from './LandingPage'

describe('LandingPage', () => {
  it('renders the hero H1', () => {
    render(<LandingPage />)
    expect(
      screen.getByRole('heading', { level: 1, name: /cents, not percent/i }),
    ).toBeInTheDocument()
  })

  it('has a "Create a payment link" link pointing to #/app', () => {
    render(<LandingPage />)
    const links = screen.getAllByRole('link', { name: /create a payment link/i })
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) {
      expect(link).toHaveAttribute('href', '#/app')
    }
  })

  it('shows the ledger section', () => {
    render(<LandingPage />)
    expect(screen.getByText(/what a \$1,000 invoice costs/i)).toBeInTheDocument()
    expect(screen.getAllByText(/~\$0\.02/i).length).toBeGreaterThan(0)
  })

  it('the hero frame shows the first payment: item (no person names), serial and PAID', () => {
    render(<LandingPage />)
    expect(screen.getByText('Brand strategy')).toBeInTheDocument()
    expect(screen.getByText('No. AS 0042')).toBeInTheDocument()
    expect(screen.getByText('*PAID*', { selector: '[data-part="hero-frame"] *' })).toBeInTheDocument()
    expect(screen.queryByText(/rachel mayer|priya/i)).not.toBeInTheDocument()
  })

  it('the headline has "Cents," lead and an italic serif turn with "percent" struck out', () => {
    render(<LandingPage />)
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1.querySelector('[data-part="headline-lead"]')).toHaveTextContent(/^Cents,$/)
    const turn = h1.querySelector('[data-part="headline-turn"]')!
    expect(turn).toHaveClass('font-serif', 'italic')
    expect(turn.querySelector('s')).toHaveTextContent('percent')
  })

  it('shows the hero subline once: "One link. Any wallet. USDC in seconds."', () => {
    render(<LandingPage />)
    expect(screen.getByText('One link. Any wallet. USDC in seconds.')).toBeInTheDocument()
  })

  it('backs the hero with three plain facts', () => {
    render(<LandingPage />)
    const facts = screen.getByRole('list', { name: /at a glance/i })
    expect(facts.querySelectorAll('li')).toHaveLength(3)
    expect(facts).toHaveTextContent(/~\$0\.02/)
    expect(facts).toHaveTextContent(/under a second/i)
    expect(facts).toHaveTextContent(/no custody/i)
  })

  it('credits Circle CCTP for paying from other chains (how it works + FAQ)', () => {
    render(<LandingPage />)
    expect(screen.getByText(/from Ethereum, Base or Arbitrum through Circle.s CCTP/i)).toBeInTheDocument()
    expect(screen.getByText(/can customers pay from another chain\?/i)).toBeInTheDocument()
  })

  it('shows the FAQ accordion', () => {
    render(<LandingPage />)
    expect(screen.getByText(/do i need an account/i)).toBeInTheDocument()
  })

  it('shows the final CTA section', () => {
    render(<LandingPage />)
    expect(screen.getByText(/your next invoice could cost two cents/i)).toBeInTheDocument()
  })
})
