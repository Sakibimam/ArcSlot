// Help for wallets that can't (or won't) switch to Arc, and links that reopen a page inside a
// wallet's own browser — phone browsers have no wallet of their own.

const RPC: Record<number, string> = {
  5042: 'https://rpc.mainnet.arc.io',
  5042002: 'https://rpc.testnet.arc.io',
}

export function isPhantom(connector: { id?: string; name?: string } | undefined): boolean {
  return !!connector && (connector.id === 'app.phantom' || /phantom/i.test(connector.name ?? ''))
}

export function explainSwitchError(
  e: unknown,
  { network, chainId, testnet, phantom }: { network: string; chainId: number; testnet: boolean; phantom: boolean },
): string {
  const code = (e as { code?: number })?.code
  const message = e instanceof Error ? e.message : String(e)
  if (code === 4001 || /user rejected|user denied|cancel/i.test(message)) return 'You cancelled the network switch.'
  if (code === -32002 || /already pending/i.test(message)) return 'Your wallet already has a request waiting. Open your wallet to finish it.'
  if (phantom && testnet)
    return `Phantom only shows ${network} with Testnet Mode on: in Phantom open Settings → Developer Settings → Testnet Mode, turn it on, then try again.`
  if (phantom) return `Phantom couldn't switch to ${network}. Update Phantom to the latest version, then try again.`
  return `Your wallet doesn't know ${network} yet. Add it as a custom network (chain ID ${chainId}, RPC ${RPC[chainId] ?? ''}, currency USDC), then try again.`
}

export function walletAppLinks(url: string): { name: string; href: string }[] {
  const origin = new URL(url).origin
  return [
    { name: 'Phantom', href: `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(origin)}` },
    { name: 'MetaMask', href: `https://metamask.app.link/dapp/${url.replace(/^https?:\/\//, '')}` },
    { name: 'Coinbase Wallet', href: `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(url)}` },
    { name: 'Trust Wallet', href: `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(url)}` },
  ]
}

/** A wallet extension or wallet-app browser has injected itself into this page. */
export function hasBrowserWallet(win: Window): boolean {
  return !!(win as Window & { ethereum?: unknown }).ethereum
}

/** Touch-first screen: a phone or tablet, where the plain browser has no wallet of its own. */
export function isPhone(win: Window): boolean {
  return typeof win.matchMedia === 'function' && win.matchMedia('(pointer: coarse)').matches
}
