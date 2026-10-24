import { describe, it, expect } from 'vitest'
import { getFactoryAddress, ARC_MAINNET_ID, ARC_TESTNET_ID } from './chains'

describe('getFactoryAddress', () => {
  it('returns the deployed testnet SlotFactory', () => {
    expect(getFactoryAddress(ARC_TESTNET_ID)).toBe('0x387eA56c76Ea72320b32C540eCf1cb74AA95474c')
  })
  it('returns null for mainnet until it is deployed', () => {
    expect(getFactoryAddress(ARC_MAINNET_ID)).toBeNull()
  })
})
