import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// v8 (audit L-6): the deployed site sends real security headers. Vercel builds
// from GitHub and reads the ROOT vercel.json (a copy inside public/ would only
// be served as a static file and its headers ignored).
type Header = { key: string; value: string }
const cfg = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
  installCommand?: string; buildCommand?: string; outputDirectory?: string
  headers: { source: string; headers: Header[] }[]
}
const all = cfg.headers.find((h) => h.source === '/(.*)')!.headers
const get = (k: string) => all.find((h) => h.key.toLowerCase() === k.toLowerCase())?.value ?? ''
const csp = get('Content-Security-Policy')
const directive = (name: string) => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? ''

describe('vercel build settings', () => {
  it('builds from a clean, locked install into dist/', () => {
    expect(cfg.installCommand).toBe('bun install --frozen-lockfile')
    expect(cfg.buildCommand).toBe('bun run build')
    expect(cfg.outputDirectory).toBe('dist')
  })
  it('keeps no stray copy in public/ (it would ship as a static file)', () => {
    expect(() => readFileSync('public/vercel.json')).toThrow()
  })
})

describe('security headers', () => {
  it('forbids framing (clickjacking)', () => {
    expect(directive('frame-ancestors')).toBe("frame-ancestors 'none'")
    expect(get('X-Frame-Options')).toBe('DENY')
  })
  it('only runs scripts from this origin: no inline, no eval', () => {
    expect(directive('script-src')).toBe("script-src 'self'")
  })
  it('blocks plugins and base-tag hijacking', () => {
    expect(directive('object-src')).toBe("object-src 'none'")
    expect(directive('base-uri')).toBe("base-uri 'self'")
  })
  it('sets the usual hardening headers', () => {
    expect(get('X-Content-Type-Options')).toBe('nosniff')
    expect(get('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
    expect(get('Permissions-Policy')).toMatch(/camera=\(\)/)
  })
})
