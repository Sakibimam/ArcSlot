import { ConnectKitButton } from 'connectkit'
import { hasBrowserWallet, walletAppLinks } from '@/lib/wallet-help'

/** Links that reopen this exact page inside a wallet app's own browser, where connecting works. */
export function WalletAppLinks({ className = '' }: { className?: string }) {
  return (
    <div className={`grid grid-cols-2 gap-2 ${className}`}>
      {walletAppLinks(window.location.href).map((l) => (
        <a
          key={l.name}
          href={l.href}
          aria-label={`Open in ${l.name}`}
          className="inline-flex min-h-11 items-center justify-center rounded-full border border-ink/20 bg-white px-3 text-center text-sm font-semibold text-ink hover:bg-ink/[0.05]"
        >
          {l.name}
        </a>
      ))}
    </div>
  )
}

/** ConnectKit's button, plus wallet-app links when the browser has no wallet (a phone's Safari or Chrome). */
export function ConnectWallet() {
  const noWallet = typeof window !== 'undefined' && !hasBrowserWallet(window)
  return (
    <div className="space-y-3">
      <div className="flex justify-center">
        <ConnectKitButton />
      </div>
      {noWallet && (
        <div className="pt-1 space-y-2">
          <p className="text-xs text-ink/80">On a phone? Open this page in your wallet app:</p>
          <WalletAppLinks className="mx-auto max-w-[340px]" />
        </div>
      )}
    </div>
  )
}
