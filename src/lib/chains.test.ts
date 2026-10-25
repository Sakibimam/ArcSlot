import { describe, it, expect } from 'vitest'
import { getFactoryAddress, getVaultFactoryAddress, ARC_MAINNET_ID, ARC_TESTNET_ID } from './chains'

describe('getFactoryAddress', () => {
  it('returns the deployed testnet SlotFactory', () => {
    expect(getFactoryAddress(ARC_TESTNET_ID)).toBe('0x9A8aa8de71f26611695cD419174C3a972D317aB3')
  })
  it('returns null for mainnet until it is deployed', () => {
    expect(getFactoryAddress(ARC_MAINNET_ID)).toBeNull()
  })
})

describe('getVaultFactoryAddress', () => {
  it('returns the deployed testnet VaultFactory', () => {
    expect(getVaultFactoryAddress(ARC_TESTNET_ID)).toBe('0x16cFCACE90Be16C52F1243746626Afd3878Aeb22')
  })
  it('returns null for mainnet until it is deployed', () => {
    expect(getVaultFactoryAddress(ARC_MAINNET_ID)).toBeNull()
  })
})
