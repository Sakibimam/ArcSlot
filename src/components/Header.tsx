import { ConnectKitButton } from 'connectkit'
import { ARC_MAINNET_ID, ARC_TESTNET_ID, type SupportedChainId } from '@/lib/chains'

interface HeaderProps {
  /** Network selector is shown on the merchant view only; pay links fix the network. */
  chainId?: SupportedChainId
  onChainChange?: (id: SupportedChainId) => void
}

export function Header({ chainId, onChainChange }: HeaderProps) {
  return (
    <header
      className="sticky top-0 z-40 border-b"
      style={{ borderColor: 'var(--border)', background: 'rgba(13,27,47,0.85)', backdropFilter: 'blur(20px)' }}
    >
      <div className="mx-auto max-w-6xl flex items-center justify-between gap-3 px-4 py-3">
        <a href="#/" className="flex items-center gap-2 min-w-0">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl text-sm font-bold" style={{ background: 'var(--accent)', color: '#0d1b2f' }}>
            S
          </span>
          <span className="display text-lg font-semibold hidden sm:inline">Arc Slot</span>
        </a>

        <div className="flex items-center gap-2">
          <a href="#/collect" className="text-sm font-semibold px-2" style={{ color: 'var(--accent)' }}>Earn</a>
          {chainId !== undefined && onChainChange && (
            <div className="flex rounded-xl p-1 gap-1" style={{ background: 'var(--surface-muted)' }} role="group" aria-label="Network">
              {([
                [ARC_TESTNET_ID, 'Testnet'],
                [ARC_MAINNET_ID, 'Mainnet'],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  aria-pressed={chainId === id}
                  onClick={() => onChainChange(id)}
                  className="px-2.5 py-1 rounded-lg text-xs font-semibold transition-all"
                  style={chainId === id ? { background: 'var(--accent)', color: '#0d1b2f' } : { color: 'var(--subtle)' }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <ConnectKitButton showBalance={false} />
        </div>
      </div>
    </header>
  )
}
