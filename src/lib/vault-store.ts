// Remembers which vault belongs to this wallet on this device, plus its
// password-encrypted PQ seed. Never stores the seed in plain text.

export interface VaultRecord {
  chainId: number
  owner: string
  vault: string
  /** encryptSeed() output */
  box: string
}

const key = (chainId: number, owner: string) => `arc-slot:vault:v1:${chainId}:${owner.toLowerCase()}`

export function saveVault(r: VaultRecord): void {
  try {
    localStorage.setItem(key(r.chainId, r.owner), JSON.stringify({ ...r, owner: r.owner.toLowerCase() }))
  } catch {
    // storage unavailable — the backup file is the source of truth
  }
}

export function loadVault(chainId: number, owner: string): VaultRecord | null {
  try {
    const raw = localStorage.getItem(key(chainId, owner))
    if (!raw) return null
    const r = JSON.parse(raw) as VaultRecord
    return typeof r.vault === 'string' && typeof r.box === 'string' ? { ...r, owner: r.owner } : null
  } catch {
    return null
  }
}

export function removeVault(chainId: number, owner: string): void {
  try {
    localStorage.removeItem(key(chainId, owner))
  } catch {
    // ignore
  }
}
