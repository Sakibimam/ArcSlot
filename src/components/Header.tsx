import { ConnectKitButton } from 'connectkit'
import { ARC_MAINNET_ID, ARC_TESTNET_ID, type SupportedChainId } from '@/lib/chains'

interface HeaderProps {
  chainId?: SupportedChainId
  onChainChange?: (id: SupportedChainId) => void
  /** When true, show a "Dashboard" nav link (hides on landing). */
  showNav?: boolean
}

export function Header({ chainId, onChainChange, showNav = true }: HeaderProps) {
  return (
    <header
      className="sticky top-0 z-40 bg-paper/95 backdrop-blur-sm border-b border-rule"
    >
      <div className="mx-auto max-w-[1120px] flex items-center justify-between gap-4 px-4 sm:px-6 h-14">
        {/* Wordmark */}
        <a href="#/" className="font-bold text-ink text-[15px] tracking-tight shrink-0">
          ArcSlot
        </a>

        {/* Center nav */}
        {showNav && (
          <nav className="hidden sm:flex items-center gap-1" aria-label="App navigation">
            <a
              href="#/app"
              className="px-3 py-1.5 rounded-md text-sm font-medium text-ink/70 hover:text-ink hover:bg-rule/30 transition-colors"
            >
              Dashboard
            </a>
            <a
              href="#/collect"
              className="px-3 py-1.5 rounded-md text-sm font-medium text-ink/70 hover:text-ink hover:bg-rule/30 transition-colors"
            >
              Collectors
            </a>
          </nav>
        )}

        {/* Right: network + wallet */}
        <div className="flex items-center gap-2 shrink-0">
          {chainId !== undefined && onChainChange && (
            <div
              className="flex rounded-md overflow-hidden"
              style={{ border: '1px solid var(--rule)' }}
              role="group"
              aria-label="Network"
            >
              {([
                [ARC_TESTNET_ID, 'Testnet'],
                [ARC_MAINNET_ID, 'Mainnet'],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  aria-pressed={chainId === id}
                  onClick={() => onChainChange(id)}
                  className="px-3 py-1.5 text-xs font-semibold transition-colors"
                  style={
                    chainId === id
                      ? { background: 'var(--ink)', color: '#FFFFFF' }
                      : { background: 'transparent', color: 'var(--muted-foreground)' }
                  }
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

// ── App footer (used in every app shell) ─────────────────────────────────────
export function AppFooter() {
  return (
    <footer className="border-t border-rule bg-paper mt-auto">
      <div className="mx-auto max-w-[1120px] px-4 sm:px-6 py-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-ink/40">
        <span>ArcSlot. Non-custodial USDC payments on Arc.</span>
        <div className="flex items-center gap-4">
          <a
            href="https://github.com/Sakibimam/ArcSlot"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-carbon"
          >
            Open source
          </a>
          <a
            href="https://studio.arc.io/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-carbon"
          >
            Built with Arc Studio
          </a>
        </div>
      </div>
    </footer>
  )
}
