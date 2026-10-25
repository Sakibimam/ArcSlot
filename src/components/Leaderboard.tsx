import { useAccount, useReadContracts } from 'wagmi'
import { Bot, Trophy } from 'lucide-react'
import { SLOT_FACTORY_ABI } from '@/lib/abis'
import { type SupportedChainId, getFactoryAddress, networkName, shortAddr } from '@/lib/chains'
import { formatUsdc6 } from '@/lib/slot-logic'
import { Card, CopyButton } from './ui'

interface Row { collector: string; collections: bigint; delivered: bigint }

const RUN = 'COLLECTOR_PRIVATE_KEY=0x… bun run collect'
const REPO = 'https://github.com/Sakibimam/ArcSlot/blob/main/scripts/collector.ts'

/** Public leaderboard of people who collect paid requests, read from the factory. */
export function Leaderboard({ chainId }: { chainId: SupportedChainId }) {
  const { address: wallet } = useAccount()
  const factory = getFactoryAddress(chainId)
  const { data } = useReadContracts({
    contracts: factory
      ? [
          { address: factory, abi: SLOT_FACTORY_ABI, functionName: 'totalCollections', chainId },
          { address: factory, abi: SLOT_FACTORY_ABI, functionName: 'totalDelivered', chainId },
          { address: factory, abi: SLOT_FACTORY_ABI, functionName: 'collectorsPage', args: [0n, 500n], chainId },
        ]
      : [],
    query: { enabled: !!factory, refetchInterval: 15_000 },
  })
  const totalCollections = (data?.[0]?.result) ?? 0n
  const totalDelivered = (data?.[1]?.result) ?? 0n
  const page = data?.[2]?.result as readonly [readonly string[], readonly { collections: bigint; delivered: bigint }[]] | undefined
  const rows: Row[] = (page?.[0] ?? [])
    .map((collector, i) => ({ collector, collections: page![1][i].collections, delivered: page![1][i].delivered }))
    .sort((a, b) =>
      a.collections !== b.collections ? (b.collections > a.collections ? 1 : -1)
        : b.delivered > a.delivered ? 1 : b.delivered < a.delivered ? -1 : 0)

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex items-center gap-2">
          <Trophy className="size-5" style={{ color: 'var(--accent)' }} />
          <h1 className="display text-2xl font-semibold">Collectors</h1>
        </div>
        <p className="text-sm mt-2" style={{ color: 'var(--subtle)' }}>
          Anyone can collect a paid request and send it to the merchant. Collectors earn the USDC gas refund plus a tip,
          so merchants get paid without lifting a finger. Live on {networkName(chainId)}.
        </p>
        <div className="grid grid-cols-2 gap-3 mt-5">
          <div className="rounded-2xl p-4" style={{ background: 'var(--surface-muted)' }}>
            <p className="text-xs" style={{ color: 'var(--subtle)' }}>Collections</p>
            <p data-testid="total-collections" className="display text-2xl font-bold tabular-nums">{totalCollections.toString()}</p>
          </div>
          <div className="rounded-2xl p-4" style={{ background: 'var(--surface-muted)' }}>
            <p className="text-xs" style={{ color: 'var(--subtle)' }}>Delivered to merchants</p>
            <p data-testid="total-delivered" className="display text-2xl font-bold tabular-nums">{formatUsdc6(totalDelivered)} USDC</p>
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="display text-lg font-semibold mb-3">Leaderboard</h2>
        {rows.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--subtle)' }}>No collectors yet. Run the bot below and be first.</p>
        ) : (
          <ol className="space-y-2">
            {rows.map((r, i) => {
              const me = wallet && r.collector.toLowerCase() === wallet.toLowerCase()
              return (
                <li
                  key={r.collector}
                  data-testid="collector-row"
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm"
                  style={{ background: me ? 'rgba(172,198,233,0.12)' : 'var(--surface-muted)' }}
                >
                  <span data-testid="rank" className="display w-6 text-right font-bold tabular-nums" style={{ color: 'var(--subtle)' }}>{i + 1}</span>
                  <span className="mono flex-1 truncate">{shortAddr(r.collector)}</span>
                  {me && <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ color: 'var(--accent)', background: 'rgba(172,198,233,0.14)' }}>You</span>}
                  <span className="tabular-nums">{r.collections.toString()}×</span>
                  <span className="tabular-nums w-28 text-right" style={{ color: 'var(--muted)' }}>{formatUsdc6(r.delivered)} USDC</span>
                </li>
              )
            })}
          </ol>
        )}
      </Card>

      <Card>
        <div className="flex items-center gap-2 mb-2">
          <Bot className="size-5" style={{ color: 'var(--accent)' }} />
          <h2 className="display text-lg font-semibold">Run a collector</h2>
        </div>
        <ol className="list-decimal pl-5 space-y-1.5 text-sm" style={{ color: 'var(--muted)' }}>
          <li>Use a fresh wallet with a little USDC on {networkName(chainId)} for gas.</li>
          <li>Clone the repo, run <code className="mono">bun install</code>, then:</li>
        </ol>
        <p className="mono text-xs break-all rounded-xl p-3 my-3" style={{ background: 'var(--surface-muted)' }}>{RUN}</p>
        <div className="flex flex-wrap gap-2">
          <CopyButton text={RUN} label="Copy command" />
          <a href={REPO} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-2xl px-4 text-sm font-semibold" style={{ minHeight: 44, color: 'var(--accent)' }}>
            Read the bot
          </a>
        </div>
        <p className="text-xs mt-3" style={{ color: 'var(--subtle)' }}>
          The bot only collects when its own priority fee is below the tip, so each collection should leave you about the tip ahead.
          It skips requests while gas is above their cap. Add NETWORK=mainnet to run on mainnet.
        </p>
      </Card>
    </div>
  )
}
