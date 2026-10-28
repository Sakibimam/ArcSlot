import { useCallback, useEffect, useState } from 'react'
import { Link2, Send, ArrowDownToLine } from 'lucide-react'
import { Header, AppFooter } from '@/components/Header'
import { CreateRequest } from '@/components/CreateRequest'
import { VaultCard } from '@/components/VaultCard'
import { LandingPage } from '@/components/LandingPage'
import { DocsPage } from '@/components/DocsPage'
import { StatsPage } from '@/components/StatsPage'
import { useAccount } from 'wagmi'
import { loadVault } from '@/lib/vault-store'
import { useChainRequests } from '@/lib/use-chain-requests'
import { RequestCard } from '@/components/RequestCard'
import { PayPage } from '@/components/PayPage'
import { Leaderboard } from '@/components/Leaderboard'
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

const NETWORK_KEY = 'arcslot:network'
const rememberedChain = () => { try { return Number(localStorage.getItem(NETWORK_KEY)) || undefined } catch { return undefined } }
const defaultChain = () =>
  pickDefaultChain({ 5042: getFactoryAddress(5042), 5042002: getFactoryAddress(5042002) }, rememberedChain())

export default function App() {
  const route = useRoute()
  const [chainId, setChainIdState] = useState<SupportedChainId>(defaultChain)
  const setChainId = useCallback((id: SupportedChainId) => {
    setChainIdState(id)
    try { localStorage.setItem(NETWORK_KEY, String(id)) } catch { /* private mode: just don't remember */ }
  }, [])
  const [requests, setRequests] = useState<StoredSlot[]>(loadSlots)
  const { address: wallet } = useAccount()
  const vaultKey = wallet ? `${chainId}:${wallet.toLowerCase()}` : ''
  const [reportedVault, setReportedVault] = useState<{ key: string; vault: string | null } | null>(null)
  const vault =
    reportedVault?.key === vaultKey
      ? reportedVault.vault
      : wallet ? loadVault(chainId, wallet)?.vault ?? null : null
  const chainRequests = useChainRequests(chainId, wallet)
  const handleVaultChange = useCallback(
    (v: string | null) => setReportedVault({ key: vaultKey, vault: v }),
    [vaultKey],
  )

  useEffect(() => saveSlots(requests), [requests])

  const handleCreated = useCallback((req: StoredSlot) => {
    setRequests((prev) =>
      prev.some((r) => r.address === req.address && r.chainId === req.chainId)
        ? prev
        : [req, ...prev],
    )
  }, [])

  const handleSwept = useCallback((address: string, receipt: ReceiptData) => {
    setRequests((prev) => prev.map((r) => (r.address === address ? { ...r, receipt } : r)))
  }, [])

  // ── Landing page ────────────────────────────────────────────────────────────
  if (route.page === 'landing') {
    return <LandingPage />
  }

  // ── Docs ────────────────────────────────────────────────────────────────────
  if (route.page === 'docs') {
    return <DocsPage section={route.section} />
  }

  if (route.page === 'stats') {
    return <StatsPage />
  }

  // ── Collectors page ─────────────────────────────────────────────────────────
  if (route.page === 'collectors') {
    return (
      <div className="min-h-dvh flex flex-col bg-paper">
        <Header chainId={chainId} onChainChange={setChainId} />
        <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-8 pb-16 sm:pt-12">
          <Leaderboard chainId={chainId} />
        </main>
        <AppFooter />
      </div>
    )
  }

  // ── Pay page / invalid link ─────────────────────────────────────────────────
  if (route.page !== 'merchant') {
    return (
      <div className="min-h-dvh flex flex-col bg-paper">
        <Header showNav={false} />
        <main className="flex-1 mx-auto w-full max-w-md px-4 pt-8 pb-16 sm:pt-12">
          {route.page === 'pay' ? (
            <PayPage
              // A fresh page per link: otherwise a payment made on one link
              // ("Payment sent", PAID) carries over to the next one opened.
              key={`${route.chainId}:${route.slot}`}
              chainId={route.chainId}
              slot={route.slot}
              amount={route.amount}
              label={route.label}
            />
          ) : (
            <Card className="text-center">
              <h1 className="text-xl font-semibold text-ink">This payment link is not valid</h1>
              <p className="text-sm mt-2 text-ink/80">
                Check you copied the whole link, or ask for a new one.
              </p>
            </Card>
          )}
          <p className="text-xs text-center mt-6 text-ink/80">
            Payments settle in USDC on Arc. Non-custodial: funds go straight to the merchant.
          </p>
        </main>
        <AppFooter />
      </div>
    )
  }

  // ── Merchant dashboard (#/app) ──────────────────────────────────────────────
  const visible = mergeRequests(
    requests.filter((r) => r.chainId === chainId),
    chainRequests,
  )

  return (
    <div className="min-h-dvh flex flex-col bg-paper">
      <Header chainId={chainId} onChainChange={setChainId} />

      <main className="flex-1 mx-auto w-full max-w-[1120px] px-4 sm:px-6 pt-8 pb-16 sm:pt-12">
        <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-6 lg:gap-10 items-start">

          {/* Left column: create + vault */}
          <div className="flex flex-col gap-6">
            <CreateRequest
              key={vault ?? 'wallet'}
              chainId={chainId}
              vault={vault}
              onCreated={handleCreated}
            />
            <VaultCard chainId={chainId} onVaultChange={handleVaultChange} />
          </div>

          {/* Right column: request list */}
          <section>
            <div className="flex items-baseline justify-between mb-5">
              <h2 className="heading-tight text-[22px] text-ink">Payment links</h2>
              {visible.length > 0 && (
                <span className="serial text-[10.5px] text-ink/80">Updates live</span>
              )}
            </div>

            {visible.length === 0 ? (
              <Card>
                <p className="font-semibold text-ink mb-1">No payment links yet.</p>
                <p className="text-sm text-ink/80 mb-6">Make your first one.</p>
                <ol className="grid gap-3 sm:grid-cols-3 text-left">
                  {[
                    [Link2,           'Create a link',   "Set an amount and what it's for."],
                    [Send,            'Customer pays',   'They open the link and pay from any wallet.'],
                    [ArrowDownToLine, 'Collect',         'Move the USDC to your wallet in one tap.'],
                  ].map(([Icon, title, text], i) => {
                    const I = Icon as typeof Link2
                    return (
                      <li
                        key={i}
                        className="rounded-[14px] p-4 bg-paper"
                        style={{ border: '1px solid rgba(11,42,33,0.10)' }}
                      >
                        <I className="size-5 mb-2 text-carbon" />
                        <p className="text-sm font-semibold text-ink">{i + 1}. {title as string}</p>
                        <p className="text-xs mt-1 text-ink/80">{text as string}</p>
                      </li>
                    )
                  })}
                </ol>
              </Card>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                {visible.map((r) => (
                  <RequestCard
                    key={`${r.chainId}:${r.address}`}
                    request={r}
                    onSwept={handleSwept}
                  />
                ))}
              </div>
            )}

            <p className="text-xs mt-4 text-ink/80">
              Links are remembered in this browser. Each has its own address so payments never mix.
            </p>
          </section>
        </div>
      </main>

      <AppFooter />
    </div>
  )
}

/** Local requests (with receipts) plus ones found on-chain from other devices, newest first. */
function mergeRequests(local: StoredSlot[], chain: StoredSlot[]): StoredSlot[] {
  const byAddr = new Map<string, StoredSlot>()
  for (const r of local) byAddr.set(r.address.toLowerCase(), r)
  for (const c of chain) {
    const key = c.address.toLowerCase()
    const l = byAddr.get(key)
    byAddr.set(
      key,
      l
        ? { ...c, ...l, label: l.label ?? c.label, amount: l.amount ?? c.amount, onchain: true }
        : { ...c, onchain: true },
    )
  }
  return [...byAddr.values()].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
}
