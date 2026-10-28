/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, fallback, createConfig } from 'wagmi'
import {
  mainnet, arc, arcTestnet,
  base, arbitrum, optimism, polygon, avalanche,
  baseSepolia, sepolia, arbitrumSepolia,
} from 'viem/chains'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'
import { arcRpcUrls } from './lib/rpc'

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(arc.id, arc.rpcUrls.default.http[0])
registerChain(arcTestnet.id, arcTestnet.rpcUrls.default.http[0])

export const config = createConfig({
  // mainnet is also needed for ENS resolution; the rest are cross-chain payment sources
  chains: [arc, arcTestnet, mainnet, base, arbitrum, optimism, polygon, avalanche, baseSepolia, sepolia, arbitrumSepolia],
  connectors: [injected()],
  transports: {
    // own domain first (browser shields), Arc directly as the fallback
    [arc.id]: fallback(arcRpcUrls(arc.id).map((u) => http(u))),
    [arcTestnet.id]: fallback(arcRpcUrls(arcTestnet.id).map((u) => http(u))),
    [mainnet.id]: http(), // ENS resolution uses mainnet
    [base.id]: http(),
    [arbitrum.id]: http(),
    [optimism.id]: http(),
    [polygon.id]: http(),
    [avalanche.id]: http(),
    [baseSepolia.id]: http(),
    [sepolia.id]: http(),
    [arbitrumSepolia.id]: http(),
  },
})
