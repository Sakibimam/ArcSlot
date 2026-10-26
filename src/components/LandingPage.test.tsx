import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'

// LandingPage uses no wagmi hooks so no mock needed
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { LandingPage, CREATE_REQUEST_ARGS } from './LandingPage'
import { SLOT_FACTORY_ABI } from '@/lib/abis'

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

  it('ends on the free plan as the closing call to action (no separate CTA band)', () => {
    render(<LandingPage />)
    expect(screen.queryByText(/your next invoice could cost two cents/i)).not.toBeInTheDocument()
    const plan = screen.getByRole('region', { name: /one plan\. free\./i })
    expect(plan).toHaveTextContent('$0')
    expect(plan).toHaveTextContent(/no ArcSlot fee, ever/i)
    expect(plan).not.toHaveTextContent(/no platform fee/i) // creators can still add their own fee
    expect(within(plan).getByRole('link', { name: /create a payment link/i })).toHaveAttribute('href', '#/app')
  })
})

describe('value propositions', () => {
  const PROPS: [RegExp, RegExp, string][] = [
    [/^paid means paid\.$/i, /see how it works/i, '#/docs/lifecycle'],
    [/^keep the 1\.5%\.$/i, /do the maths/i, '#/docs/fees'],
    [/^nobody in the middle\.$/i, /read the code/i, 'https://github.com/Sakibimam/ArcSlot'],
    [/^wrong network\? still yours\.$/i, /learn about recovery/i, '#/docs/recovery'],
    [/^locked with tomorrow.s maths\.$/i, /set up a vault/i, '#/app'],
    [/^let your software get paid\.$/i, /view the code/i, '#/docs/api'],
  ]

  it('tells six value stories in order, each with its own call to action', () => {
    render(<LandingPage />)
    const h2s = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent ?? '')
    const at = PROPS.map(([re]) => h2s.findIndex((t) => re.test(t)))
    expect(at.every((i) => i >= 0), JSON.stringify(h2s)).toBe(true)
    expect(at).toEqual([...at].sort((a, b) => a - b))
    for (const [re, cta, href] of PROPS) {
      const section = screen.getByRole('region', { name: re })
      expect(within(section).getByRole('link', { name: cta })).toHaveAttribute('href', href)
    }
  })

  it('each headline has an italic serif turn', () => {
    render(<LandingPage />)
    for (const [re] of PROPS) {
      const h = screen.getByRole('heading', { level: 2, name: re })
      expect(h.querySelector('.font-serif.italic')).not.toBeNull()
    }
  })

  it('"paid means paid" is honest: it settles in a second, and reaches your wallet when collected', () => {
    render(<LandingPage />)
    const s = screen.getByRole('region', { name: /paid means paid/i })
    expect(s).not.toHaveTextContent(/in your wallet in seconds/i)
    expect(s).toHaveTextContent(/settled on arc/i)
    expect(s).toHaveTextContent(/collected/i)
  })

  it('the fee story keeps the sourced $1,000 comparison with the bars that draw in', () => {
    render(<LandingPage />)
    const s = screen.getByRole('region', { name: /keep the 1\.5%/i })
    expect(s).toHaveTextContent('$23.60')
    expect(s).toHaveTextContent('$15.00')
    expect(s.querySelectorAll('[data-part="fee-bar"]')).toHaveLength(3)
    expect(within(s).getByRole('link', { name: /motley fool/i })).toBeInTheDocument()
  })

  it('the software snippet matches the real createRequest arguments, in order', () => {
    render(<LandingPage />)
    const abiArgs = SLOT_FACTORY_ABI.find((f) => 'name' in f && f.name === 'createRequest')!.inputs.map((i) => i.name)
    expect(CREATE_REQUEST_ARGS.map((a) => a.param)).toEqual(abiArgs)
    const code = screen.getByRole('region', { name: /let your software get paid/i }).querySelector('pre')!
    expect(code).toHaveTextContent('createRequest(')
    for (const a of CREATE_REQUEST_ARGS) expect(code).toHaveTextContent(a.value)
  })

  it('the old overlapping sections are gone (no duplicate stories)', () => {
    render(<LandingPage />)
    expect(screen.queryByText(/nobody holds your money\. not even us\./i)).not.toBeInTheDocument()
    expect(screen.queryByText(/what a \$1,000 invoice costs/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/no api key\. no sign-up\.$/i)).not.toBeInTheDocument()
  })

  it('the vault story uses its own sky crop, on phones and desktop alike', () => {
    render(<LandingPage />)
    const s = screen.getByRole('region', { name: /locked with tomorrow.s maths/i })
    expect(s.querySelector('img')).toHaveAttribute('src', '/images/vault-sky.jpg')
  })

  it('closes with a plain trust line', () => {
    render(<LandingPage />)
    expect(screen.getByText(/built on circle usdc \+ cctp/i)).toBeInTheDocument()
    expect(screen.getByText(/every line of code public/i)).toBeInTheDocument()
  })
})
