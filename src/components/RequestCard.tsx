import { useEffect, useRef, useState } from 'react'
import { useReadContracts, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { erc20Abi } from 'viem'
import { ArrowDownToLine, ChevronDown, ExternalLink, Share2, ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import { SLOT_ABI } from '@/lib/abis'
import { USDC_ADDRESS, shortAddr } from '@/lib/chains'
import {
  type ReceiptData,
  type StoredSlot,
  canCollect,
  decodeSweepReceipt,
  deriveRequestStatus,
  formatUsdc6,
} from '@/lib/slot-logic'
import { buildAddressExplorerUrl, buildTxExplorerUrl } from '@/onchain-facts'
import { Button, StatusPill } from './ui'
import { ShareSheet } from './ShareSheet'

interface RequestCardProps {
  request: StoredSlot
  onSwept: (slotAddress: string, receipt: ReceiptData) => void
}

export function RequestCard({ request, onSwept }: RequestCardProps) {
  const { address, chainId, label, amount, receipt } = request
  const addr = address as `0x${string}`
  const [sharing, setSharing] = useState(false)
  const [showDetails, setShowDetails] = useState(false)

  // Live state comes only from view calls; one receipt is final on Arc.
  const { data, isLoading, refetch } = useReadContracts({
    contracts: [
      { address: addr, abi: SLOT_ABI, functionName: 'quarantined', chainId },
      { address: addr, abi: SLOT_ABI, functionName: 'minSweep', chainId },
      { address: USDC_ADDRESS, abi: erc20Abi, functionName: 'balanceOf', args: [addr], chainId },
    ],
    query: { refetchInterval: 5_000 },
  })
  const quarantined = data?.[0].result
  const minSweep = data?.[1].result
  const balance = data?.[2].result

  const status = deriveRequestStatus({ loading: isLoading, quarantined, balance, minSweep, receipt, amount })
  const collectable = canCollect(status, balance, minSweep)

  const { writeContract, data: sweepHash, isPending, error } = useWriteContract()
  const { data: sweepReceipt, isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash: sweepHash, chainId })

  const handledHash = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!isSuccess || !sweepHash || !sweepReceipt || handledHash.current === sweepHash) return
    handledHash.current = sweepHash
    const decoded = decodeSweepReceipt(sweepReceipt.logs, address, sweepHash)
    if (decoded) {
      onSwept(address, decoded)
      toast.success(`${formatUsdc6(decoded.net)} USDC sent to your wallet`)
    } else {
      toast.error('Collection paused: the payout address is blocked by USDC')
    }
    void refetch()
  }, [isSuccess, sweepHash, sweepReceipt, address, onSwept, refetch])

  const received = balance ?? 0n
  const progress = amount && amount > 0n ? Number((received * 100n) / amount) : 0

  return (
    <article className="rounded-3xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold truncate">{label ?? 'Payment request'}</h3>
          <a
            href={buildAddressExplorerUrl(chainId, address)}
            target="_blank"
            rel="noreferrer"
            className="mono text-xs inline-flex items-center gap-1"
            style={{ color: 'var(--subtle)' }}
          >
            {shortAddr(address)} <ExternalLink className="size-3" />
          </a>
        </div>
        <StatusPill status={status} />
      </div>

      {status === 'collected' && receipt ? (
        <div className="mt-4">
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            You received <span className="display text-lg font-semibold" style={{ color: 'var(--ink)' }}>{formatUsdc6(receipt.net)} USDC</span>
          </p>
          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            className="mt-2 flex items-center gap-1 text-xs font-medium"
            style={{ color: 'var(--subtle)' }}
            aria-expanded={showDetails}
          >
            Details <ChevronDown className={`size-3.5 transition-transform ${showDetails ? 'rotate-180' : ''}`} />
          </button>
          {showDetails && (
            <dl className="mt-2 space-y-1.5 rounded-2xl p-3 text-xs" style={{ background: 'var(--surface-muted)' }}>
              {[
                ['Paid in', formatUsdc6(receipt.gross)],
                ['Platform fee', formatUsdc6(receipt.fee)],
                ['Collector reward', formatUsdc6(receipt.reimbursement)],
                ['Sent to you', formatUsdc6(receipt.net)],
                ['Collected by', shortAddr(receipt.sweeper)],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <dt style={{ color: 'var(--subtle)' }}>{k}</dt>
                  <dd className="mono">{v}</dd>
                </div>
              ))}
              <a href={buildTxExplorerUrl(chainId, receipt.txHash)} target="_blank" rel="noreferrer" className="flex items-center gap-1 pt-1" style={{ color: 'var(--accent)' }}>
                View transaction <ExternalLink className="size-3" />
              </a>
            </dl>
          )}
        </div>
      ) : (
        <div className="mt-4">
          <p data-testid="received" className="text-sm" style={{ color: 'var(--muted)' }}>
            <span className="display text-2xl font-semibold" style={{ color: 'var(--ink)' }}>{formatUsdc6(received)}</span>
            {amount ? ` of ${formatUsdc6(amount)} USDC received` : ' USDC received'}
          </p>
          {amount ? (
            <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-muted)' }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(progress, 100)}%`, background: status === 'paid' ? 'var(--success)' : 'var(--accent)' }} />
            </div>
          ) : null}
        </div>
      )}

      {status === 'on-hold' && (
        <p className="mt-3 flex gap-2 rounded-xl p-3 text-xs" style={{ background: 'rgba(232,109,122,0.1)', color: 'var(--danger)' }}>
          <ShieldAlert className="size-4 shrink-0" />
          On hold: the payout address is blocked by USDC. The funds are safe in the request address.
        </p>
      )}

      {error && (
        <p className="mt-3 rounded-xl p-3 text-xs" style={{ background: 'rgba(232,109,122,0.1)', color: 'var(--danger)' }}>
          {/rejected|denied/i.test(error.message) ? 'You cancelled the transaction.' : 'Could not collect right now. Please try again.'}
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={() => setSharing(true)}>
          <Share2 className="size-4" /> Share
        </Button>
        <Button
          disabled={!collectable}
          loading={isPending || confirming}
          onClick={() => writeContract({ address: addr, abi: SLOT_ABI, functionName: 'sweep', chainId })}
        >
          {!(isPending || confirming) && <ArrowDownToLine className="size-4" />}
          {isPending ? 'Confirm…' : confirming ? 'Collecting…' : 'Collect'}
        </Button>
      </div>
      {!collectable && received > 0n && minSweep !== undefined && received < minSweep && (
        <p className="mt-2 text-xs text-center" style={{ color: 'var(--subtle)' }}>
          You can collect from {formatUsdc6(minSweep)} USDC.
        </p>
      )}

      {sharing && (
        <ShareSheet target={{ chainId, slot: address, amount, label }} onClose={() => setSharing(false)} />
      )}
    </article>
  )
}
