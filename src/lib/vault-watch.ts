// Decides whether a SlotVault needs its owner's attention. A thief holding only
// the owner wallet can start a key recovery; it succeeds unless the PQ key
// cancels it within the vault's delay — so a pending recovery must be loud.

const ZERO = /^0x0{64}$/i

export interface RecoveryAlert {
  level: 'warning' | 'critical'
  secondsLeft: bigint
  message: string
}

export function recoveryAlert(s: { pendingKey: string; recoveryReadyAt: bigint; now: bigint }): RecoveryAlert | null {
  if (ZERO.test(s.pendingKey)) return null
  if (s.now >= s.recoveryReadyAt) {
    return { level: 'critical', secondsLeft: 0n, message: 'A vault key recovery can be completed now by anyone. Cancel it with your PQ key immediately if you did not start it.' }
  }
  const secondsLeft = s.recoveryReadyAt - s.now
  const days = Number(secondsLeft / 86_400n)
  const left = days >= 1 ? `${days} day${days === 1 ? '' : 's'}` : `${Number(secondsLeft / 3_600n)} hours`
  return { level: 'warning', secondsLeft, message: `A vault key recovery was started: ${left} left to cancel it if it wasn't you.` }
}
