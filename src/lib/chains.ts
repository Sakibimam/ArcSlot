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
  [ARC_TESTNET_ID]: '0x05104Dfe747f820097A8A6C46f7c282Ef9c6d7F9',
};

// Quantum-safe vault factory (SlotVault clones). Zero address = not yet deployed.
export const VAULT_FACTORY_ADDRESSES: Record<SupportedChainId, `0x${string}`> = {
  [ARC_MAINNET_ID]: '0x0000000000000000000000000000000000000000', // not yet deployed
  [ARC_TESTNET_ID]: '0x31057DE0e8E7Dba29C34A2Ac0ED1ddfd5A74C986',
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
