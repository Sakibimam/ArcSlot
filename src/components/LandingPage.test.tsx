import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// LandingPage uses no wagmi hooks so no mock needed
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { LandingPage } from './LandingPage'

describe('LandingPage', () => {
  it('renders the hero H1', () => {
    render(<LandingPage />)
    expect(
      screen.getByRole('heading', { level: 1, name: /get paid in usdc for cents, not percent/i }),
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

  it('the hero receipt is issued to Rachel Mayer, serial and all', () => {
    render(<LandingPage />)
    expect(screen.getByText(/rachel mayer/i)).toBeInTheDocument()
    expect(screen.queryByText(/priya/i)).not.toBeInTheDocument()
    expect(screen.getAllByText(/AS 0042/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/\*PAID\*/).length).toBeGreaterThan(0)
  })

  it('the headline pairs engraved capitals with an italic serif turn, "percent" struck out', () => {
    render(<LandingPage />)
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1.querySelector('[data-part="headline-lead"]')).toHaveTextContent(/^Get paid in USDC$/)
    const turn = h1.querySelector('[data-part="headline-turn"]')!
    expect(turn).toHaveClass('font-serif', 'italic')
    expect(turn.querySelector('s')).toHaveTextContent('percent')
  })

  it('backs the hero with three plain facts', () => {
    render(<LandingPage />)
    const facts = screen.getByRole('list', { name: /at a glance/i })
    expect(facts.querySelectorAll('li')).toHaveLength(3)
    expect(facts).toHaveTextContent(/~\$0\.02/)
    expect(facts).toHaveTextContent(/under a second/i)
    expect(facts).toHaveTextContent(/no custody/i)
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
