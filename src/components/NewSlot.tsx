import { useState } from 'react'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { isAddress, keccak256, toHex, toBytes } from 'viem'
import { Loader2, Eye, Plus } from 'lucide-react'
import { SLOT_FACTORY_ABI } from '@/lib/abis'
import { type SupportedChainId, getFactoryAddress } from '@/lib/chains'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { toast } from 'sonner'

interface NewSlotProps {
  chainId: SupportedChainId
  onSlotCreated: (slotAddress: string) => void
}

function refToBytes32(ref: string): `0x${string}` {
  // Hash the UTF-8 string to bytes32, matching keccak256(abi.encodePacked(ref))
  return keccak256(toHex(toBytes(ref)))
}

export function NewSlot({ chainId, onSlotCreated }: NewSlotProps) {
  const { address: walletAddress, chainId: walletChain } = useAccount()
  const factoryAddress = getFactoryAddress(chainId)

  const [merchant, setMerchant] = useState('')
  const [refStr, setRefStr] = useState('')
  const [feeBps, setFeeBps] = useState('')
  const [feeRecipient, setFeeRecipient] = useState('')

  const payRef = refStr.trim() ? refToBytes32(refStr.trim()) : undefined

  // Derived validation
  const feeBpsNum = feeBps === '' ? 0 : parseInt(feeBps, 10)
  const isValidMerchant = isAddress(merchant)
  const isValidRef = refStr.trim().length > 0
  const isValidFeeBps = !isNaN(feeBpsNum) && feeBpsNum >= 0 && feeBpsNum <= 1000
  const isValidFeeRecipient = feeBpsNum === 0 || isAddress(feeRecipient)
  const canPredict = !!factoryAddress && isValidMerchant && isValidRef && payRef !== undefined

  // Predict address
  const { data: predictedAddress } = useReadContract({
    address: factoryAddress ?? undefined,
    abi: SLOT_FACTORY_ABI,
    functionName: 'predict',
    args: canPredict ? [merchant, payRef] : undefined,
    chainId,
    query: { enabled: canPredict },
  })

  // createSlot write
  const { writeContract, data: txHash, isPending, error: writeError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash })

  const wrongChain = walletChain !== chainId
  const canSubmit =
    !!walletAddress &&
    !wrongChain &&
    !!factoryAddress &&
    isValidMerchant &&
    isValidRef &&
    isValidFeeBps &&
    isValidFeeRecipient &&
    payRef !== undefined &&
    !isPending &&
    !isConfirming

  const handleCreate = () => {
    if (!canSubmit || !factoryAddress || !payRef) return
    writeContract({
      address: factoryAddress,
      abi: SLOT_FACTORY_ABI,
      functionName: 'createSlot',
      args: [
        merchant,
        payRef,
        feeBpsNum,
        (feeBpsNum > 0 ? feeRecipient : '0x0000000000000000000000000000000000000000') as `0x${string}`,
      ],
      chainId,
    })
  }

  // After success
  if (isSuccess && predictedAddress) {
    toast.success('Slot created')
    onSlotCreated(predictedAddress)
  }

  const txUrl = txHash ? buildTxExplorerUrl(chainId, txHash) : null

  return (
    <section className="rounded-3xl p-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <h2 className="display text-lg font-semibold mb-5" style={{ color: 'var(--ink)' }}>
        New Slot
      </h2>

      {!factoryAddress && (
        <div
          className="rounded-2xl p-4 mb-4 text-sm"
          style={{ background: 'rgba(245,201,122,0.1)', color: 'var(--warning)', border: '1px solid rgba(245,201,122,0.25)' }}
        >
          SlotFactory not yet deployed on this chain. Deploy the contract first.
        </div>
      )}

      <div className="space-y-4">
        {/* Merchant */}
        <div>
          <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--subtle)' }}>
            Merchant address
          </label>
          <input
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
            placeholder="0x..."
            spellCheck={false}
            className="w-full rounded-xl px-4 py-3 text-sm mono outline-none transition-all"
            style={{
              background: 'var(--surface-muted)',
              color: 'var(--ink)',
              border: `1px solid ${merchant && !isValidMerchant ? 'var(--danger)' : 'var(--border)'}`,
            }}
          />
        </div>

        {/* Reference */}
        <div>
          <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--subtle)' }}>
            Payment reference
          </label>
          <input
            value={refStr}
            onChange={(e) => setRefStr(e.target.value)}
            placeholder="e.g. order-001, invoice-42"
            className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-all"
            style={{
              background: 'var(--surface-muted)',
              color: 'var(--ink)',
              border: '1px solid var(--border)',
            }}
          />
          {refStr.trim() && payRef && (
            <p className="mt-1 text-xs mono truncate" style={{ color: 'var(--subtle)' }}>
              bytes32: {payRef}
            </p>
          )}
        </div>

        {/* Fee bps */}
        <div>
          <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--subtle)' }}>
            Fee (basis points, 0–1000)
          </label>
          <input
            value={feeBps}
            onChange={(e) => setFeeBps(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="0  (= no fee)"
            className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-all"
            style={{
              background: 'var(--surface-muted)',
              color: 'var(--ink)',
              border: `1px solid ${feeBps !== '' && !isValidFeeBps ? 'var(--danger)' : 'var(--border)'}`,
            }}
          />
          {feeBpsNum > 0 && isValidFeeBps && (
            <p className="mt-1 text-xs" style={{ color: 'var(--subtle)' }}>
              {(feeBpsNum / 100).toFixed(2)}% fee on every sweep
            </p>
          )}
        </div>

        {/* Fee recipient — only shown when fee > 0 */}
        {feeBpsNum > 0 && (
          <div>
            <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--subtle)' }}>
              Fee recipient
            </label>
            <input
              value={feeRecipient}
              onChange={(e) => setFeeRecipient(e.target.value)}
              placeholder="0x..."
              spellCheck={false}
              className="w-full rounded-xl px-4 py-3 text-sm mono outline-none transition-all"
              style={{
                background: 'var(--surface-muted)',
                color: 'var(--ink)',
                border: `1px solid ${feeRecipient && !isAddress(feeRecipient) ? 'var(--danger)' : 'var(--border)'}`,
              }}
            />
          </div>
        )}

        {/* Predicted address preview */}
        {predictedAddress && (
          <div
            className="rounded-2xl p-4"
            style={{ background: 'rgba(172,198,233,0.08)', border: '1px solid rgba(172,198,233,0.2)' }}
          >
            <div className="flex items-center gap-2 mb-1">
              <Eye className="size-4" style={{ color: 'var(--accent)' }} />
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>
                Predicted slot address
              </span>
            </div>
            <p className="mono text-sm break-all" style={{ color: 'var(--ink)' }}>
              {predictedAddress}
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>
              This address is deterministic — you can share it before confirming.
            </p>
          </div>
        )}

        {/* Error */}
        {writeError && (
          <div className="rounded-xl p-3 text-sm" style={{ background: 'rgba(232,109,122,0.1)', color: 'var(--danger)' }}>
            {writeError.message.includes('user rejected')
              ? 'Transaction cancelled.'
              : writeError.message.slice(0, 120)}
          </div>
        )}

        {/* Success */}
        {isSuccess && txUrl && (
          <div className="rounded-xl p-3 text-sm" style={{ background: 'rgba(141,216,159,0.1)', color: 'var(--success)' }}>
            Slot created.{' '}
            <a href={txUrl} target="_blank" rel="noreferrer" className="underline">
              View on explorer
            </a>
          </div>
        )}

        {/* CTA */}
        <button
          disabled={!canSubmit}
          onClick={handleCreate}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-semibold transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: 'var(--accent)', color: '#0d1b2f' }}
        >
          {isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Confirm in wallet...
            </>
          ) : isConfirming ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Confirming...
            </>
          ) : !walletAddress ? (
            'Connect wallet'
          ) : wrongChain ? (
            'Switch to correct chain'
          ) : !factoryAddress ? (
            'Factory not deployed'
          ) : (
            <>
              <Plus className="size-4" />
              Create slot
            </>
          )}
        </button>

        {/* Hint about wallet */}
        {!walletAddress && (
          <p className="text-center text-xs" style={{ color: 'var(--subtle)' }}>
            You can preview the predicted address without connecting.
          </p>
        )}
      </div>
    </section>
  )
}
