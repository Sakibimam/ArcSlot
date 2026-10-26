import { useEffect, useRef, useState } from 'react'
import { useReadContracts, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { erc20Abi } from 'viem'
import { ArrowDownToLine, ChevronDown, ExternalLink, Share2, ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import { SLOT_ABI } from '@/lib/abis'
import { type SupportedChainId, USDC_ADDRESS, shortAddr } from '@/lib/chains'
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
import { RecoverPanel } from './RecoverPanel'

interface RequestCardProps {
  request: StoredSlot
  onSwept: (slotAddress: string, receipt: ReceiptData) => void
}

export function RequestCard({ request, onSwept }: RequestCardProps) {
  const { address, chainId, label, amount, receipt } = request
  const addr = address as `0x${string}`
  const [sharing, setSharing] = useState(false)
  const [showDetails, setShowDetails] = useState(false)

  const { data, isLoading, refetch } = useReadContracts({
    contracts: [
      { address: addr, abi: SLOT_ABI, functionName: 'quarantined', chainId },
      { address: addr, abi: SLOT_ABI, functionName: 'minSweep', chainId },
      { address: USDC_ADDRESS, abi: erc20Abi, functionName: 'balanceOf', args: [addr], chainId },
      { address: addr, abi: SLOT_ABI, functionName: 'totalCollected', chainId },
    ],
    query: { refetchInterval: 5_000 },
  })
  const quarantined = data?.[0]?.result
  const minSweep = data?.[1]?.result
  const balance = data?.[2]?.result
  const collected = data?.[3]?.result
  const status = deriveRequestStatus({ loading: isLoading, quarantined, balance, minSweep, receipt, amount, collected })
  const collectable = canCollect(status, balance, minSweep)

  const { writeContract, data: sweepHash, isPending, error } = useWriteContract()
  const { data: sweepReceipt, isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({
    hash: sweepHash,
    chainId,
  })

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

  // ── Compact ledger row ────────────────────────────────────────────────────────
  return (
    <article>
      {/* Main row — label left, status + amount right */}
      <div className="flex items-start justify-between gap-3 py-3">
        {/* Left: label + address */}
        <div className="min-w-0 flex-1">
          <p className="font-bold text-ink truncate leading-snug">
            {label ?? 'Payment request'}
          </p>
          <a
            href={buildAddressExplorerUrl(chainId, address)}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs inline-flex items-center gap-1 text-ink/40 hover:text-carbon mt-0.5"
          >
            {shortAddr(address)} <ExternalLink className="size-3" />
          </a>
        </div>

        {/* Right: status badge + amount */}
        <div className="flex flex-col items-end gap-1 shrink-0">
          <StatusPill status={status} />
          {/* Amount display — varies by state */}
          {status === 'collected' && receipt ? (
            <span className="text-sm font-semibold text-ink tabular">
              {formatUsdc6(receipt.net)} USDC
            </span>
          ) : status === 'collected' ? (
            <span
              data-testid="collected"
              className="text-sm font-semibold text-ink tabular"
            >
              {formatUsdc6(collected ?? 0n)} USDC collected
            </span>
          ) : (
            <span
              data-testid="received"
              className="text-sm text-ink/60 tabular"
            >
              {amount
                ? `${formatUsdc6(received)} of ${formatUsdc6(amount)} USDC received`
                : `${formatUsdc6(received)} USDC received`}
            </span>
          )}
        </div>
      </div>

      {/* "You received" line — only when collected with receipt */}
      {status === 'collected' && receipt && (
        <p className="text-sm text-ink/60 pb-1">
          You received{' '}
          <span className="font-semibold text-ink tabular">{formatUsdc6(receipt.net)} USDC</span>
        </p>
      )}

      {/* On-hold warning */}
      {status === 'on-hold' && (
        <div
          className="mb-2 flex gap-2 rounded-sm p-3 text-xs"
          style={{ background: 'rgba(220,38,38,0.07)', color: 'var(--danger)' }}
        >
          <ShieldAlert className="size-4 shrink-0" />
          On hold: the payout address is blocked by USDC. The funds are safe in the request address.
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          className="mb-2 rounded-sm p-3 text-xs"
          style={{ background: 'rgba(220,38,38,0.07)', color: 'var(--danger)' }}
        >
          {/rejected|denied/i.test(error.message)
            ? 'You cancelled the transaction.'
            : 'Could not collect right now. Please try again.'}
        </div>
      )}

      {/* Below-minimum hint */}
      {!collectable && received > 0n && minSweep !== undefined && received < minSweep && (
        <p className="pb-1 text-xs text-ink/50">
          You can collect from {formatUsdc6(minSweep)} USDC.
        </p>
      )}

      {/* Actions row — always Share icon; Collect only when collectable; Details toggle */}
      <div className="flex items-center gap-2 pb-3">
        {/* Share — always visible as icon button */}
        <button
          type="button"
          aria-label="Share"
          onClick={() => setSharing(true)}
          className="flex items-center justify-center size-8 rounded-sm border border-rule text-ink/50 hover:text-ink hover:border-ink/30 transition-colors"
        >
          <Share2 className="size-4" />
        </button>

        {/* Collect — always in DOM so tests can assert disabled state.
            When not collectable it's a quiet ghost so it doesn't dominate. */}
        {collectable ? (
          <Button
            loading={isPending || confirming}
            onClick={() =>
              writeContract({ address: addr, abi: SLOT_ABI, functionName: 'sweep', chainId })
            }
            className="h-8 text-sm px-3"
          >
            {!(isPending || confirming) && <ArrowDownToLine className="size-3.5" />}
            {isPending ? 'Confirm…' : confirming ? 'Collecting…' : 'Collect'}
          </Button>
        ) : (
          <button
            type="button"
            disabled
            className="h-8 px-3 text-sm font-medium text-ink/20 cursor-not-allowed select-none"
            aria-label="Collect"
          >
            Collect
          </button>
        )}

        {/* Details toggle — shown when collected with receipt */}
        {status === 'collected' && receipt && (
          <button
            type="button"
            aria-label="Details"
            onClick={() => setShowDetails((v) => !v)}
            className="flex items-center gap-1 text-xs font-medium text-ink/50 hover:text-ink ml-auto"
            aria-expanded={showDetails}
          >
            Details
            <ChevronDown
              className={`size-3.5 transition-transform ${showDetails ? 'rotate-180' : ''}`}
            />
          </button>
        )}
      </div>

      {/* Details ledger — collected with receipt only */}
      {status === 'collected' && receipt && showDetails && (
        <dl
          className="mb-3 space-y-1.5 rounded-sm p-3 text-xs"
          style={{ background: 'var(--paper)', border: '1px solid var(--rule)' }}
        >
          {(
            [
              ['Paid in', formatUsdc6(receipt.gross)],
              ['Platform fee', formatUsdc6(receipt.fee)],
              ['Collector reward', formatUsdc6(receipt.reimbursement)],
              ['Sent to you', formatUsdc6(receipt.net)],
              ['Collected by', shortAddr(receipt.sweeper)],
            ] as [string, string][]
          ).map(([k, v]) => (
            <div key={k} className="flex justify-between">
              <dt className="text-ink/50">{k}</dt>
              <dd className="tabular">{v}</dd>
            </div>
          ))}
          <a
            href={buildTxExplorerUrl(chainId, receipt.txHash)}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 pt-1 text-carbon"
          >
            View transaction <ExternalLink className="size-3" />
          </a>
        </dl>
      )}

      {/* Hairline separator */}
      <div className="h-px bg-rule" />

      <RecoverPanel arcChainId={chainId as SupportedChainId} slot={address} />

      {sharing && (
        <ShareSheet
          target={{ chainId, slot: address, amount, label, onchain: request.onchain }}
          onClose={() => setSharing(false)}
        />
      )}
    </article>
  )
}
