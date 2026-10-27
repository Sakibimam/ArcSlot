import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { IMG_RATIO } from './morph'

// The landing photos ship as-is from public/images. A tool once round-tripped them as
// text, which silently corrupted every file (the page showed empty frames), so check bytes.
describe('landing photos', () => {
  const dir = 'public/images'
  const jpgs = readdirSync(dir).filter((f) => f.endsWith('.jpg'))

  it('are all present', () => {
    expect(jpgs.sort()).toEqual(['card-consultant.jpg', 'card-designer.jpg', 'hero-sky-mobile.jpg', 'hero-sky.jpg', 'vault-sky.jpg'])
  })

  it('are real JPEGs (start with FF D8 FF, end with FF D9)', () => {
    for (const f of jpgs) {
      const b = readFileSync(`${dir}/${f}`)
      expect([b[0], b[1], b[2]], f).toEqual([0xff, 0xd8, 0xff])
      expect([b[b.length - 2], b[b.length - 1]], f).toEqual([0xff, 0xd9])
    }
  })

  it('stay light: hero under 320 KB, everything else under 120 KB', () => {
    for (const f of jpgs) expect(statSync(`${dir}/${f}`).size, f).toBeLessThan(f === 'hero-sky.jpg' ? 320_000 : 120_000)
  })

  it('are credited', () => {
    const credits = readFileSync(`${dir}/CREDITS.md`, 'utf8')
    for (const f of jpgs) expect(credits, f).toContain(f)
    expect(credits).toMatch(/Unsplash License/)
    // A photo whose source isn't confirmed yet must never ship.
    expect(credits).not.toMatch(/to confirm/i)
  })

  // The scroll morph's geometry (src/lib/morph.ts) is measured on the hero photo's exact size.
  it('the hero photo has the size the morph geometry was measured on', () => {
    const size = (f: string) => {
      const b = readFileSync(`${dir}/${f}`)
      for (let i = 2; i < b.length; ) {
        const marker = b[i + 1]
        if (marker >= 0xc0 && marker <= 0xc2) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)]
        i += 2 + b.readUInt16BE(i + 2)
      }
      return [0, 0]
    }
    const [w, h] = size('hero-sky.jpg')
    expect(w / h).toBeCloseTo(IMG_RATIO, 4)
    expect(size('hero-sky-mobile.jpg')).toEqual([800, 1200])
  })
})
