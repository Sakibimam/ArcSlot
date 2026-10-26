import { ConnectKitButton } from 'connectkit'
import { LogoMark } from './Logo'
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
      className="sticky top-0 z-40 bg-paper/95 backdrop-blur-sm border-b border-ink/20"
    >
      <div className="mx-auto max-w-[1120px] flex items-center justify-between gap-4 px-4 sm:px-6 h-14">
        {/* Wordmark */}
        <a href="#/" className="inline-flex items-center gap-2.5 text-ink shrink-0">
          <LogoMark className="size-9" />
          <span className="engraved text-[17px] tracking-[0.06em]" style={{ fontStretch: '125%' }}>ArcSlot</span>
        </a>

        {/* Center nav */}
        {showNav && (
          <nav className="hidden sm:flex items-center gap-1 serial text-[12px]" aria-label="App navigation">
            <a
              href="#/app"
              className="px-3 py-1.5 text-ink/75 hover:text-serial transition-colors"
            >
              Dashboard
            </a>
            <a
              href="#/collect"
              className="px-3 py-1.5 text-ink/75 hover:text-serial transition-colors"
            >
              Collectors
            </a>
          </nav>
        )}

        {/* Right: network + wallet */}
        <div className="flex items-center gap-2 shrink-0">
          {chainId !== undefined && onChainChange && (
            <div
              className="flex overflow-hidden serial"
              style={{ border: '1.5px solid var(--ink)' }}
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
                  className="px-3 py-1.5 text-[11px] font-medium transition-colors"
                  style={
                    chainId === id
                      ? { background: 'var(--ink)', color: 'var(--paper)' }
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
    <footer className="border-t border-ink/20 bg-paper mt-auto">
      <div className="mx-auto max-w-[1120px] px-4 sm:px-6 py-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 serial text-[11px] text-ink/65">
        <span>ArcSlot · Non-custodial USDC payments on Arc</span>
        <div className="flex items-center gap-4">
          <a
            href="https://github.com/Sakibimam/ArcSlot"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-serial"
          >
            Open source
          </a>
          <a
            href="https://studio.arc.io/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-serial"
          >
            Built with Arc Studio
          </a>
        </div>
      </div>
    </footer>
  )
}
