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
