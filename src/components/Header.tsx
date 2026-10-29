import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ConnectKitButton } from 'connectkit'
import { LogoMark } from './Logo'
import { WalletAppLinks } from './OpenInWallet'
import { hasBrowserWallet, isPhone } from '@/lib/wallet-help'
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
      <div className="mx-auto max-w-[1120px] flex items-center justify-between gap-2 sm:gap-4 px-4 sm:px-6 h-14">
        {/* Wordmark */}
        <a href="#/" className="inline-flex items-center gap-2.5 text-ink shrink-0">
          <LogoMark className="size-9" />
          <span className="sr-only sm:not-sr-only engraved text-[17px] tracking-[0.06em]" style={{ fontStretch: '125%' }}>ArcSlot</span>
        </a>

        {/* Center nav */}
        {showNav && (
          <nav className="hidden sm:flex items-center gap-1 serial text-[12px]" aria-label="App navigation">
            <a
              href="#/app"
              className="px-3 py-1.5 rounded-full text-ink/75 hover:text-ink hover:bg-ink/[0.07] transition-colors"
            >
              Dashboard
            </a>
            <a
              href="#/collect"
              className="px-3 py-1.5 rounded-full text-ink/75 hover:text-ink hover:bg-ink/[0.07] transition-colors"
            >
              Collectors
            </a>
            <a
              href="#/docs"
              className="px-3 py-1.5 rounded-full text-ink/75 hover:text-ink hover:bg-ink/[0.07] transition-colors"
            >
              Docs
            </a>
          </nav>
        )}

        {/* Right: network + wallet */}
        <div className="flex items-center gap-2 shrink-0">
          {chainId !== undefined && onChainChange && <NetworkChip chainId={chainId} onChange={onChainChange} />}
          <HeaderWallet />
        </div>
      </div>
    </header>
  )
}

// ── Wallet button ───────────────────────────────────────────────────────────
// A phone's own browser has no wallet, so ConnectKit could only offer an empty "Browser" option.
// There, Connect opens a sheet that reopens this page inside a wallet app instead.
function HeaderWallet() {
  const [phoneNoWallet] = useState(() => typeof window !== 'undefined' && isPhone(window) && !hasBrowserWallet(window))
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  if (!phoneNoWallet) return <ConnectKitButton showBalance={false} />
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-10 rounded-full bg-ink px-4 text-[14px] font-semibold text-paper hover:bg-[#1C4A3C]"
      >
        Connect Wallet
      </button>
      {open && createPortal(
        <div className="fixed inset-0 z-50 flex items-end bg-ink/40" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="wallet-sheet-title"
            className="w-full rounded-t-[22px] bg-white px-5 pt-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-ink shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <h2 id="wallet-sheet-title" className="text-lg font-semibold leading-tight">Open ArcSlot in your wallet app</h2>
              <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="-mr-1 -mt-1 grid size-9 place-items-center rounded-full text-ink/80 hover:bg-ink/[0.07]">
                <span aria-hidden="true" className="text-2xl leading-none">×</span>
              </button>
            </div>
            <p className="mt-2 text-sm text-ink/80">
              Your phone&rsquo;s browser can&rsquo;t see the wallet app. Pick your wallet: it opens this page inside the app, ready to connect.
            </p>
            <WalletAppLinks className="mt-4" />
            <p className="mt-4 text-xs text-ink/80">No wallet yet? Install one of these from your app store, then come back to this link.</p>
          </div>
        </div>,
        document.body, // the header's backdrop blur would trap a fixed sheet inside it
      )}
    </>
  )
}

// ── App footer (used in every app shell) ─────────────────────────────────────
export function AppFooter() {
  return (
    <footer className="border-t border-ink/20 bg-paper mt-auto">
      <div className="mx-auto max-w-[1120px] px-4 sm:px-6 py-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 serial text-[11px] text-ink/80">
        <span>ArcSlot · Non-custodial USDC payments on Arc</span>
        <div className="flex items-center gap-4">
          <a href="#/docs" className="underline underline-offset-2 hover:text-serial">
            Docs
          </a>
          <a href="#/stats" className="underline underline-offset-2 hover:text-serial">
            Stats
          </a>
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

const NETWORKS = [
  { id: ARC_MAINNET_ID, name: 'Arc Mainnet', detail: 'Real USDC' },
  { id: ARC_TESTNET_ID, name: 'Arc Testnet', detail: 'Free test USDC to try it out' },
] as const

function NetworkChip({ chainId, onChange }: { chainId: number; onChange: (id: SupportedChainId) => void }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown) }
  }, [open])
  const current = NETWORKS.find((n) => n.id === chainId) ?? NETWORKS[0]
  const test = current.id === ARC_TESTNET_ID
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Network: ${current.name}`}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full px-3 py-1.5 text-[12px] font-semibold"
        style={test
          ? { background: 'rgba(154,91,0,0.1)', border: '1px solid rgba(154,91,0,0.3)', color: '#7A4700' }
          : { background: 'rgba(30,122,76,0.08)', border: '1px solid rgba(30,122,76,0.28)', color: 'var(--ink)' }}
      >
        <span aria-hidden="true" className="size-2 rounded-full" style={{ background: test ? '#B26A00' : '#1E7A4C' }} />
        <span className="hidden sm:inline">{current.name}</span>
        <span className="sm:hidden">{test ? 'Testnet' : 'Mainnet'}</span>
        <span aria-hidden="true" className="text-[10px]">▾</span>
      </button>
      {open && (
        <div role="menu" aria-label="Choose network" className="absolute right-0 top-full z-50 mt-2 w-64 rounded-[14px] bg-surface p-1.5 shadow-[0_20px_40px_-12px_rgba(11,42,33,0.35)]" style={{ border: '1px solid rgba(11,42,33,0.12)' }}>
          {NETWORKS.map((n) => (
            <button
              key={n.id}
              type="button"
              role="menuitemradio"
              aria-checked={n.id === chainId}
              onClick={() => { onChange(n.id); setOpen(false) }}
              className="flex w-full items-start gap-2.5 rounded-[10px] px-3 py-2.5 text-left hover:bg-ink/[0.05]"
              style={n.id === chainId ? { background: 'rgba(11,42,33,0.06)' } : undefined}
            >
              <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: n.id === ARC_TESTNET_ID ? '#B26A00' : '#1E7A4C' }} />
              <span>
                <span className="block text-[14px] font-semibold text-ink">{n.name}</span>
                <span className="block text-[12px] text-ink/80">{n.detail}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
