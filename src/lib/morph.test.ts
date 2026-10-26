import { describe, it, expect } from 'vitest'
import { heroGeometry, morphState, FRAME_ON_IMAGE } from './morph'

const near = (a: number, b: number, tol = 2) => Math.abs(a - b) <= tol

describe('hero geometry', () => {
  it('puts the frame around her torso exactly as on the 1440×900 mock (806, 430, 420×560)', () => {
    const g = heroGeometry(1440, 900)
    expect(near(g.frame.x, 806)).toBe(true)
    expect(near(g.frame.y, 430)).toBe(true)
    expect(near(g.frame.w, 420)).toBe(true)
    expect(near(g.frame.h, 560)).toBe(true)
  })

  it('the photo always covers the stage, at any size', () => {
    for (const [w, h] of [[1024, 900], [1280, 720], [1440, 900], [1920, 1080], [2560, 1080], [1024, 1366]]) {
      const { img } = heroGeometry(w, h)
      expect(img.x).toBeLessThanOrEqual(0)
      expect(img.y).toBeLessThanOrEqual(0)
      expect(img.x + img.w).toBeGreaterThanOrEqual(w)
      expect(img.y + img.h).toBeGreaterThanOrEqual(h)
    }
  })

  it('the frame tracks her on the photo (same image-relative spot) at every size', () => {
    for (const [w, h] of [[1280, 720], [1920, 1080], [1024, 1366]]) {
      const { img, frame } = heroGeometry(w, h)
      expect((frame.x - img.x) / img.w).toBeCloseTo(FRAME_ON_IMAGE.x, 3)
      expect((frame.y - img.y) / img.h).toBeCloseTo(FRAME_ON_IMAGE.y, 3)
    }
  })

  it('the end card keeps the frame shape, sits centred and fully on screen, with side cards beside it', () => {
    for (const [w, h] of [[1280, 720], [1440, 900], [1920, 1080]]) {
      const { frame, card, left, right } = heroGeometry(w, h)
      expect(card.w / card.h).toBeCloseTo(frame.w / frame.h, 5)
      expect(near(card.x + card.w / 2, w / 2, 1)).toBe(true)
      expect(card.y).toBeGreaterThan(0)
      expect(card.y + card.h).toBeLessThanOrEqual(h)
      expect(left.x + left.w).toBeLessThan(card.x)
      expect(right.x).toBeGreaterThan(card.x + card.w)
      expect(left.x).toBeGreaterThanOrEqual(0)
      expect(right.x + right.w).toBeLessThanOrEqual(w)
    }
  })
})

describe('hero layout at every size', () => {
  const sizes = [[1024, 640], [1280, 720], [1366, 768], [1440, 900], [1536, 864], [1920, 1080], [2560, 1440]]
  it('the end row leaves room for the nav and the section heading above it (≥ 300px)', () => {
    for (const [w, h] of sizes) expect(heroGeometry(w, h).card.y, `${w}x${h}`).toBeGreaterThanOrEqual(300)
  })
  it('on the hero, the invoice row inside the frame (52%–70% of its height) is fully on screen', () => {
    for (const [w, h] of sizes) {
      const { frame } = heroGeometry(w, h)
      expect(frame.y + frame.h * 0.7, `${w}x${h}`).toBeLessThanOrEqual(h)
    }
  })
})

describe('morph state', () => {
  const g = heroGeometry(1440, 900)

  it('p = 0: the photo is full screen, text fully visible, cards hidden', () => {
    const s = morphState(0, g)
    expect(s.clip).toBe('inset(0px 0px 0px 0px round 0px)')
    expect(s.transform).toBe('translate(0px, 0px) scale(1)')
    expect(s.textOpacity).toBe(1)
    expect(s.cards).toBe(0)
  })

  it('p = 0.4: the photo is clipped exactly to the frame, text gone, still in place', () => {
    const s = morphState(0.4, g)
    const [top, right, bottom, left] = s.clip.match(/-?[\d.]+(?=px)/g)!.map(Number)
    expect(near(top, g.frame.y, 0.5)).toBe(true)
    expect(near(left, g.frame.x, 0.5)).toBe(true)
    expect(near(right, g.w - g.frame.x - g.frame.w, 0.5)).toBe(true)
    expect(near(bottom, g.h - g.frame.y - g.frame.h, 0.5)).toBe(true)
    expect(s.textOpacity).toBe(0)
    expect(s.transform).toBe('translate(0px, 0px) scale(1)')
  })

  it('p = 1: the framed photo lands exactly on the middle card and the side cards are in', () => {
    const s = morphState(1, g)
    const [dx, dy] = s.transform.match(/-?[\d.]+(?=px)/g)!.map(Number)
    const scale = Number(s.transform.match(/scale\(([-\d.]+)\)/)![1])
    // transform-origin is the frame's top-left, so that corner moves by (dx, dy) and the frame scales by `scale`
    expect(near(g.frame.x + dx, g.card.x, 0.5)).toBe(true)
    expect(near(g.frame.y + dy, g.card.y, 0.5)).toBe(true)
    expect(g.frame.w * scale).toBeCloseTo(g.card.w, 1)
    expect(s.cards).toBe(1)
    expect(s.outline).toBe(0)
  })

  it('the text lifts away (a transform, no blur filter) and the side cards slide in', () => {
    expect(morphState(0, g).textLift).toBe(0)
    expect(morphState(0.3, g).textLift).toBe(-40)
    expect(morphState(0, g).slide).toBe(80)
    expect(morphState(1, g).slide).toBe(0)
    expect(Object.keys(morphState(0.5, g))).not.toContain('blur')
  })

  it('clamps outside 0..1', () => {
    expect(morphState(-1, g)).toEqual(morphState(0, g))
    expect(morphState(2, g)).toEqual(morphState(1, g))
  })
})
