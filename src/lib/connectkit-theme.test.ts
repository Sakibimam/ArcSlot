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
  it('is applied to the ConnectKit provider', () => {
    expect(readFileSync('src/main.tsx', 'utf8')).toMatch(/<ConnectKitProvider[^>]*customTheme=\{CONNECTKIT_THEME\}/)
  })
})
