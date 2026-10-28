// Arc RPC endpoints. In the browser the app reads Arc through its own domain first (/rpc/…, forwarded to
// Arc by vercel.json and by the Vite dev server), because some browser shields (e.g. Brave) block requests
// to third-party RPC hosts. If that path fails, viem's fallback transport calls Arc directly.
export const ARC_RPC = {
  5042: { proxy: '/rpc/arc-mainnet', direct: 'https://rpc.mainnet.arc.io' },
  5042002: { proxy: '/rpc/arc-testnet', direct: 'https://rpc.testnet.arc.io' },
} as const

export function arcRpcUrls(
  chainId: keyof typeof ARC_RPC,
  /** the page's origin; null = not in a browser */
  origin: string | null = typeof window !== 'undefined' ? window.location.origin : null,
): string[] {
  const r = ARC_RPC[chainId]
  return origin && /^https?:\/\//.test(origin) ? [`${origin}${r.proxy}`, r.direct] : [r.direct]
}
