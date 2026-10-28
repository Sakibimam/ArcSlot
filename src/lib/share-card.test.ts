import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// Links shared on X, LinkedIn, Telegram etc. unfold into a large preview card.
const html = readFileSync('index.html', 'utf8')
const meta = (attr: 'property' | 'name', key: string) =>
  new RegExp(`<meta\\s+${attr}="${key.replace('.', '\\.')}"\\s+content="([^"]+)"`).exec(html)?.[1]

describe('share preview card', () => {
  it('has a title, description and a large image card for X and Open Graph', () => {
    expect(meta('property', 'og:title')).toMatch(/ArcSlot/)
    expect(meta('property', 'og:description')?.length).toBeGreaterThan(40)
    expect(meta('name', 'description')?.length).toBeGreaterThan(40)
    expect(meta('name', 'twitter:card')).toBe('summary_large_image')
    expect(meta('property', 'og:image')).toBe('https://arc-slot-three.vercel.app/og.jpg')
    expect(meta('name', 'twitter:image')).toBe('https://arc-slot-three.vercel.app/og.jpg')
  })

  it('the image exists at the 1200x630 size the cards expect, and is small', () => {
    const b = readFileSync('public/og.jpg')
    expect([b[0], b[1]]).toEqual([0xff, 0xd8])
    let size: number[] = []
    for (let i = 2; i < b.length; ) {
      if (b[i + 1] >= 0xc0 && b[i + 1] <= 0xc2) { size = [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)]; break }
      i += 2 + b.readUInt16BE(i + 2)
    }
    expect(size).toEqual([1200, 630])
    expect(b.length).toBeLessThan(300_000)
  })
})
