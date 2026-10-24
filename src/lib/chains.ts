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
  [ARC_TESTNET_ID]: '0x34163d378498caca5cfedd06995f5cee02a14a45',
};

export function getFactoryAddress(chainId: SupportedChainId): `0x${string}` | null {
  const addr = FACTORY_ADDRESSES[chainId];
  return addr === '0x0000000000000000000000000000000000000000' ? null : addr;
}

// Format a 6-decimal USDC raw bigint to a 2-dp display string.
export function formatUsdc6(raw: bigint): string {
  const whole = raw / 1_000_000n;
  const frac = raw % 1_000_000n;
  const fracStr = frac.toString().padStart(6, '0').slice(0, 2);
  return `${whole}.${fracStr}`;
}

export function shortenAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}
