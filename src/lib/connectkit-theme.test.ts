import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { CONNECTKIT_THEME } from './connectkit-theme'

describe('wallet button theme', () => {
  it('matches the bank-note look: square, ink green, Archivo', () => {
    expect(CONNECTKIT_THEME['--ck-connectbutton-border-radius']).toBe('0px')
    expect(CONNECTKIT_THEME['--ck-connectbutton-background']).toBe('#12352B')
    expect(CONNECTKIT_THEME['--ck-connectbutton-color']).toBe('#ECEEE4')
    expect(CONNECTKIT_THEME['--ck-font-family']).toMatch(/^Archivo/)
  })
  it('is applied to the ConnectKit provider', () => {
    expect(readFileSync('src/main.tsx', 'utf8')).toMatch(/<ConnectKitProvider[^>]*customTheme=\{CONNECTKIT_THEME\}/)
  })
})
