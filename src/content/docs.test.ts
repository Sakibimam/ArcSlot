import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { DOCS, DOCS_GROUPS, DOCS_UPDATED, SLOT_IMPL, docById, type Block } from './docs'
import { ARC_TESTNET_ID, FACTORY_ADDRESSES, SLOT_VAULT_IMPL, VAULT_FACTORY_ADDRESSES } from '@/lib/chains'

const texts = (b: Block): string[] => {
  switch (b.type) {
    case 'p': case 'h3': case 'note': return [b.text]
    case 'list': return b.items
    case 'steps': return b.items.flatMap((i) => [i.title, i.text])
    case 'table': return [...b.head, ...b.rows.flat()]
    case 'code': return [b.code]
    case 'flow': return [b.label, ...b.nodes.flatMap((n) => [n.title, n.sub])]
  }
}
const allText = DOCS.flatMap((d) => d.blocks.flatMap(texts)).join('\n')
const ADDRESSES = [FACTORY_ADDRESSES[ARC_TESTNET_ID], VAULT_FACTORY_ADDRESSES[ARC_TESTNET_ID], SLOT_IMPL, SLOT_VAULT_IMPL]

describe('docs content', () => {
  it('every section has a unique url-safe id, a group, a summary and content', () => {
    const ids = DOCS.map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const d of DOCS) {
      expect(d.id).toMatch(/^[a-z][a-z0-9-]*$/)
      expect(DOCS_GROUPS).toContain(d.group)
      expect(d.summary.length).toBeGreaterThan(10)
      expect(d.blocks.length).toBeGreaterThan(0)
    }
  })

  it('sections are ordered by group, so the sidebar and prev/next agree', () => {
    const order = DOCS.map((d) => DOCS_GROUPS.indexOf(d.group))
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it('covers architecture, the payment flow, fees, cross-chain, recovery, vault, contracts and local setup', () => {
    for (const id of ['overview', 'architecture', 'lifecycle', 'fees', 'cross-chain', 'recovery', 'vault', 'contracts', 'api', 'develop', 'testing', 'security'])
      expect(DOCS.map((d) => d.id)).toContain(id)
  })

  it('every internal docs link points at a real section', () => {
    const links = [...allText.matchAll(/\]\(#\/docs\/([^)]+)\)/g)].map((m) => m[1])
    expect(links.length).toBeGreaterThan(5)
    for (const id of links) expect(DOCS.map((d) => d.id), id).toContain(id)
  })

  it('external links are https', () => {
    for (const [, href] of allText.matchAll(/\]\(([^)#][^)]*)\)/g)) expect(href).toMatch(/^https:\/\//)
  })

  it('shows the live contract addresses from chains.ts', () => {
    for (const a of ADDRESSES) expect(allText).toContain(a)
  })

  it('has a real last-updated date', () => {
    expect(DOCS_UPDATED).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(Number.isNaN(Date.parse(DOCS_UPDATED))).toBe(false)
  })

  it('unknown or missing ids fall back to the first section', () => {
    expect(docById('nope').id).toBe(DOCS[0].id)
    expect(docById(undefined).id).toBe(DOCS[0].id)
    expect(docById('fees').id).toBe('fees')
  })
})

describe('README stays in sync with the docs', () => {
  const readme = readFileSync('README.md', 'utf8')
  it('lists the same live contract addresses', () => {
    for (const a of ADDRESSES) expect(readme).toContain(a)
  })
  it('has an Architecture section with a diagram', () => {
    expect(readme).toMatch(/^## Architecture$/m)
    expect(readme).toMatch(/```mermaid[\s\S]+Slot[\s\S]+```/)
  })
  it('points readers to the docs site', () => {
    expect(readme).toContain('https://arc-slot-three.vercel.app/#/docs')
  })
})
