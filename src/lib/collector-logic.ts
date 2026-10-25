// Decisions for the open collector bot. A collector earns the slot's USDC gas
// refund (priced at the base fee) plus the tip; the only cost not refunded is
// its own priority fee, so it's worth collecting while that stays below the tip.

export interface SlotState {
  slot: string
  balance: bigint
  quarantined: boolean
}

/** Slots worth simulating: at least the minimum, not on hold; biggest first. */
export function candidates(slots: SlotState[], minSweep: bigint): SlotState[] {
  return slots
    .filter((s) => !s.quarantined && s.balance > 0n && s.balance >= minSweep)
    .sort((a, b) => (b.balance > a.balance ? 1 : b.balance < a.balance ? -1 : 0))
}

/** Priority fee paid by the collector, in 6-decimal USDC (gas is USDC on Arc). */
export function priorityCost6(gas: bigint, priorityFeeWei: bigint): bigint {
  return (gas * priorityFeeWei) / 1_000_000_000_000n
}

export function worthCollecting(p: { simulated: boolean; gasEstimate: bigint; priorityFee: bigint; tip: bigint }): boolean {
  if (!p.simulated) return false
  return priorityCost6(p.gasEstimate, p.priorityFee) < p.tip
}
