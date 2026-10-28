import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { ARC_RPC, arcRpcUrls } from './rpc'

describe('Arc RPC routing (Brave Shields and other blockers)', () => {
  it('tries our own domain first, then Arc directly as a fallback', () => {
    expect(arcRpcUrls(5042, 'https://arc-slot-three.vercel.app')).toEqual([
      'https://arc-slot-three.vercel.app/rpc/arc-mainnet',
      'https://rpc.mainnet.arc.io',
    ])
    expect(arcRpcUrls(5042002, 'https://arc-slot-three.vercel.app')).toEqual([
      'https://arc-slot-three.vercel.app/rpc/arc-testnet',
      'https://rpc.testnet.arc.io',
    ])
  })

  it('outside a browser (scripts, tests) it goes straight to Arc', () => {
    expect(arcRpcUrls(5042, null)).toEqual(['https://rpc.mainnet.arc.io'])
  })

  it('Vercel forwards exactly these paths, and only to Arc (no open proxy)', () => {
    const v = JSON.parse(readFileSync('vercel.json', 'utf8')) as { rewrites?: { source: string; destination: string }[] }
    const rewrites = v.rewrites ?? []
    for (const r of Object.values(ARC_RPC)) expect(rewrites).toContainEqual({ source: r.proxy, destination: r.direct })
    for (const r of rewrites) expect(r.destination).toMatch(/^https:\/\/rpc\.(mainnet|testnet)\.arc\.io$/)
  })

  it('local dev and Arc Studio preview forward the same paths', () => {
    const vite = readFileSync('vite.config.ts', 'utf8')
    for (const r of Object.values(ARC_RPC)) {
      expect(vite).toContain(`'${r.proxy}'`)
      expect(vite).toContain(r.direct)
    }
  })
})
