import { useCallback, useEffect, useState } from 'react'
import { Header, AppFooter } from '@/components/Header'
import { Button } from '@/components/ui'
import { ARC_MAINNET_ID, ARC_TESTNET_ID, getFactoryAddress } from '@/lib/chains'
import { formatUsdc6 } from '@/lib/slot-logic'
import { type NetworkStats, loadNetworkStats } from '@/lib/stats'

type Loader = (chainId: number) => Promise<NetworkStats>

const loadLive: Loader = async (chainId) => {
  const factory = getFactoryAddress(chainId as typeof ARC_MAINNET_ID)
  if (!factory) throw new Error('not deployed')
  // loaded on demand, so importing this page never builds the wallet config (and tests can mock wagmi)
  const [{ getPublicClient }, { config }] = await Promise.all([import('wagmi/actions'), import('@/config')])
  const client = getPublicClient(config, { chainId: chainId as never })
  return loadNetworkStats(client as never, factory)
}

const NETWORKS = [
  { id: ARC_MAINNET_ID, name: 'Arc Mainnet', note: 'Real USDC', explorer: 'https://explorer.arc.io/address/' },
  { id: ARC_TESTNET_ID, name: 'Arc Testnet', note: 'Test money (free test USDC), shown for transparency', explorer: 'https://explorer.testnet.arc.io/address/' },
] as const

function Figure({ id, label, value }: { id: string; label: string; value: string }) {
  return (
    <div>
      <p className="serial text-[11px] text-ink/80">{label}</p>
      <p data-testid={id} className="mt-1 text-[28px] font-semibold leading-none text-ink tabular">{value}</p>
    </div>
  )
}

function NetworkCard({ net, load, primary }: { net: (typeof NETWORKS)[number]; load: Loader; primary: boolean }) {
  const [state, setState] = useState<{ stats?: NetworkStats; error?: boolean }>({})
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    load(net.id).then(
      (stats) => { if (live) setState({ stats }) },
      () => { if (live) setState({ error: true }) },
    )
    return () => { live = false }
  }, [load, net.id, attempt])
  const fetchStats = useCallback(() => { setState({}); setAttempt((a) => a + 1) }, [])
  const factory = getFactoryAddress(net.id)
  const s = state.stats
  return (
    <section
      aria-label={net.name}
      className="rounded-[20px] bg-surface p-6 sm:p-8"
      style={{ border: `1px solid ${primary ? 'rgba(30,122,76,0.35)' : 'rgba(11,42,33,0.12)'}`, boxShadow: primary ? '0 30px 60px -30px rgba(11,42,33,0.3)' : undefined }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="heading-tight text-[22px] text-ink">{net.name}</h2>
        <p className="serial text-[11px]" style={{ color: primary ? '#17643E' : '#7A4700' }}>{net.note}</p>
      </div>
      {state.error ? (
        <div className="mt-6">
          <p className="text-sm text-ink">Can&apos;t reach Arc right now, so no numbers are shown rather than wrong ones.</p>
          <Button variant="secondary" className="mt-3" onClick={fetchStats}>Try again</Button>
        </div>
      ) : !s ? (
        <p className="mt-6 text-sm text-ink/80">Reading from the chain…</p>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-6 sm:grid-cols-4">
          <Figure id="received" label="USDC received" value={formatUsdc6(s.received)} />
          <Figure id="requests" label="Payment requests" value={String(s.requests)} />
          <Figure id="paid" label="Paid" value={String(s.paid)} />
          <Figure id="largest" label="Largest payment" value={formatUsdc6(s.largest)} />
        </div>
      )}
      {factory && (
        <a href={`${net.explorer}${factory}`} target="_blank" rel="noopener noreferrer" className="mt-6 inline-block text-sm text-ink underline underline-offset-2 hover:text-serial">
          Verify on {new URL(net.explorer).host}
        </a>
      )}
    </section>
  )
}

export function StatsPage({ load = loadLive }: { load?: Loader }) {
  return (
    <div className="min-h-dvh flex flex-col bg-paper">
      <Header />
      <main className="flex-1 mx-auto w-full max-w-3xl px-4 pt-10 pb-16 sm:pt-14 space-y-6">
        <div>
          <p className="serial text-[12px] text-serial">Live from the chain</p>
          <h1 className="heading-tight mt-3 text-ink" style={{ fontSize: 'clamp(32px,4vw,48px)' }}>ArcSlot stats</h1>
          <p className="mt-3 max-w-[60ch] text-[16px] leading-relaxed text-ink/80">
            Every number is read directly from the ArcSlot contracts. Nothing is self-reported: follow the link under each network to check it yourself.
          </p>
        </div>
        {NETWORKS.map((net, i) => <NetworkCard key={net.id} net={net} load={load} primary={i === 0} />)}
        <p className="text-xs text-ink/80">Counts the current contracts (v9). USDC received includes payments not yet collected by the merchant.</p>
      </main>
      <AppFooter />
    </div>
  )
}
