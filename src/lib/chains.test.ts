import { describe, it, expect } from 'vitest'
import { getFactoryAddress, getVaultFactoryAddress, ARC_MAINNET_ID, ARC_TESTNET_ID } from './chains'

describe('getFactoryAddress', () => {
  it('returns the deployed testnet SlotFactory', () => {
    expect(getFactoryAddress(ARC_TESTNET_ID)).toBe('0x387eA56c76Ea72320b32C540eCf1cb74AA95474c')
  })
  it('returns null for mainnet until it is deployed', () => {
    expect(getFactoryAddress(ARC_MAINNET_ID)).toBeNull()
  })
})

describe('getVaultFactoryAddress', () => {
  it('returns the deployed testnet VaultFactory', () => {
    expect(getVaultFactoryAddress(ARC_TESTNET_ID)).toBe('0x31057DE0e8E7Dba29C34A2Ac0ED1ddfd5A74C986')
  })
  it('returns null for mainnet until it is deployed', () => {
    expect(getVaultFactoryAddress(ARC_MAINNET_ID)).toBeNull()
  })
})
