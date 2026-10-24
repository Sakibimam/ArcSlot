import { ConnectKitButton } from 'connectkit'
import { useAccount, useSwitchChain } from 'wagmi'
import { ARC_MAINNET_ID, ARC_TESTNET_ID, isSupportedChain } from '@/lib/chains'

interface HeaderProps {
  chainId: number
  onChainChange: (id: number) => void
}

export function Header({ chainId, onChainChange }: HeaderProps) {
  const { chainId: walletChain } = useAccount()
  const { switchChain } = useSwitchChain()

  const handleChainSwitch = (id: number) => {
    onChainChange(id)
    if (walletChain && walletChain !== id) {
      switchChain({ chainId: id })
    }
  }

  return (
    <header
      className="flex items-center justify-between px-6 py-4 border-b"
      style={{ borderColor: 'var(--border)', background: 'rgba(13,27,47,0.85)', backdropFilter: 'blur(20px)' }}
    >
      <div className="flex items-center gap-4">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <div
            className="flex size-8 items-center justify-center rounded-xl text-sm font-bold"
            style={{ background: 'var(--accent)', color: '#0d1b2f' }}
          >
            S
          </div>
          <span className="display text-lg font-semibold" style={{ color: 'var(--ink)' }}>
            Arc Slot
          </span>
        </div>

        {/* Chain toggle */}
        <div
          className="flex rounded-xl p-1 gap-1"
          style={{ background: 'var(--surface-muted)' }}
        >
          {[
            { id: ARC_MAINNET_ID, label: 'Mainnet' },
            { id: ARC_TESTNET_ID, label: 'Testnet' },
          ].map(({ id, label }) => (
            <button
              key={id}
              onClick={() => handleChainSwitch(id)}
              className="px-3 py-1 rounded-lg text-xs font-semibold transition-all"
              style={
                chainId === id
                  ? { background: 'var(--accent)', color: '#0d1b2f' }
                  : { color: 'var(--subtle)' }
              }
            >
              {label}
            </button>
          ))}
        </div>

        {/* Wrong chain warning */}
        {walletChain && isSupportedChain(walletChain) && walletChain !== chainId && (
          <span className="text-xs px-2 py-1 rounded-lg" style={{ background: 'rgba(232,109,122,0.15)', color: 'var(--danger)' }}>
            Wallet on wrong chain — switch above
          </span>
        )}
      </div>

      <ConnectKitButton />
    </header>
  )
}
