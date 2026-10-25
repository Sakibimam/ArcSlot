import { describe, it, expect } from 'vitest'
import { saveVault, loadVault, removeVault } from './vault-store'

const OWNER = '0x1111111111111111111111111111111111111111'
const rec = { chainId: 5042002, owner: OWNER, vault: '0x00000000000000000000000000000000000000aa', box: '{"v":1}' }

describe('vault store', () => {
  it('saves and loads per chain and owner (case-insensitive)', () => {
    saveVault(rec)
    expect(loadVault(5042002, OWNER.toUpperCase().replace('0X', '0x'))).toEqual(rec)
    expect(loadVault(5042, OWNER)).toBeNull()
    expect(loadVault(5042002, '0x2222222222222222222222222222222222222222')).toBeNull()
  })
  it('removes', () => {
    saveVault(rec)
    removeVault(5042002, OWNER)
    expect(loadVault(5042002, OWNER)).toBeNull()
  })
  it('survives corrupt storage', () => {
    localStorage.setItem(`arc-slot:vault:v1:5042002:${OWNER}`, '{nope')
    expect(loadVault(5042002, OWNER)).toBeNull()
  })
})
