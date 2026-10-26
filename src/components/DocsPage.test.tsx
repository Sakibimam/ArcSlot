import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { DocsPage } from './DocsPage'
import { DOCS, DOCS_GROUPS, DOCS_UPDATED } from '@/content/docs'
import { ARC_TESTNET_ID, FACTORY_ADDRESSES } from '@/lib/chains'

beforeEach(() => { window.scrollTo = () => {} })

describe('DocsPage', () => {
  it('opens on the first section, with one h1 and the section title', () => {
    render(<DocsPage section={undefined} />)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(DOCS[0].title)
    expect(screen.getByText(DOCS[0].summary)).toBeInTheDocument()
  })

  it('the sidebar lists every section under its group and marks the current one', () => {
    render(<DocsPage section="fees" />)
    const nav = screen.getByRole('navigation', { name: /docs/i })
    for (const g of DOCS_GROUPS) expect(within(nav).getByText(g)).toBeInTheDocument()
    for (const d of DOCS) expect(within(nav).getByRole('link', { name: d.title })).toHaveAttribute('href', `#/docs/${d.id}`)
    expect(within(nav).getByRole('link', { name: 'Fees and collectors' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: 'Architecture' })).not.toHaveAttribute('aria-current')
  })

  it('an unknown section shows the first one instead of a blank page', () => {
    render(<DocsPage section="nope" />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(DOCS[0].title)
  })

  it('renders inline code, bold and links from the content', () => {
    render(<DocsPage section="architecture" />)
    const main = screen.getByRole('main')
    expect(main.querySelector('code')).not.toBeNull()
    expect(main.querySelector('strong')).not.toBeNull()
    expect(within(main).getAllByRole('link', { name: 'recovery' })[0]).toHaveAttribute('href', '#/docs/recovery')
    // no raw markdown left over
    expect(main.textContent).not.toMatch(/\*\*|\]\(/)
  })

  it('external links open in a new tab safely', () => {
    render(<DocsPage section="overview" />)
    const faucet = screen.getByRole('link', { name: 'Circle faucet' })
    expect(faucet).toHaveAttribute('target', '_blank')
    expect(faucet.getAttribute('rel')).toMatch(/noopener/)
  })

  it('renders the architecture flow, tables, steps, notes and code blocks', () => {
    render(<DocsPage section="architecture" />)
    expect(screen.getByRole('list', { name: 'Path of a payment' })).toBeInTheDocument()
    expect(screen.getAllByRole('table').length).toBeGreaterThan(0)
    expect(screen.getByRole('columnheader', { name: 'Layer' })).toBeInTheDocument()
  })

  it('code blocks are copyable', () => {
    render(<DocsPage section="develop" />)
    expect(screen.getAllByRole('button', { name: /copy/i }).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/bun run dev/).length).toBeGreaterThan(0)
  })

  it('the contracts page shows live addresses linked to the explorer', () => {
    render(<DocsPage section="contracts" />)
    const a = FACTORY_ADDRESSES[ARC_TESTNET_ID]
    expect(screen.getByRole('link', { name: a })).toHaveAttribute('href', `https://explorer.testnet.arc.io/address/${a}`)
  })

  it('prev / next links walk the sections in order', () => {
    render(<DocsPage section={DOCS[1].id} />)
    expect(screen.getByRole('link', { name: new RegExp(`previous.*${DOCS[0].title}`, 'i') })).toHaveAttribute('href', `#/docs/${DOCS[0].id}`)
    expect(screen.getByRole('link', { name: new RegExp(`next.*${DOCS[2].title}`, 'i') })).toHaveAttribute('href', `#/docs/${DOCS[2].id}`)
  })

  it('shows when the docs were last updated and links back to the app', () => {
    render(<DocsPage section={undefined} />)
    expect(screen.getByText(new RegExp(DOCS_UPDATED))).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /open app/i })[0]).toHaveAttribute('href', '#/app')
  })
})
