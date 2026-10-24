import { useState } from 'react'
import { Header } from '@/components/Header'
import { NewSlot } from '@/components/NewSlot'
import { SlotsList } from '@/components/SlotsList'
import { ARC_MAINNET_ID, type SupportedChainId } from '@/lib/chains'

interface SlotEntry {
  address: string
  chainId: SupportedChainId
}

export default function App() {
  // Default to Arc mainnet
  const [chainId, setChainId] = useState<SupportedChainId>(ARC_MAINNET_ID)
  const [slots, setSlots] = useState<SlotEntry[]>([])
  const [activeTab, setActiveTab] = useState<'new' | 'list'>('new')

  const handleSlotCreated = (address: string) => {
    setSlots((prev) => {
      // Avoid duplicates
      if (prev.some((s) => s.address === address && s.chainId === chainId)) return prev
      return [{ address, chainId }, ...prev]
    })
    setActiveTab('list')
  }

  const slotsForChain = slots.filter((s) => s.chainId === chainId)

  return (
    <div className="min-h-dvh flex flex-col">
      <Header chainId={chainId} onChainChange={(id) => setChainId(id as SupportedChainId)} />

      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-8">
        {/* Tab row */}
        <div className="flex items-center gap-1 mb-8 rounded-xl p-1 w-fit" style={{ background: 'var(--surface-muted)' }}>
          {[
            { key: 'new' as const, label: 'New Slot' },
            { key: 'list' as const, label: `Slots${slotsForChain.length > 0 ? ` (${slotsForChain.length})` : ''}` },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className="px-5 py-2 rounded-lg text-sm font-semibold transition-all"
              style={
                activeTab === key
                  ? { background: 'var(--surface-strong)', color: 'var(--ink)' }
                  : { color: 'var(--subtle)' }
              }
            >
              {label}
            </button>
          ))}
        </div>

        {/* Two-panel layout on desktop */}
        <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-8">
          {/* Left / New slot form — always visible on desktop, tab-gated on mobile */}
          <div className={activeTab === 'new' ? 'block' : 'hidden lg:block'}>
            <NewSlot chainId={chainId} onSlotCreated={handleSlotCreated} />
          </div>

          {/* Right / Slots list — always visible on desktop, tab-gated on mobile */}
          <div className={activeTab === 'list' ? 'block' : 'hidden lg:block'}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="display text-lg font-semibold" style={{ color: 'var(--ink)' }}>
                Slots
              </h2>
              {slotsForChain.length > 1 && (
                <span className="text-xs" style={{ color: 'var(--subtle)' }}>
                  {slotsForChain.length} slots on this chain
                </span>
              )}
            </div>
            <SlotsList slots={slotsForChain} chainId={chainId} />
          </div>
        </div>
      </main>
    </div>
  )
}
