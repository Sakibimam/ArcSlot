import { useId } from 'react'

// "The Drop": half a coin landing in its slot. 64-unit grid: coin r15
// centred at (32, 34), slot 48×8 fully rounded, 3 units below the coin.
export const DROP_COIN = 'M17 34A15 15 0 0 1 47 34Z'
export const DROP_SLOT = { x: 8, y: 37, width: 48, height: 8, rx: 4 } as const

export function LogoMark({ className = 'size-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <path d={DROP_COIN} fill="#2445D6" />
      <rect {...DROP_SLOT} fill="#13233A" />
    </svg>
  )
}

const SLOT_TOP = DROP_SLOT.y

/**
 * The mark in motion. "sending": whole coins keep falling into the slot.
 * "paid": the half coin lands and turns paid green. Animations only run
 * under motion-safe; with reduced motion the final frame shows.
 */
export function DropMark({
  state,
  tone = 'brand',
  className = 'size-16',
}: {
  state: 'sending' | 'paid'
  tone?: 'brand' | 'current'
  className?: string
}) {
  const clipId = `drop-${useId().replace(/:/g, '')}`
  const current = tone === 'current'
  const slot = current ? 'currentColor' : '#13233A'
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label={state === 'paid' ? 'Paid' : 'Sending payment'}
    >
      {state === 'sending' ? (
        <>
          <clipPath id={clipId}>
            <rect x="0" y="0" width="64" height={SLOT_TOP} />
          </clipPath>
          <g clipPath={`url(#${clipId})`}>
            <circle
              cx="32" cy="24" r="9"
              fill={current ? 'currentColor' : '#2445D6'}
              className="motion-safe:animate-drop-fall"
            />
          </g>
        </>
      ) : (
        <path
          d={DROP_COIN}
          fill={current ? 'currentColor' : '#0B7A4B'}
          className={current ? undefined : 'motion-safe:animate-drop-land'}
        />
      )}
      <rect {...DROP_SLOT} fill={slot} opacity={current ? 0.6 : undefined} />
    </svg>
  )
}
