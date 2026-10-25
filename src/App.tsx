import { useCallback, useEffect, useState } from 'react'
import { ArrowDownToLine, Inbox, Link2, Send } from 'lucide-react'
import { Header } from '@/components/Header'
import { CreateRequest } from '@/components/CreateRequest'
import { VaultCard } from '@/components/VaultCard'
import { useAccount } from 'wagmi'
import { loadVault } from '@/lib/vault-store'
import { RequestCard } from '@/components/RequestCard'
import { PayPage } from '@/components/PayPage'
import { Card } from '@/components/ui'
import { type SupportedChainId, getFactoryAddress } from '@/lib/chains'
import { type Route, parseRoute } from '@/lib/links'
import { type ReceiptData, type StoredSlot, loadSlots, pickDefaultChain, saveSlots } from '@/lib/slot-logic'

function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash))
  useEffect(() => {
    const onHash = () => {
      setRoute(parseRoute(window.location.hash))
      window.scrollTo?.(0, 0)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return route
}

const defaultChain = () =>
  pickDefaultChain({ 5042: getFactoryAddress(5042), 5042002: getFactoryAddress(5042002) })

export default function App() {
  const route = useRoute()
  const [chainId, setChainId] = useState<SupportedChainId>(defaultChain)
  const [requests, setRequests] = useState<StoredSlot[]>(loadSlots)
  const { address: wallet } = useAccount()
  // This wallet's quantum-safe vault on this network: from device storage,
  // or just reported by VaultCard after create/restore.
  const vaultKey = wallet ? `${chainId}:${wallet.toLowerCase()}` : ''
  const [reportedVault, setReportedVault] = useState<{ key: string; vault: string | null } | null>(null)
  const vault =
    reportedVault?.key === vaultKey ? reportedVault.vault : wallet ? loadVault(chainId, wallet)?.vault ?? null : null
  const handleVaultChange = useCallback((v: string | null) => setReportedVault({ key: vaultKey, vault: v }), [vaultKey])

  useEffect(() => saveSlots(requests), [requests])

  const handleCreated = useCallback((req: StoredSlot) => {
    setRequests((prev) =>
      prev.some((r) => r.address === req.address && r.chainId === req.chainId) ? prev : [req, ...prev],
    )
  }, [])

  const handleSwept = useCallback((address: string, receipt: ReceiptData) => {
    setRequests((prev) => prev.map((r) => (r.address === address ? { ...r, receipt } : r)))
  }, [])

  if (route.page !== 'merchant') {
    return (
      <div className="min-h-dvh flex flex-col">
        <Header />
        <main className="flex-1 mx-auto w-full max-w-md px-4 pt-6 pb-24 sm:pt-10">
          {route.page === 'pay' ? (
            <PayPage chainId={route.chainId} slot={route.slot} amount={route.amount} label={route.label} />
          ) : (
            <Card className="text-center">
              <h1 className="display text-xl font-semibold">This payment link is not valid</h1>
              <p className="text-sm mt-2" style={{ color: 'var(--subtle)' }}>Check you copied the whole link, or ask for a new one.</p>
            </Card>
          )}
          <p className="text-xs text-center mt-6" style={{ color: 'var(--subtle)' }}>
            Payments settle in USDC on Arc. Non-custodial: funds go straight to the merchant.
          </p>
        </main>
      </div>
    )
  }

  const visible = requests.filter((r) => r.chainId === chainId)

  return (
    <div className="min-h-dvh flex flex-col">
      <Header chainId={chainId} onChainChange={setChainId} />
      <main className="flex-1 mx-auto w-full max-w-6xl px-4 pt-6 pb-24 sm:pt-10">
        <div className="grid grid-cols-1 lg:grid-cols-[440px_1fr] gap-6 lg:gap-8 items-start">
          <div className="flex flex-col gap-6">
            <CreateRequest key={vault ?? 'wallet'} chainId={chainId} vault={vault} onCreated={handleCreated} />
            <VaultCard chainId={chainId} onVaultChange={handleVaultChange} />
          </div>

          <section>
            <div className="flex items-baseline justify-between mb-4">
              <h2 className="display text-xl font-semibold">Your requests</h2>
              {visible.length > 0 && (
                <span className="text-xs" style={{ color: 'var(--subtle)' }}>Updates live</span>
              )}
            </div>
            {visible.length === 0 ? (
              <Card className="text-center">
                <Inbox className="size-7 mx-auto mb-2" style={{ color: 'var(--subtle)' }} />
                <p className="font-medium">No payment requests yet</p>
                <ol className="mt-5 grid gap-3 sm:grid-cols-3 text-left">
                  {[
                    [Link2, 'Create a link', 'Set an amount and what it’s for.'],
                    [Send, 'Customer pays', 'They open the link and pay with any wallet.'],
                    [ArrowDownToLine, 'Collect', 'Move the USDC to your wallet in one tap.'],
                  ].map(([Icon, title, text], i) => {
                    const I = Icon as typeof Link2
                    return (
                      <li key={i} className="rounded-2xl p-4" style={{ background: 'var(--surface-muted)' }}>
                        <I className="size-5 mb-2" style={{ color: 'var(--accent)' }} />
                        <p className="text-sm font-semibold">{i + 1}. {title as string}</p>
                        <p className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>{text as string}</p>
                      </li>
                    )
                  })}
                </ol>
              </Card>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                {visible.map((r) => (
                  <RequestCard key={`${r.chainId}:${r.address}`} request={r} onSwept={handleSwept} />
                ))}
              </div>
            )}
            <p className="text-xs mt-4" style={{ color: 'var(--subtle)' }}>
              Requests are remembered in this browser. Each one has its own address, so payments never mix.
            </p>
          </section>
        </div>
      </main>
    </div>
  )
}
