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

  it('shows the FAQ accordion', () => {
    render(<LandingPage />)
    expect(screen.getByText(/do i need an account/i)).toBeInTheDocument()
  })

  it('shows the final CTA section', () => {
    render(<LandingPage />)
    expect(screen.getByText(/your next invoice could cost two cents/i)).toBeInTheDocument()
  })
})
