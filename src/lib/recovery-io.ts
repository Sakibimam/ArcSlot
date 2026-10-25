// Real ChainIO for a foreign chain: reads go through wagmi's public client for
// that chain; writes and signatures go through the connected wallet.

import { getPublicClient } from 'wagmi/actions'
import { config } from '@/config'
import type { ChainIO } from './recovery-exec'

type Hex = `0x${string}`

export function chainIO(chainId: number, wallet: { write: ChainIO['write']; signMessage: ChainIO['signMessage'] }): ChainIO {
  const pc = getPublicClient(config, { chainId: chainId as never })
  if (!pc) throw new Error(`No RPC configured for chain ${chainId}`)
  return {
    getCode: (address) => pc.getCode({ address: address as Hex }),
    read: (r) => pc.readContract(r),
    write: wallet.write,
    wait: async (hash) => {
      const receipt = await pc.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') throw new Error('Transaction failed')
    },
    signMessage: wallet.signMessage,
  }
}
