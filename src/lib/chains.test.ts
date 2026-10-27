import { describe, it, expect } from 'vitest'
import { getFactoryAddress, getVaultFactoryAddress, LEGACY_FACTORY_ADDRESSES, ARC_MAINNET_ID, ARC_TESTNET_ID } from './chains'

describe('getFactoryAddress', () => {
  it('returns the deployed testnet SlotFactory (v9: the Slot implementation is locked)', () => {
    expect(getFactoryAddress(ARC_TESTNET_ID)).toBe('0x849eE5AEd72d1Ba5ADa092e0d68C4B2D161BE9c3')
  })
  it('keeps v8 links working: the previous factory is listed as legacy', () => {
    expect(LEGACY_FACTORY_ADDRESSES[ARC_TESTNET_ID]).toContain('0x4baEfAb2E5fc17b7Ff69E6263d04d1D38319EB49')
  })
  it('returns the mainnet SlotFactory (v9, same address as testnet)', () => {
    expect(getFactoryAddress(ARC_MAINNET_ID)).toBe('0x849eE5AEd72d1Ba5ADa092e0d68C4B2D161BE9c3')
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
