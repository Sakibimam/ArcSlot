// Shared UI primitives — receipt/ledger design language.
import { useState, type ReactNode } from 'react'
import { Check, Copy, Loader2 } from 'lucide-react'
import type { RequestStatus } from '@/lib/slot-logic'

// ── Card ─────────────────────────────────────────────────────────────────────
// Note-paper surface with an ink rule; the bank-note motif.
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`p-5 sm:p-6 ${className}`}
      style={{ background: 'var(--surface)', border: '1.5px solid var(--ink)' }}
    >
      {children}
    </section>
  )
}

// ── Button ────────────────────────────────────────────────────────────────────
type ButtonProps = {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  loading?: boolean
  variant?: 'primary' | 'secondary' | 'ghost'
  type?: 'button' | 'submit'
  className?: string
}

export function Button({
  children, onClick, disabled, loading,
  variant = 'primary', type = 'button', className = '',
}: ButtonProps) {
  const base =
    'inline-flex items-center justify-center gap-2 px-4 text-sm font-bold ' +
    'transition-colors hover:brightness-[0.93] active:scale-[0.99] ' +
    'disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-carbon'

  const styles: Record<NonNullable<ButtonProps['variant']>, React.CSSProperties> = {
    primary:   { background: 'var(--ink)', color: 'var(--paper)' },
    secondary: { background: 'transparent', color: 'var(--ink)', border: '1.5px solid var(--ink)' },
    ghost:     { background: 'transparent', color: 'var(--carbon)' },
  }

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled ?? loading}
      className={`${base} ${className}`}
      style={{ minHeight: 40, ...styles[variant] }}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  )
}

// ── Field ─────────────────────────────────────────────────────────────────────
export function Field({
  id, label, hint, error, children,
}: {
  id: string; label: string; hint?: ReactNode; error?: string; children: ReactNode
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block serial text-[11px] font-medium mb-1.5"
        style={{ color: 'var(--ink)' }}
      >
        {label}
      </label>
      {children}
      {error ? (
        <p className="mt-1.5 text-[13px]" style={{ color: 'var(--danger)' }}>{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-[13px]" style={{ color: 'var(--muted-foreground)' }}>{hint}</p>
      ) : null}
    </div>
  )
}

export const inputClass =
  'w-full px-3 py-2.5 text-base outline-none transition-colors ' +
  'focus:ring-2 focus:ring-carbon focus:ring-offset-0'

export function inputStyle(invalid = false): React.CSSProperties {
  return {
    background: 'var(--surface)',
    color: 'var(--ink)',
    border: `1.5px solid ${invalid ? 'var(--danger)' : 'rgba(18,53,43,0.45)'}`,
  }
}

// ── StatusPill ────────────────────────────────────────────────────────────────
// Brief: Waiting amber, Paid green, Collected ink, Expired grey.
const STATUS: Record<RequestStatus, { label: string; color: string; bg: string }> = {
  loading:          { label: 'Loading…',               color: 'var(--muted-foreground)', bg: 'var(--muted)' },
  waiting:          { label: 'Waiting for payment',      color: 'var(--amber)',            bg: 'rgba(154,91,0,0.08)' },
  partial:          { label: 'Partially paid',           color: 'var(--amber)',            bg: 'rgba(154,91,0,0.08)' },
  'below-minimum':  { label: 'Below minimum',            color: 'var(--amber)',            bg: 'rgba(154,91,0,0.08)' },
  paid:             { label: 'Paid',                    color: 'var(--serial)',           bg: 'rgba(200,55,45,0.09)' },
  collected:        { label: 'Collected',               color: 'var(--ink)',              bg: 'rgba(18,53,43,0.08)' },
  'on-hold':        { label: 'On hold',                 color: 'var(--danger)',           bg: 'rgba(180,35,24,0.08)' },
}

export function StatusPill({ status }: { status: RequestStatus }) {
  const s = STATUS[status]
  return (
    <span
      className="px-2 py-0.5 serial text-[10.5px] font-medium whitespace-nowrap"
      style={{ color: s.color, background: s.bg }}
    >
      {s.label}
    </span>
  )
}

// ── CopyButton ────────────────────────────────────────────────────────────────
export function CopyButton({
  text, label = 'Copy', copiedLabel = 'Copied',
  variant = 'secondary', className = '',
}: {
  text: string; label?: string; copiedLabel?: string
  variant?: ButtonProps['variant']; className?: string
}) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
  }
  return (
    <Button variant={variant} onClick={copy} className={className}>
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      {copied ? copiedLabel : label}
    </Button>
  )
}

// ── NetworkBadge ──────────────────────────────────────────────────────────────
export function NetworkBadge({ name, testnet }: { name: string; testnet: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 serial text-[10.5px] font-medium"
      style={{ border: '1px solid rgba(18,53,43,0.35)', color: 'var(--muted-foreground)' }}
    >
      <span
        className="size-1.5 rounded-full"
        style={{ background: testnet ? 'var(--amber)' : 'var(--paid)' }}
      />
      {name}
    </span>
  )
}
