import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { CONNECTKIT_THEME } from './connectkit-theme'

describe('wallet button theme', () => {
  it('matches the hybrid look: pill, ink green, Archivo', () => {
    expect(CONNECTKIT_THEME['--ck-connectbutton-border-radius']).toBe('999px')
    expect(CONNECTKIT_THEME['--ck-primary-button-border-radius']).toBe('999px')
    expect(CONNECTKIT_THEME['--ck-secondary-button-border-radius']).toBe('999px')
    expect(CONNECTKIT_THEME['--ck-border-radius']).toBe('20px')
    expect(CONNECTKIT_THEME['--ck-connectbutton-background']).toBe('#0B2A21')
    expect(CONNECTKIT_THEME['--ck-connectbutton-color']).toBe('#F6F7F2')
    expect(CONNECTKIT_THEME['--ck-font-family']).toMatch(/^Archivo/)
  })
  // Phones in dark mode got ConnectKit's dark panels under our ink text ("What is a wallet?" unreadable).
  it('stays light whatever the system theme is', () => {
    expect(readFileSync('src/main.tsx', 'utf8')).toMatch(/<ConnectKitProvider[^>]*mode="light"/)
  })
  it('is applied to the ConnectKit provider', () => {
    expect(readFileSync('src/main.tsx', 'utf8')).toMatch(/<ConnectKitProvider[^>]*customTheme=\{CONNECTKIT_THEME\}/)
  })

  // ConnectKit draws the network menu dark by default; our ink text vanished on it.
  it('the network menu is readable: every text colour has ≥ 4.5:1 contrast on its background', () => {
    const lum = (hex: string) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    }
    const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05) }
    const t = CONNECTKIT_THEME
    const pairs: [string, string][] = [
      ['--ck-dropdown-color', '--ck-dropdown-background'],
      ['--ck-dropdown-button-color', '--ck-dropdown-background'],
      ['--ck-dropdown-button-hover-color', '--ck-dropdown-button-hover-background'],
      ['--ck-dropdown-active-color', '--ck-dropdown-active-background'],
      ['--ck-dropdown-active-static-color', '--ck-dropdown-active-background'],
      ['--ck-dropdown-pending-color', '--ck-dropdown-background'],
    ]
    for (const [fg, bg] of pairs) {
      expect(t[fg], fg).toMatch(/^#[0-9A-F]{6}$/i)
      expect(t[bg], bg).toMatch(/^#[0-9A-F]{6}$/i)
      expect(ratio(t[fg], t[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
    }
  })
})
