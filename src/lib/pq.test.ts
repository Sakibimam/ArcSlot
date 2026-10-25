import { describe, it, expect } from 'vitest'
import { slh_dsa_sha2_128s as slh } from '@noble/post-quantum/slh-dsa.js'
import { hexToBytes } from '@noble/hashes/utils.js'
import {
  newVaultSeed,
  vaultKeyFromSeed,
  signDigest,
  encryptSeed,
  decryptSeed,
  backupText,
  parseBackup,
} from './pq'

const SEED = `0x${'5e'.repeat(48)}` as const
const DIGEST = `0x${'ab'.repeat(32)}` as const

describe('vault key', () => {
  it('derives the same 32-byte verifying key from the same seed', () => {
    const a = vaultKeyFromSeed(SEED)
    expect(a).toMatch(/^0x[0-9a-f]{64}$/)
    expect(vaultKeyFromSeed(SEED)).toBe(a)
  })

  it('matches the key the contracts test with (scripts/pq-sign.mjs)', () => {
    // Same seed as contracts/test-integration/SlotVaultFork.t.sol
    expect(vaultKeyFromSeed(SEED).slice(0, 34)).toBe(`0x${'5e'.repeat(16)}`)
  })

  it('generates fresh random 48-byte seeds', () => {
    const a = newVaultSeed()
    expect(a).toMatch(/^0x[0-9a-f]{96}$/)
    expect(newVaultSeed()).not.toBe(a)
  })
})

describe('signDigest', () => {
  it('produces a 7856-byte SLH-DSA signature that verifies', () => {
    const sig = signDigest(SEED, DIGEST)
    expect((sig.length - 2) / 2).toBe(7856)
    const vk = hexToBytes(vaultKeyFromSeed(SEED).slice(2))
    expect(slh.verify(hexToBytes(sig.slice(2)), hexToBytes(DIGEST.slice(2)), vk)).toBe(true)
  })

  it('rejects anything that is not a 32-byte digest', () => {
    expect(() => signDigest(SEED, '0x1234')).toThrow(/32-byte/)
  })
}, 30_000)

describe('seed encryption at rest', () => {
  it('round-trips with the right password', async () => {
    const box = await encryptSeed(SEED, 'correct horse battery')
    expect(box).not.toContain('5e5e5e')
    expect(await decryptSeed(box, 'correct horse battery')).toBe(SEED)
  })

  it('fails with the wrong password', async () => {
    const box = await encryptSeed(SEED, 'correct horse battery')
    await expect(decryptSeed(box, 'wrong')).rejects.toThrow(/password/i)
  })

  it('uses a fresh salt and IV each time', async () => {
    const a = await encryptSeed(SEED, 'pw-123456')
    const b = await encryptSeed(SEED, 'pw-123456')
    expect(a).not.toBe(b)
  })
})

describe('backup', () => {
  const vault = '0x00000000000000000000000000000000000000aa'

  it('round-trips the vault, chain and seed', () => {
    const text = backupText({ vault, chainId: 5042002, seed: SEED })
    expect(parseBackup(text)).toEqual({ vault, chainId: 5042002, seed: SEED })
  })

  it('keeps the vault creation settings needed to recreate it on another chain', () => {
    const settings = { salt: `0x${'12'.repeat(32)}`, twoKey: true, recoveryDelay: '604800' }
    const text = backupText({ vault, chainId: 5042002, seed: SEED, ...settings })
    expect(parseBackup(text)).toEqual({ vault, chainId: 5042002, seed: SEED, ...settings })
  })

  it('rejects a backup whose seed does not match its key fingerprint', () => {
    const text = backupText({ vault, chainId: 5042002, seed: SEED }).replace('5e5e', '5e5f')
    expect(() => parseBackup(text)).toThrow(/does not match/i)
  })

  it('rejects garbage', () => {
    expect(() => parseBackup('hello')).toThrow()
  })
})
