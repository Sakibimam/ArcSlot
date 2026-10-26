import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { ExternalLink, Share2, X } from 'lucide-react'
import { getShareBase } from '@/lib/share'
import { payUrl } from '@/lib/links'
import { formatUsdc6 } from '@/lib/slot-logic'
import { Button, CopyButton } from './ui'

export interface ShareTarget {
  chainId: number
  slot: string
  amount?: bigint
  label?: string
  onchain?: boolean
}

const localBase = () => window.location.origin + window.location.pathname

export function usePayLink(target: ShareTarget): string {
  const [base, setBase] = useState(localBase)
  useEffect(() => {
    let live = true
    void getShareBase().then((b) => live && setBase(b))
    return () => { live = false }
  }, [])
  return payUrl(base, target.onchain ? { chainId: target.chainId, slot: target.slot } : target)
}

export function SharePanel({ target }: { target: ShareTarget }) {
  const link = usePayLink(target)
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator
  return (
    <div className="space-y-4">
      <div className="flex justify-center">
        <div className="rounded-sm p-3 bg-white border border-rule">
          <QRCodeSVG value={link} size={176} />
        </div>
      </div>
      <p
        data-testid="pay-link"
        className="font-mono text-xs break-all rounded-sm p-3"
        style={{ background: 'var(--paper)', border: '1px solid var(--rule)', color: 'var(--ink)' }}
      >
        {link}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <CopyButton text={link} label="Copy link" variant="primary" />
        {canShare ? (
          <Button
            variant="secondary"
            onClick={() =>
              void navigator
                .share({
                  title: target.label ?? 'Payment request',
                  text: target.amount ? `Pay ${formatUsdc6(target.amount)} USDC` : 'Pay with USDC',
                  url: link,
                })
                .catch(() => undefined)
            }
          >
            <Share2 className="size-4" /> Share
          </Button>
        ) : (
          <a href={link} target="_blank" rel="noreferrer" className="contents">
            <Button variant="secondary" className="w-full">
              <ExternalLink className="size-4" /> Open
            </Button>
          </a>
        )}
      </div>
    </div>
  )
}

export function ShareSheet({ target, onClose }: { target: ShareTarget; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-label="Share payment link"
        className="relative w-full sm:max-w-sm rounded-t-sm sm:rounded-sm p-6"
        style={{ background: 'var(--surface)', border: '1px solid var(--rule)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 p-1 text-ink/40 hover:text-ink"
        >
          <X className="size-5" />
        </button>
        <p className="text-sm text-ink/50 mb-1">Share with your payer</p>
        <p className="text-xl font-semibold mb-4 pr-8 truncate text-ink">
          {target.label ?? 'Payment request'}
          {target.amount ? ` · ${formatUsdc6(target.amount)} USDC` : ''}
        </p>
        <SharePanel target={target} />
      </div>
    </div>
  )
}
