import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'

describe('favicon', () => {
  const html = readFileSync('index.html', 'utf8')
  it('index.html links an SVG favicon and an Apple touch icon', () => {
    expect(html).toMatch(/<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg"/)
    expect(html).toMatch(/<link rel="apple-touch-icon" href="\/apple-touch-icon\.png"/)
    expect(html).toMatch(/<meta name="theme-color" content="#0B2A21"/)
  })
  it('the icon files ship with the site', () => {
    expect(existsSync('public/favicon.svg')).toBe(true)
    expect(existsSync('public/apple-touch-icon.png')).toBe(true)
    expect(readFileSync('public/favicon.svg', 'utf8')).toMatch(/<svg[^>]+viewBox="0 0 64 64"/)
  })
})
