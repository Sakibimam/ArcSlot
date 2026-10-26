import { useId } from 'react'

// "The Issue": a strip of paper arcing out of its slot. 64-unit grid: the
// strip is an arch of radius 13, drawn engraved (ink 10, paper 6, ink 1
// hairline), over a fully rounded 50×10 slot.
export const ISSUE_PAPER = 'M21 46V29A13 13 0 0 1 47 29V37'
export const ISSUE_SLOT = { x: 7, y: 45, width: 50, height: 10, rx: 5 } as const

const INK = '#0B2A21'
const NOTE = '#F6F7F2'
const SERIAL = '#B3261E'

export function LogoMark({ className = 'size-8', paper = NOTE }: { className?: string; paper?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <path d={ISSUE_PAPER} fill="none" stroke={INK} strokeWidth="10" />
      <path d={ISSUE_PAPER} fill="none" stroke={paper} strokeWidth="6" />
      <path d={ISSUE_PAPER} fill="none" stroke={INK} strokeWidth="1" />
      <rect {...ISSUE_SLOT} fill={INK} />
    </svg>
  )
}

/**
 * The payment animation: a receipt printer. "sending": paper feeds at the
 * slot. "paid": the receipt prints out and ends in a red *PAID*. Animations
 * only run under motion-safe; with reduced motion the resting frame shows.
 */
export function PrintMark({
  state,
  tone = 'brand',
  className = 'size-16',
}: {
  state: 'sending' | 'paid'
  tone?: 'brand' | 'current'
  className?: string
}) {
  const clipId = `print-${useId().replace(/:/g, '')}`
  const current = tone === 'current'
  const sending = state === 'sending'
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label={sending ? 'Sending payment' : 'Paid'}
    >
      <clipPath id={clipId}>
        <rect x="0" y="13" width="64" height="51" />
      </clipPath>
      <g clipPath={`url(#${clipId})`}>
        <g
          data-part="paper"
          transform={sending ? 'translate(0 -36)' : undefined}
          className={sending ? 'motion-safe:animate-receipt-feed' : 'motion-safe:animate-receipt-print'}
        >
          <rect
            x="15" y="13" width="34" height="48"
            fill={current ? 'currentColor' : '#FFFFFF'}
            opacity={current ? 0.55 : undefined}
            stroke={current ? undefined : '#CDD3C4'}
            strokeWidth="0.75"
          />
          {!current && (
            <>
              <rect x="20" y="21" width="24" height="2" fill={INK} opacity="0.35" />
              <rect x="20" y="27" width="16" height="2" fill={INK} opacity="0.35" />
              <rect x="20" y="33" width="20" height="2" fill={INK} opacity="0.35" />
              {!sending && (
                <text
                  x="32" y="51" textAnchor="middle" fontSize="8"
                  fontFamily="DotGothic16, monospace" fill={SERIAL}
                >
                  *PAID*
                </text>
              )}
            </>
          )}
        </g>
      </g>
      <rect data-part="slot" x="6" y="8" width="52" height="10" rx="5" fill={current ? 'currentColor' : INK} />
    </svg>
  )
}
