import { ARC_MAINNET_ID } from '@/lib/chains'

/** Shown wherever real USDC moves on mainnet while the contracts have no third-party audit. */
export function MainnetNote({ chainId, className = '' }: { chainId: number; className?: string }) {
  if (chainId !== ARC_MAINNET_ID) return null
  return (
    <p
      role="note"
      className={`rounded-[14px] px-4 py-3 text-sm text-ink ${className}`}
      style={{ background: 'rgba(154,91,0,0.08)', border: '1px solid rgba(154,91,0,0.22)' }}
    >
      <strong>Arc mainnet: real USDC.</strong> The contracts are tested and reviewed but unaudited by a third party. Use small amounts.
    </p>
  )
}
