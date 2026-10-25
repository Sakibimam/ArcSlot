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
  encryptedBackupText,
  openBackup,
  MIN_VAULT_PASSWORD,
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

// v8 (audit L-7): stronger key derivation, encrypted backups, longer passwords.
describe('key hardening', () => {
  const vault = '0x00000000000000000000000000000000000000aa'
  const PW = 'correct horse battery staple'

  it('new boxes record a stronger PBKDF2 work factor', async () => {
    const box = JSON.parse(await encryptSeed(SEED, PW)) as { v: number; iter: number }
    expect(box.v).toBe(2)
    expect(box.iter).toBeGreaterThanOrEqual(600_000)
  })

  it('still opens boxes written by the previous version (310k, no iter field)', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(PW), 'PBKDF2', false, ['deriveKey'])
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 310_000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt'])
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, hexToBytes(SEED.slice(2))))
    const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))
    const v1 = JSON.stringify({ v: 1, salt: b64(salt), iv: b64(iv), ct: b64(ct) })
    expect(await decryptSeed(v1, PW)).toBe(SEED)
  })

  it('backups no longer contain the seed in plain text', async () => {
    const text = encryptedBackupText({ vault, chainId: 5042002, seed: SEED, box: await encryptSeed(SEED, PW) })
    // The secret half (SK.seed || SK.prf, first 32 bytes) must never appear; the
    // public key legitimately starts with PK.seed, the seed's public last third.
    expect(text).not.toContain('5e'.repeat(32))
    expect(JSON.parse(text)).toMatchObject({ kind: 'slot-vault-backup', v: 2, vault, chainId: 5042002 })
  })

  it('opens an encrypted backup with its password, and refuses a wrong one', async () => {
    const settings = { salt: `0x${'12'.repeat(32)}`, twoKey: true, recoveryDelay: '604800' }
    const text = encryptedBackupText({ vault, chainId: 5042002, seed: SEED, box: await encryptSeed(SEED, PW), ...settings })
    expect(await openBackup(text, PW)).toEqual({ vault, chainId: 5042002, seed: SEED, ...settings })
    await expect(openBackup(text, 'nope-nope-nope')).rejects.toThrow(/password/i)
  })

  it('still restores old plain-text backups', async () => {
    const text = backupText({ vault, chainId: 5042002, seed: SEED })
    expect(await openBackup(text, 'anything')).toEqual({ vault, chainId: 5042002, seed: SEED })
  })

  it('requires vault passwords of at least 12 characters', () => {
    expect(MIN_VAULT_PASSWORD).toBeGreaterThanOrEqual(12)
  })
})
