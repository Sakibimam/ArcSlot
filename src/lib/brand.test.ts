import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// Bank-note art direction: note paper, bank-note green ink, serial red.
describe('brand', () => {
  const css = readFileSync('src/index.css', 'utf8')
  const html = readFileSync('index.html', 'utf8')
  it('uses the bank-note palette', () => {
    expect(css).toMatch(/--paper:\s*#ECEEE4/)
    expect(css).toMatch(/--ink:\s*#12352B/)
    expect(css).toMatch(/--serial:\s*#C8372D/)
  })
  it('loads the engraved display, typewriter and dot-matrix faces', () => {
    expect(html).toMatch(/family=Archivo:wdth,wght@/)
    expect(html).toMatch(/family=IBM\+Plex\+Mono/)
    expect(html).toMatch(/family=DotGothic16/)
    expect(html).not.toMatch(/Schibsted/)
  })
  it('tints the browser chrome bank-note green', () => {
    expect(html).toMatch(/<meta name="theme-color" content="#12352B"/)
  })
})
