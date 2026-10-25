// Chain and contract configuration for the Slot app.
// Arc mainnet (5042) is the default; Arc testnet (5042002) is the fallback.

import { requireChain, getUsdc } from '@/onchain-facts';

export const ARC_MAINNET_ID = 5042;
export const ARC_TESTNET_ID = 5042002;

export const SUPPORTED_CHAIN_IDS = [ARC_MAINNET_ID, ARC_TESTNET_ID] as const;
export type SupportedChainId = (typeof SUPPORTED_CHAIN_IDS)[number];

export function isSupportedChain(chainId: number): chainId is SupportedChainId {
  return (SUPPORTED_CHAIN_IDS as readonly number[]).includes(chainId);
}

export function getChainMeta(chainId: SupportedChainId) {
  const chain = requireChain(chainId);
  const usdc = getUsdc(chainId)!;
  return { chain, usdc };
}

// Factory addresses: set after deploy. Zero address = not yet deployed.
// Replace these with real addresses once createSlot is deployed on each chain.
export const FACTORY_ADDRESSES: Record<SupportedChainId, `0x${string}`> = {
  [ARC_MAINNET_ID]: '0x0000000000000000000000000000000000000000', // not yet deployed
  [ARC_TESTNET_ID]: '0x4baEfAb2E5fc17b7Ff69E6263d04d1D38319EB49',
};

/** Earlier SlotFactory versions still holding live slots (newest first). Their
 *  slots keep forwarding to the payee; the pay page accepts them with a note. */
export const LEGACY_FACTORY_ADDRESSES: Record<SupportedChainId, readonly `0x${string}`[]> = {
  [ARC_MAINNET_ID]: [],
  [ARC_TESTNET_ID]: [
    '0xFe3356346e2978a4BeA738e37144Ad52F4C8b01A', // v7
    '0xCEc73Fb0a1B24C2Bd44126c7E9CAD93126A41151', // v6
    '0xaaC460901F37E2c250732D1e208e660F23D8E156', // v5
  ],
};

/** SlotVault implementation (CREATE2, same address on every chain); vaults are its EIP-1167 clones. */
export const SLOT_VAULT_IMPL = '0x192C03F98e1Bc1BbF6C50388A7D24ecFcb4280a0' as const

// Quantum-safe vault factory (SlotVault clones). Zero address = not yet deployed.
export const VAULT_FACTORY_ADDRESSES: Record<SupportedChainId, `0x${string}`> = {
  [ARC_MAINNET_ID]: '0x0000000000000000000000000000000000000000', // not yet deployed
  [ARC_TESTNET_ID]: '0x85154fE5e5F5d2e9d4f11ef3159EB5c451b1eB97',
};

export function getVaultFactoryAddress(chainId: SupportedChainId): `0x${string}` | null {
  const addr = VAULT_FACTORY_ADDRESSES[chainId];
  return addr === '0x0000000000000000000000000000000000000000' ? null : addr;
}

export function getFactoryAddress(chainId: SupportedChainId): `0x${string}` | null {
  const addr = FACTORY_ADDRESSES[chainId];
  return addr === '0x0000000000000000000000000000000000000000' ? null : addr;
}

export { formatUsdc6 } from './slot-logic'

export function shortenAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function networkName(chainId: number): string {
  return chainId === ARC_MAINNET_ID ? 'Arc Mainnet' : 'Arc Testnet'
}

/** 0x6192…E63b */
export function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export const USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as const
export const TESTNET_FAUCET_URL = 'https://faucet.circle.com'
