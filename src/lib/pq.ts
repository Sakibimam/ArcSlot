// Post-quantum vault keys: SLH-DSA-SHA2-128s (FIPS 205), the scheme Arc's
// PQ precompile (0x1800..0004) verifies. Keys never leave the browser; the
// seed is stored only encrypted with the user's password.

import { slh_dsa_sha2_128s as slh } from '@noble/post-quantum/slh-dsa.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

type Hex = `0x${string}`

const SEED_BYTES = 48
const PBKDF2_ITERATIONS = 310_000

const strip = (h: string) => h.replace(/^0x/, '')

export function newVaultSeed(): Hex {
  return `0x${bytesToHex(crypto.getRandomValues(new Uint8Array(SEED_BYTES)))}`
}

/** The 32-byte verifying key stored on-chain as the vault's pqKey. */
export function vaultKeyFromSeed(seed: Hex): Hex {
  return `0x${bytesToHex(slh.keygen(hexToBytes(strip(seed))).publicKey)}`
}

/** Sign a 32-byte vault digest. Takes about a second; SLH-DSA is slow by design. */
export function signDigest(seed: Hex, digest: string): Hex {
  const msg = hexToBytes(strip(digest))
  if (msg.length !== 32) throw new Error('Expected a 32-byte digest')
  const { secretKey } = slh.keygen(hexToBytes(strip(seed)))
  return `0x${bytesToHex(slh.sign(msg, secretKey))}`
}

// ─── Encryption at rest ──────────────────────────────────────────────────────

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

async function aesKey(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptSeed(seed: Hex, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(password, salt), hexToBytes(strip(seed)))
  return JSON.stringify({ v: 1, salt: b64(salt), iv: b64(iv), ct: b64(new Uint8Array(ct)) })
}

export async function decryptSeed(box: string, password: string): Promise<Hex> {
  const { salt, iv, ct } = JSON.parse(box) as { salt: string; iv: string; ct: string }
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await aesKey(password, unb64(salt)), unb64(ct))
    return `0x${bytesToHex(new Uint8Array(pt))}`
  } catch {
    throw new Error('Wrong password')
  }
}

// ─── Backup ──────────────────────────────────────────────────────────────────

export interface VaultBackup {
  vault: string
  chainId: number
  seed: Hex
  /** Creation settings, so the vault can be recreated at the same address on another chain. */
  salt?: string
  twoKey?: boolean
  recoveryDelay?: string
}

export function backupText(b: VaultBackup): string {
  return JSON.stringify(
    {
      kind: 'slot-vault-backup', v: 1, vault: b.vault, chainId: b.chainId, key: vaultKeyFromSeed(b.seed), seed: b.seed,
      ...(b.salt ? { salt: b.salt, twoKey: b.twoKey, recoveryDelay: b.recoveryDelay } : {}),
    },
    null,
    2,
  )
}

export function parseBackup(text: string): VaultBackup {
  const j = JSON.parse(text) as Partial<{ kind: string; vault: string; chainId: number; key: string; seed: string; salt: string; twoKey: boolean; recoveryDelay: string }>
  if (j.kind !== 'slot-vault-backup' || !j.vault || !j.chainId || !j.seed || !j.key) {
    throw new Error('Not a Slot vault backup')
  }
  if (!/^0x[0-9a-f]{96}$/i.test(j.seed)) throw new Error('Backup seed is malformed')
  const seed = j.seed.toLowerCase() as Hex
  if (vaultKeyFromSeed(seed) !== j.key.toLowerCase()) throw new Error('Backup key does not match its seed')
  const settings = j.salt ? { salt: j.salt, twoKey: j.twoKey, recoveryDelay: j.recoveryDelay } : {}
  return { vault: j.vault, chainId: j.chainId, seed, ...settings }
}
