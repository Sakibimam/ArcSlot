import { Inbox } from 'lucide-react'
import { SlotCard } from './SlotCard'
import { type SupportedChainId } from '@/lib/chains'
import { type ReceiptData, type StoredSlot } from '@/lib/slot-logic'

interface SlotsListProps {
  slots: StoredSlot[]
  chainId: SupportedChainId
  onSwept: (slotAddress: string, receipt: ReceiptData) => void
}

export function SlotsList({ slots, chainId, onSwept }: SlotsListProps) {
  if (slots.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <div
          className="flex size-14 items-center justify-center rounded-2xl"
          style={{ background: 'var(--surface)' }}
        >
          <Inbox className="size-7" style={{ color: 'var(--subtle)' }} />
        </div>
        <p className="text-sm font-medium" style={{ color: 'var(--muted)' }}>
          No slots yet
        </p>
        <p className="text-xs text-center max-w-xs" style={{ color: 'var(--subtle)' }}>
          Create a slot to get a deterministic USDC deposit address for your merchant.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {slots.map((slot) => (
        <SlotCard
          key={slot.address}
          slotAddress={slot.address}
          chainId={chainId}
          receipt={slot.receipt}
          onSwept={onSwept}
        />
      ))}
    </div>
  )
}
