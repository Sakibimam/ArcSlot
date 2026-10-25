import { describe, it, expect } from 'vitest'
import { getFactoryAddress, getVaultFactoryAddress, ARC_MAINNET_ID, ARC_TESTNET_ID } from './chains'

describe('getFactoryAddress', () => {
  it('returns the deployed testnet SlotFactory', () => {
    expect(getFactoryAddress(ARC_TESTNET_ID)).toBe('0xaaC460901F37E2c250732D1e208e660F23D8E156')
  })
  it('returns null for mainnet until it is deployed', () => {
    expect(getFactoryAddress(ARC_MAINNET_ID)).toBeNull()
  })
})

describe('getVaultFactoryAddress', () => {
  it('returns the deployed testnet VaultFactory', () => {
    expect(getVaultFactoryAddress(ARC_TESTNET_ID)).toBe('0x85154fE5e5F5d2e9d4f11ef3159EB5c451b1eB97')
  })
  it('returns null for mainnet until it is deployed', () => {
    expect(getVaultFactoryAddress(ARC_MAINNET_ID)).toBeNull()
  })
})
