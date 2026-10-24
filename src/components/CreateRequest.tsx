import { useEffect, useRef, useState } from 'react'
import { useAccount, useReadContract, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { isAddress, zeroAddress } from 'viem'
import { ChevronDown, CircleCheck, Link2, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { SLOT_FACTORY_ABI } from '@/lib/abis'
import { type SupportedChainId, getFactoryAddress, networkName, shortAddr } from '@/lib/chains'
import { type StoredSlot, formatUsdc6, makePayRef, parseUsdc6 } from '@/lib/slot-logic'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { Button, Card, Field, inputClass, inputStyle } from './ui'
import { SharePanel } from './ShareSheet'

interface CreateRequestProps {
  chainId: SupportedChainId
  onCreated: (request: StoredSlot) => void
}

const newSalt = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random()))

/** "2.5" (%) -> 250 bps; null if invalid or above 10%. */
function percentToBps(input: string): number | null {
  if (input.trim() === '') return 0
  if (!/^\d+(\.\d{1,2})?$/.test(input.trim())) return null
  const bps = Math.round(parseFloat(input) * 100)
  return bps <= 1000 ? bps : null
}

export function CreateRequest({ chainId, onCreated }: CreateRequestProps) {
  const { address: wallet, chainId: walletChain } = useAccount()
  const { switchChain, isPending: switching } = useSwitchChain()
  const factory = getFactoryAddress(chainId)

  const [amount, setAmount] = useState('')
  const [label, setLabel] = useState('')
  const [customPayout, setCustomPayout] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [feePct, setFeePct] = useState('')
  const [feeTo, setFeeTo] = useState('')
  const [maxReward, setMaxReward] = useState('0.05')
  const [salt, setSalt] = useState(newSalt)

  const payout = customPayout ?? wallet ?? ''
  const amountRaw = amount.trim() === '' ? undefined : parseUsdc6(amount)
  const amountInvalid = amountRaw === null || amountRaw === 0n
  const cleanLabel = label.trim() || 'Payment request'
  const payRef = makePayRef(cleanLabel, salt)
  const feeBps = percentToBps(feePct)
  const feeToInvalid = (feeBps ?? 0) > 0 && !isAddress(feeTo)
  const maxRewardRaw = parseUsdc6(maxReward)
  const payoutInvalid = !isAddress(payout)

  const { data: factoryTip } = useReadContract({
    address: factory ?? undefined,
    abi: SLOT_FACTORY_ABI,
    functionName: 'tip',
    chainId,
    query: { enabled: !!factory },
  })
  const maxRewardInvalid =
    maxRewardRaw === null || maxRewardRaw === 0n || (typeof factoryTip === 'bigint' && maxRewardRaw < factoryTip)

  const { data: predicted } = useReadContract({
    address: factory ?? undefined,
    abi: SLOT_FACTORY_ABI,
    functionName: 'predict',
    args: payoutInvalid ? undefined : [payout, payRef],
    chainId,
    query: { enabled: !!factory && !payoutInvalid },
  })

  const { writeContract, data: txHash, isPending, error, reset } = useWriteContract()
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash, chainId })

  // Freeze what was submitted, and report each tx exactly once.
  const submitted = useRef<StoredSlot | undefined>(undefined)
  const handledHash = useRef<string | undefined>(undefined)
  const [created, setCreated] = useState<StoredSlot | undefined>(undefined)

  useEffect(() => {
    if (!isSuccess || !txHash || handledHash.current === txHash || !submitted.current) return
    handledHash.current = txHash
    const req = submitted.current
    setCreated(req)
    onCreated(req)
    toast.success('Payment link created')
  }, [isSuccess, txHash, onCreated])

  const valid =
    !!factory && !payoutInvalid && !amountInvalid && feeBps !== null && !feeToInvalid && !maxRewardInvalid && !!predicted

  const handleCreate = () => {
    if (!valid || !factory || feeBps === null || maxRewardRaw === null || !predicted) return
    submitted.current = {
      address: predicted,
      chainId,
      label: cleanLabel,
      amount: amountRaw ?? undefined,
      createdAt: Date.now(),
    }
    writeContract({
      address: factory,
      abi: SLOT_FACTORY_ABI,
      functionName: 'createSlot',
      args: [
        payout,
        payRef,
        feeBps,
        feeBps > 0 ? (feeTo as `0x${string}`) : zeroAddress,
        maxRewardRaw,
      ],
      chainId,
    })
  }

  const startOver = () => {
    setCreated(undefined)
    setAmount('')
    setLabel('')
    setSalt(newSalt())
    submitted.current = undefined
    reset()
  }

  // ── Success: show the link to share ────────────────────────────────────────
  if (created) {
    return (
      <Card>
        <div className="flex items-center gap-2 mb-1" style={{ color: 'var(--success)' }}>
          <CircleCheck className="size-5" />
          <h2 className="display text-lg font-semibold">Payment link ready</h2>
        </div>
        <p className="text-sm mb-5" style={{ color: 'var(--subtle)' }}>
          Send this link or show the QR code. Your payer can pay from any wallet{created.amount ? <> — <b style={{ color: 'var(--ink)' }}>{formatUsdc6(created.amount)} USDC</b></> : null} for <b style={{ color: 'var(--ink)' }}>{created.label}</b>.
        </p>
        <SharePanel target={{ chainId, slot: created.address, amount: created.amount, label: created.label }} />
        <Button variant="ghost" className="w-full mt-3" onClick={startOver}>Create another request</Button>
      </Card>
    )
  }

  const wrongChain = !!wallet && walletChain !== chainId

  return (
    <Card>
      <h2 className="display text-xl font-semibold">Request a payment</h2>
      <p className="text-sm mt-1 mb-5" style={{ color: 'var(--subtle)' }}>
        Get a link and QR code your customer can pay in USDC. Funds go straight to your wallet.
      </p>

      {!factory && (
        <div className="rounded-2xl p-4 mb-5 text-sm" style={{ background: 'rgba(245,201,122,0.1)', color: 'var(--warning)', border: '1px solid rgba(245,201,122,0.25)' }}>
          Payments are not live on {networkName(chainId)} yet. Switch to Arc Testnet at the top of the page.
        </div>
      )}

      {!wallet ? (
        <div className="rounded-2xl p-5 text-center space-y-3" style={{ background: 'var(--surface-muted)' }}>
          <Wallet className="size-6 mx-auto" style={{ color: 'var(--accent)' }} />
          <p className="text-sm" style={{ color: 'var(--muted)' }}>Connect the wallet you want to get paid in.</p>
          <div className="flex justify-center"><ConnectKitButton /></div>
        </div>
      ) : (
        <div className="space-y-4">
          <Field id="cr-amount" label="Amount (USDC)" hint="Leave empty to let the payer choose." error={amountInvalid ? 'Enter an amount like 25 or 12.50' : undefined}>
            <div className="relative">
              <input
                id="cr-amount"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(',', '.'))}
                className={`${inputClass} pr-16 display text-2xl font-semibold`}
                style={inputStyle(amountInvalid)}
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-semibold" style={{ color: 'var(--subtle)' }}>USDC</span>
            </div>
          </Field>

          <Field id="cr-label" label="What is it for?" hint="Shown to your payer. e.g. Invoice #42, Coffee, Design work">
            <input
              id="cr-label"
              maxLength={80}
              placeholder="Invoice #42"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className={inputClass}
              style={inputStyle()}
            />
          </Field>

          <div className="rounded-2xl px-4 py-3" style={{ background: 'var(--surface-muted)' }}>
            {customPayout === null ? (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs" style={{ color: 'var(--subtle)' }}>Funds go to</p>
                  <p className="text-sm font-medium truncate">Your wallet <span className="mono" style={{ color: 'var(--subtle)' }}>{shortAddr(wallet)}</span></p>
                </div>
                <button type="button" onClick={() => setCustomPayout('')} className="text-sm font-semibold shrink-0" style={{ color: 'var(--accent)' }}>
                  Change
                </button>
              </div>
            ) : (
              <Field id="cr-payout" label="Payout address" error={customPayout && payoutInvalid ? 'Not a valid address' : undefined}>
                <div className="flex gap-2">
                  <input
                    id="cr-payout"
                    placeholder="0x…"
                    spellCheck={false}
                    value={customPayout}
                    onChange={(e) => setCustomPayout(e.target.value.trim())}
                    className={`${inputClass} mono text-sm`}
                    style={inputStyle(!!customPayout && payoutInvalid)}
                  />
                  <button type="button" onClick={() => setCustomPayout(null)} className="text-sm font-semibold px-2 shrink-0" style={{ color: 'var(--accent)' }}>
                    Mine
                  </button>
                </div>
              </Field>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="flex items-center gap-1 text-sm font-medium"
            style={{ color: 'var(--subtle)' }}
            aria-expanded={showAdvanced}
          >
            Advanced settings
            <ChevronDown className={`size-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
          </button>

          {showAdvanced && (
            <div className="space-y-4 rounded-2xl p-4" style={{ border: '1px dashed var(--border)' }}>
              <Field id="cr-fee" label="Platform fee (%)" hint="Optional cut for a platform or partner, up to 10%." error={feeBps === null ? 'Use 0–10, e.g. 2.5' : undefined}>
                <input id="cr-fee" inputMode="decimal" placeholder="0" value={feePct} onChange={(e) => setFeePct(e.target.value)} className={inputClass} style={inputStyle(feeBps === null)} />
              </Field>
              {(feeBps ?? 0) > 0 && (
                <Field id="cr-fee-to" label="Fee goes to" error={feeTo && feeToInvalid ? 'Not a valid address' : undefined}>
                  <input id="cr-fee-to" placeholder="0x…" spellCheck={false} value={feeTo} onChange={(e) => setFeeTo(e.target.value.trim())} className={`${inputClass} mono text-sm`} style={inputStyle(!!feeTo && feeToInvalid)} />
                </Field>
              )}
              <Field
                id="cr-max-reward"
                label="Max collector reward (USDC)"
                hint="Anyone can collect a paid request to your wallet and is refunded their gas from it. This caps that refund; you can always collect yourself for free."
                error={maxRewardInvalid ? `Must be at least ${typeof factoryTip === 'bigint' ? formatUsdc6(factoryTip) : '0.002'} USDC` : undefined}
              >
                <input id="cr-max-reward" inputMode="decimal" value={maxReward} onChange={(e) => setMaxReward(e.target.value)} className={inputClass} style={inputStyle(maxRewardInvalid)} />
              </Field>
            </div>
          )}

          {error && (
            <p className="rounded-xl p-3 text-sm" style={{ background: 'rgba(232,109,122,0.1)', color: 'var(--danger)' }}>
              {/rejected|denied/i.test(error.message) ? 'You cancelled the transaction.' : 'Could not create the request. Please try again.'}
            </p>
          )}

          {wrongChain ? (
            <Button className="w-full" loading={switching} onClick={() => switchChain({ chainId })}>
              Switch to {networkName(chainId)}
            </Button>
          ) : (
            <Button className="w-full" disabled={!valid} loading={isPending || confirming} onClick={handleCreate}>
              {!(isPending || confirming) && <Link2 className="size-4" />}
              {isPending ? 'Confirm in your wallet…' : confirming ? 'Creating…' : 'Create payment link'}
            </Button>
          )}
          {txHash && confirming && (
            <a href={buildTxExplorerUrl(chainId, txHash)} target="_blank" rel="noreferrer" className="block text-center text-xs" style={{ color: 'var(--subtle)' }}>
              View on explorer
            </a>
          )}
        </div>
      )}
    </Card>
  )
}
