// Small shared UI primitives so every screen looks and behaves the same.
import { useState, type ReactNode } from 'react'
import { Check, Copy, Loader2 } from 'lucide-react'
import type { RequestStatus } from '@/lib/slot-logic'

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-3xl p-5 sm:p-6 ${className}`}
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      {children}
    </section>
  )
}

type ButtonProps = {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  loading?: boolean
  variant?: 'primary' | 'secondary' | 'ghost'
  type?: 'button' | 'submit'
  className?: string
}

export function Button({ children, onClick, disabled, loading, variant = 'primary', type = 'button', className = '' }: ButtonProps) {
  const styles = {
    primary: { background: 'var(--accent)', color: '#0d1b2f' },
    secondary: { background: 'var(--surface-strong)', color: 'var(--ink)', border: '1px solid var(--border)' },
    ghost: { background: 'transparent', color: 'var(--accent)' },
  }[variant]
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-2xl px-4 text-sm font-semibold transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed ${className}`}
      style={{ minHeight: 44, ...styles }}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  )
}

export function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium mb-1.5" style={{ color: 'var(--muted)' }}>
        {label}
      </label>
      {children}
      {error ? (
        <p className="mt-1 text-xs" style={{ color: 'var(--danger)' }}>{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs" style={{ color: 'var(--subtle)' }}>{hint}</p>
      ) : null}
    </div>
  )
}

export const inputClass = 'w-full rounded-xl px-4 py-3 text-base outline-none transition-all'
export function inputStyle(invalid = false): React.CSSProperties {
  return {
    background: 'var(--surface-muted)',
    color: 'var(--ink)',
    border: `1px solid ${invalid ? 'var(--danger)' : 'var(--border)'}`,
  }
}

const STATUS: Record<RequestStatus, { label: string; color: string; bg: string }> = {
  loading: { label: 'Loading…', color: 'var(--subtle)', bg: 'var(--surface-muted)' },
  waiting: { label: 'Waiting for payment', color: 'var(--muted)', bg: 'var(--surface-muted)' },
  partial: { label: 'Partially paid', color: 'var(--warning)', bg: 'rgba(245,201,122,0.12)' },
  'below-minimum': { label: 'Received (below minimum)', color: 'var(--warning)', bg: 'rgba(245,201,122,0.12)' },
  paid: { label: 'Paid', color: 'var(--success)', bg: 'rgba(141,216,159,0.14)' },
  collected: { label: 'Collected', color: 'var(--accent)', bg: 'rgba(172,198,233,0.14)' },
  'on-hold': { label: 'On hold', color: 'var(--danger)', bg: 'rgba(232,109,122,0.14)' },
}

export function StatusPill({ status }: { status: RequestStatus }) {
  const s = STATUS[status]
  return (
    <span className="px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap" style={{ color: s.color, background: s.bg }}>
      {s.label}
    </span>
  )
}

export function CopyButton({ text, label = 'Copy', copiedLabel = 'Copied', variant = 'secondary', className = '' }: { text: string; label?: string; copiedLabel?: string; variant?: ButtonProps['variant']; className?: string }) {
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

export function NetworkBadge({ name, testnet }: { name: string; testnet: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
      style={{ background: 'var(--surface-muted)', color: 'var(--muted)' }}
    >
      <span className="size-1.5 rounded-full" style={{ background: testnet ? 'var(--warning)' : 'var(--success)' }} />
      {name}
    </span>
  )
}
