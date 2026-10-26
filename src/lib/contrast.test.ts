import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { createElement } from 'react'
import { render } from '@testing-library/react'
import { Card } from '@/components/ui'

// WCAG 2 relative luminance and contrast ratio.
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}
const css = readFileSync('src/index.css', 'utf8')
const token = (name: string) => css.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`))![1]

describe('contrast', () => {
  it('ink text on the page is AAA with room to spare', () => {
    expect(ratio(token('ink'), token('paper'))).toBeGreaterThanOrEqual(12)
  })
  it('secondary text clears AAA (7:1) on both page and cards', () => {
    expect(ratio(token('muted-foreground'), token('paper'))).toBeGreaterThanOrEqual(7)
    expect(ratio(token('muted-foreground'), token('surface'))).toBeGreaterThanOrEqual(7)
  })
  it('serial red stays readable (AA) on the page', () => {
    expect(ratio(token('serial'), token('paper'))).toBeGreaterThanOrEqual(4.5)
  })
  it('near-white page, pure white cards and receipts', () => {
    expect(lum(token('paper'))).toBeGreaterThanOrEqual(0.88)
    expect(token('surface').toUpperCase()).toBe('#FFFFFF')
  })
  it('cards are separated from the page by a visible hairline and a soft shadow', () => {
    const { container } = render(createElement(Card, null, 'x'))
    const card = container.querySelector('section')!
    expect(card.style.border).toMatch(/1px solid rgba\(11, ?42, ?33, ?0\.1\d*\)/)
    expect(card.style.boxShadow).toMatch(/rgba\(11, ?42, ?33/)
  })
  it('no faded text: ink and paper text never drop below 75% opacity', () => {
    const files = ['src/App.tsx', ...readdirSync('src/components').filter((f) => f.endsWith('.tsx') && !f.includes('.test.')).map((f) => `src/components/${f}`)]
    const faded = files.flatMap((f) =>
      [...readFileSync(f, 'utf8').matchAll(/text-(?:ink|paper)\/(\d+)/g)]
        .filter((m) => Number(m[1]) < 75).map((m) => `${f}: ${m[0]}`))
    expect(faded).toEqual([])
  })
})
