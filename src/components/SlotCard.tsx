import { useState } from 'react'
import { useReadContracts, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { erc20Abi } from 'viem'
import { Copy, Check, QrCode, Zap, Loader2, AlertTriangle, ExternalLink } from 'lucide-react'
import { SLOT_ABI } from '@/lib/abis'
import { type SupportedChainId, formatUsdc6, shortenAddress } from '@/lib/chains'
import { buildAddressExplorerUrl, buildTxExplorerUrl, requireChain } from '@/onchain-facts'
import { QrModal } from './QrModal'
import { toast } from 'sonner'

const USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as const

interface ReceiptData {
  gross: bigint
  net: bigint
  fee: bigint
  reimbursement: bigint
  sweeper: string
  txHash: string
}

interface SlotCardProps {
  slotAddress: string
  chainId: SupportedChainId
  // Receipt data if already swept — parent passes this in when available
  receipt?: ReceiptData
}

type SlotStatus = 'loading' | 'awaiting' | 'funded' | 'swept' | 'quarantined'

function statusLabel(s: SlotStatus): string {
  switch (s) {
    case 'awaiting': return 'Awaiting payment'
    case 'funded':   return 'Funded'
    case 'swept':    return 'Swept'
    case 'quarantined': return 'Quarantined'
    default: return '...'
  }
}

function statusStyle(s: SlotStatus): React.CSSProperties {
  switch (s) {
    case 'funded':
      return { background: 'rgba(141,216,159,0.12)', color: 'var(--success)' }
    case 'swept':
      return { background: 'rgba(172,198,233,0.12)', color: 'var(--accent)' }
    case 'quarantined':
      return { background: 'rgba(232,109,122,0.12)', color: 'var(--danger)' }
    default:
      return { background: 'var(--surface-muted)', color: 'var(--subtle)' }
  }
}

export function SlotCard({ slotAddress, chainId, receipt }: SlotCardProps) {
  const [copied, setCopied] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)

  const addr = slotAddress as `0x${string}`
  const explorerBase = requireChain(chainId).explorerBase

  // Read all slot state via view calls only
  const { data, isLoading, refetch } = useReadContracts({
    contracts: [
      { address: addr, abi: SLOT_ABI, functionName: 'payRef', chainId },
      { address: addr, abi: SLOT_ABI, functionName: 'feeBps', chainId },
      { address: addr, abi: SLOT_ABI, functionName: 'quarantined', chainId },
      // Read balance via USDC ERC-20 balanceOf — do NOT use balance() + native balance
      {
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [addr],
        chainId,
      },
    ],
    query: { enabled: !!slotAddress, refetchInterval: 10_000 },
  })

  const payRef = data?.[0].result
  const feeBps = data?.[1].result
  const isQuarantined = data?.[2].result
  const balanceRaw = data?.[3].result

  // Determine status
  let status: SlotStatus = 'loading'
  if (!isLoading) {
    if (receipt) {
      status = 'swept'
    } else if (isQuarantined) {
      status = 'quarantined'
    } else if (balanceRaw !== undefined && balanceRaw > 0n) {
      status = 'funded'
    } else {
      status = 'awaiting'
    }
  }

  // sweep() write
  const { writeContract, data: sweepHash, isPending, error: sweepError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: sweepSuccess } = useWaitForTransactionReceipt({ hash: sweepHash })

  if (sweepSuccess && sweepHash) {
    toast.success(`Slot swept — tx: ${shortenAddress(sweepHash)}`)
    void refetch()
  }

  const handleSweep = () => {
    writeContract({ address: addr, abi: SLOT_ABI, functionName: 'sweep', chainId })
  }

  const handleCopyAddress = () => {
    void navigator.clipboard.writeText(slotAddress).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const sweepTxUrl = sweepHash ? buildTxExplorerUrl(chainId, sweepHash) : null
  const slotExplorerUrl = buildAddressExplorerUrl(chainId, slotAddress)

  // payRef as a short hex label
  const refLabel = payRef ? `${payRef.slice(0, 10)}...` : '...'

  return (
    <>
      <div
        className="rounded-2xl p-5 transition-all"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        {/* Top row: ref + status */}
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2 min-w-0">
            <p className="mono text-xs font-medium truncate" style={{ color: 'var(--muted)' }}>
              {refLabel}
            </p>
          </div>
          <span
            className="shrink-0 px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap"
            style={statusStyle(status)}
          >
            {statusLabel(status)}
          </span>
        </div>

        {/* Address row */}
        <div
          className="flex items-center gap-2 rounded-xl px-3 py-2 mb-3"
          style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
        >
          <span className="mono text-xs flex-1 truncate" style={{ color: 'var(--muted)' }}>
            {shortenAddress(slotAddress)}
          </span>
          <button
            onClick={handleCopyAddress}
            className="p-1 rounded-lg transition-colors hover:opacity-70"
            title="Copy address"
          >
            {copied ? <Check className="size-3.5" style={{ color: 'var(--success)' }} /> : <Copy className="size-3.5" style={{ color: 'var(--subtle)' }} />}
          </button>
          <button
            onClick={() => setQrOpen(true)}
            className="p-1 rounded-lg transition-colors hover:opacity-70"
            title="Show QR code"
          >
            <QrCode className="size-3.5" style={{ color: 'var(--subtle)' }} />
          </button>
          <a
            href={slotExplorerUrl}
            target="_blank"
            rel="noreferrer"
            className="p-1 rounded-lg transition-colors hover:opacity-70"
            title="View on explorer"
          >
            <ExternalLink className="size-3.5" style={{ color: 'var(--subtle)' }} />
          </a>
        </div>

        {/* Balance — dominant object */}
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--subtle)' }}>
            Balance
          </p>
          <div className="flex items-baseline gap-2">
            <span className="display text-3xl font-bold tabular-nums" style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}>
              {balanceRaw !== undefined ? formatUsdc6(balanceRaw) : '—'}
            </span>
            <span className="text-base font-semibold" style={{ color: 'var(--muted)' }}>USDC</span>
            {feeBps !== undefined && feeBps > 0 && (
              <span className="text-xs ml-auto" style={{ color: 'var(--subtle)' }}>
                {(feeBps / 100).toFixed(2)}% fee
              </span>
            )}
          </div>
        </div>

        {/* Receipt panel — shown when swept */}
        {receipt && status === 'swept' && (
          <div
            className="rounded-2xl p-4 mb-4 space-y-1.5"
            style={{ background: 'rgba(172,198,233,0.07)', border: '1px solid rgba(172,198,233,0.15)' }}
          >
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--accent)' }}>
              Receipt
            </p>
            {[
              { label: 'Gross', value: formatUsdc6(receipt.gross) },
              { label: 'Fee', value: formatUsdc6(receipt.fee) },
              { label: 'Net to merchant', value: formatUsdc6(receipt.net) },
              { label: 'Sweeper reimbursement', value: formatUsdc6(receipt.reimbursement) },
              { label: 'Swept by', value: shortenAddress(receipt.sweeper) },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between items-center text-xs">
                <span style={{ color: 'var(--subtle)' }}>{label}</span>
                <span className="mono font-medium" style={{ color: 'var(--ink-2)' }}>{value}</span>
              </div>
            ))}
            {receipt.txHash && (
              <a
                href={`${explorerBase}/tx/${receipt.txHash}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-xs mt-2"
                style={{ color: 'var(--accent)' }}
              >
                View transaction <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        )}

        {/* Quarantine warning */}
        {status === 'quarantined' && (
          <div
            className="rounded-xl px-3 py-2 mb-3 flex items-center gap-2 text-xs"
            style={{ background: 'rgba(232,109,122,0.1)', color: 'var(--danger)' }}
          >
            <AlertTriangle className="size-3.5 shrink-0" />
            Quarantined — merchant or fee recipient is blacklisted by USDC.
          </div>
        )}

        {/* Sweep error */}
        {sweepError && (
          <div className="rounded-xl px-3 py-2 mb-3 text-xs" style={{ background: 'rgba(232,109,122,0.1)', color: 'var(--danger)' }}>
            {sweepError.message.includes('user rejected') ? 'Cancelled.' : sweepError.message.slice(0, 100)}
          </div>
        )}

        {sweepTxUrl && !sweepError && (
          <a
            href={sweepTxUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-xs mb-3"
            style={{ color: 'var(--success)' }}
          >
            Sweep confirmed <ExternalLink className="size-3" />
          </a>
        )}

        {/* Sweep button — anyone can sweep */}
        {status !== 'swept' && (
          <button
            disabled={status === 'awaiting' || status === 'loading' || isPending || isConfirming}
            onClick={handleSweep}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold transition-all hover:opacity-90 active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: status === 'funded' ? 'var(--accent)' : 'var(--surface-muted)',
              color: status === 'funded' ? '#0d1b2f' : 'var(--subtle)',
              minHeight: '44px',
            }}
          >
            {isPending ? (
              <><Loader2 className="size-4 animate-spin" /> Confirm in wallet...</>
            ) : isConfirming ? (
              <><Loader2 className="size-4 animate-spin" /> Confirming...</>
            ) : (
              <><Zap className="size-4" /> Sweep</>
            )}
          </button>
        )}
      </div>

      {qrOpen && (
        <QrModal
          address={slotAddress}
          label={refLabel}
          onClose={() => setQrOpen(false)}
        />
      )}
    </>
  )
}
