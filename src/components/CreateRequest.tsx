import { useEffect, useRef, useState } from 'react'
import { useAccount, useReadContract, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { isAddress, parseAbi, zeroAddress } from 'viem'
import { ChevronDown, CircleCheck, Link2, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { SLOT_FACTORY_ABI } from '@/lib/abis'
import { type SupportedChainId, USDC_ADDRESS, getFactoryAddress, networkName, shortAddr } from '@/lib/chains'
import { type StoredSlot, formatUsdc6, makePayRef, parseUsdc6 } from '@/lib/slot-logic'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { Button, Card, Field, inputClass, inputStyle } from './ui'
import { SharePanel } from './ShareSheet'

const BLACKLIST_ABI = parseAbi(['function isBlacklisted(address) view returns (bool)'])

interface CreateRequestProps {
  chainId: SupportedChainId
  vault?: string | null
  onCreated: (request: StoredSlot) => void
}

const newSalt = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : String(Math.random())

function percentToBps(input: string): number | null {
  if (input.trim() === '') return 0
  if (!/^\d+(\.\d{1,2})?$/.test(input.trim())) return null
  const bps = Math.round(parseFloat(input) * 100)
  return bps <= 1000 ? bps : null
}

// ── Live receipt preview ──────────────────────────────────────────────────────
function ReceiptPreview({ amount, label }: { amount: string; label: string }) {
  const displayLabel = label.trim() || 'Payment request'
  const amountRaw = parseUsdc6(amount.trim())
  const displayAmount = amountRaw && amountRaw > 0n ? formatUsdc6(amountRaw) : '—'
  const fee = amountRaw && amountRaw > 0n ? '~$0.02' : '—'
  // Estimate only: the collector's network fee depends on gas at the time.
  const ESTIMATED_FEE = 20_000n // about 0.02 USDC
  const receive =
    amountRaw && amountRaw > 0n
      ? formatUsdc6(amountRaw > ESTIMATED_FEE ? amountRaw - ESTIMATED_FEE : amountRaw)
      : '—'

  return (
    <div
      aria-label="Receipt preview"
      className="select-none rounded-sm overflow-hidden"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--rule)',
        transform: 'rotate(-0.5deg)',
      }}
    >
      {/* Torn top edge */}
      <div
        className="h-3 w-full"
        style={{
          background: 'var(--paper)',
          maskImage: 'radial-gradient(circle at 8px 100%, transparent 6px, white 7px)',
          maskSize: '16px 100%',
          WebkitMaskImage: 'radial-gradient(circle at 8px 100%, transparent 6px, white 7px)',
          WebkitMaskSize: '16px 100%',
        }}
      />
      <div className="px-5 pb-5">
        <p className="text-[11px] text-ink/40 mb-3">Draft receipt</p>
        <p
          className="text-[15px] font-semibold text-ink mb-4 break-words"
          data-testid="preview-label"
        >
          {displayLabel}
        </p>
        <div className="space-y-2 tabular text-sm border-t border-rule pt-3">
          <div className="flex justify-between items-baseline">
            <span className="text-ink/60">Invoice amount</span>
            <span className="font-semibold text-ink" data-testid="preview-amount">
              {displayAmount !== '—' ? `${displayAmount} USDC` : '—'}
            </span>
          </div>
          <div className="flex justify-between items-baseline">
            <span className="text-ink/50 text-xs">Network fee</span>
            <span className="text-ink/50 text-xs">{fee}</span>
          </div>
          <div
            className="flex justify-between items-baseline pt-2 border-t border-rule font-bold text-ink"
          >
            <span>You receive</span>
            <span data-testid="preview-receive">
              {receive !== '—' ? `about ${receive} USDC` : '—'}
            </span>
          </div>
          <p className="text-xs text-ink/60 mt-1 text-right">after network fees</p>
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export function CreateRequest({ chainId, vault, onCreated }: CreateRequestProps) {
  const { address: wallet, chainId: walletChain } = useAccount()
  const { switchChain, isPending: switching } = useSwitchChain()
  const factory = getFactoryAddress(chainId)

  const [amount, setAmount] = useState('')
  const [label, setLabel] = useState('')
  const [customPayout, setCustomPayout] = useState<string | null>(null)
  const [preferWallet, setPreferWallet] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [feePct, setFeePct] = useState('')
  const [feeTo, setFeeTo] = useState('')
  const [maxReward, setMaxReward] = useState('0.05')
  const [expiry, setExpiry] = useState<'none' | '1d' | '7d' | '30d'>('none')
  const [salt, setSalt] = useState(newSalt)

  const toVault = !!vault && !preferWallet && customPayout === null
  const payout = customPayout ?? (toVault ? vault : wallet) ?? ''
  const amountRaw = amount.trim() === '' ? undefined : parseUsdc6(amount)
  const amountInvalid = amountRaw === null || amountRaw === 0n
  const cleanLabel = label.trim() || 'Payment request'
  const labelTooLong = new TextEncoder().encode(cleanLabel).length > 80
  const payRef = makePayRef(cleanLabel, salt)
  const feeBps = percentToBps(feePct)
  const feeToInvalid = (feeBps ?? 0) > 0 && !isAddress(feeTo)
  const maxRewardRaw = parseUsdc6(maxReward)

  const { data: payoutBlacklisted } = useReadContract({
    address: USDC_ADDRESS,
    abi: BLACKLIST_ABI,
    functionName: 'isBlacklisted',
    args: isAddress(payout) ? [payout] : undefined,
    chainId,
    query: { enabled: isAddress(payout) },
  })
  const payoutInvalid = !isAddress(payout) || payoutBlacklisted === true

  const { data: factoryTip } = useReadContract({
    address: factory ?? undefined,
    abi: SLOT_FACTORY_ABI,
    functionName: 'tip',
    chainId,
    query: { enabled: !!factory },
  })
  const maxRewardInvalid =
    maxRewardRaw === null ||
    maxRewardRaw === 0n ||
    (typeof factoryTip === 'bigint' && maxRewardRaw < factoryTip)

  const { data: predicted } = useReadContract({
    address: factory ?? undefined,
    abi: SLOT_FACTORY_ABI,
    functionName: 'predict',
    args: payoutInvalid || !wallet ? undefined : [wallet, payout, payRef],
    chainId,
    query: { enabled: !!factory && !payoutInvalid && !!wallet },
  })

  const { writeContract, data: txHash, isPending, error, reset } = useWriteContract()
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash, chainId })

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
    !!factory &&
    !labelTooLong &&
    !payoutInvalid &&
    !amountInvalid &&
    feeBps !== null &&
    !feeToInvalid &&
    !maxRewardInvalid &&
    !!predicted

  const handleCreate = () => {
    if (!valid || !factory || feeBps === null || maxRewardRaw === null || !predicted) return
    submitted.current = {
      address: predicted,
      chainId,
      label: cleanLabel,
      amount: amountRaw ?? undefined,
      createdAt: Date.now(),
      onchain: true,
    }
    const days = { none: 0, '1d': 1, '7d': 7, '30d': 30 }[expiry]
    const expiresAt = days === 0 ? 0n : BigInt(Math.floor(Date.now() / 1000) + days * 86_400)
    writeContract({
      address: factory,
      abi: SLOT_FACTORY_ABI,
      functionName: 'createRequest',
      args: [
        payout,
        payRef,
        feeBps,
        feeBps > 0 ? (feeTo as `0x${string}`) : zeroAddress,
        maxRewardRaw,
        amountRaw ?? 0n,
        cleanLabel,
        expiresAt,
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

  // ── Success: share step ────────────────────────────────────────────────────
  if (created) {
    return (
      <Card>
        <div className="flex items-center gap-2 mb-1 text-paid">
          <CircleCheck className="size-5" />
          <h2 className="text-lg font-semibold">Payment link ready</h2>
        </div>
        <p className="text-sm mb-5 text-ink/60">
          Send this link or show the QR code.
          {created.amount ? (
            <>
              {' '}Your payer owes{' '}
              <b className="text-ink">{formatUsdc6(created.amount)} USDC</b>
            </>
          ) : null}
          {' '}for <b className="text-ink">{created.label}</b>.
        </p>
        <SharePanel
          target={{ chainId, slot: created.address, amount: created.amount, label: created.label, onchain: true }}
        />
        <Button variant="ghost" className="w-full mt-3" onClick={startOver}>
          Create another request
        </Button>
      </Card>
    )
  }

  const wrongChain = !!wallet && walletChain !== chainId

  return (
    <div className="space-y-4">
      {/* Form card */}
      <Card>
        <h2 className="text-lg font-semibold text-ink mb-1">Create a payment link</h2>
        <p className="text-sm text-ink/50 mb-5">
          Get a link and QR code your customer can pay in USDC.
        </p>

        {!factory && (
          <div
            className="rounded-sm p-4 mb-5 text-sm"
            style={{ background: 'rgba(154,91,0,0.08)', color: 'var(--amber)', border: '1px solid rgba(154,91,0,0.18)' }}
          >
            Payments are not live on {networkName(chainId)} yet. Switch to Arc Testnet at the top of the page.
          </div>
        )}

        {!wallet ? (
          <div
            className="rounded-sm p-5 text-center space-y-3"
            style={{ background: 'var(--paper)' }}
          >
            <Wallet className="size-6 mx-auto text-carbon" />
            <p className="text-sm text-ink/60">Connect the wallet you want to get paid in.</p>
            <div className="flex justify-center">
              <ConnectKitButton />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <Field
              id="cr-amount"
              label="Amount (USDC)"
              hint="Leave empty to let the payer choose."
              error={amountInvalid ? 'Enter an amount like 25 or 12.50' : undefined}
            >
              <div className="relative">
                <input
                  id="cr-amount"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(',', '.'))}
                  className={`${inputClass} pr-16 tabular text-2xl font-semibold`}
                  style={inputStyle(amountInvalid)}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-ink/50">
                  USDC
                </span>
              </div>
            </Field>

            <Field
              id="cr-label"
              label="What is it for"
              hint="Shown to your payer. e.g. Invoice #42, Design work"
              error={labelTooLong ? 'Too long — keep it under 80 bytes' : undefined}
            >
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

            <Field id="cr-expiry" label="Expires">
              <select
                id="cr-expiry"
                value={expiry}
                onChange={(e) => setExpiry(e.target.value as typeof expiry)}
                className={inputClass}
                style={inputStyle()}
              >
                <option value="none">Never</option>
                <option value="1d">In 1 day</option>
                <option value="7d">In 7 days</option>
                <option value="30d">In 30 days</option>
              </select>
            </Field>

            {/* Payout destination */}
            <div className="rounded-sm px-3 py-2.5" style={{ background: 'var(--paper)', border: '1px solid var(--rule)' }}>
              {customPayout === null ? (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-ink/50">Funds go to</p>
                    {toVault ? (
                      <p className="text-sm font-medium truncate text-ink">
                        Your quantum-safe vault{' '}
                        <span className="font-mono text-xs text-ink/50">{shortAddr(vault)}</span>
                      </p>
                    ) : (
                      <p className="text-sm font-medium truncate text-ink">
                        Your wallet{' '}
                        <span className="font-mono text-xs text-ink/50">{shortAddr(wallet)}</span>
                      </p>
                    )}
                  </div>
                  <div className="flex gap-3 shrink-0">
                    {vault && (
                      <button
                        type="button"
                        onClick={() => setPreferWallet((v) => !v)}
                        className="text-sm font-medium text-carbon hover:underline"
                      >
                        {toVault ? 'Use wallet' : 'Use vault'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setCustomPayout('')}
                      className="text-sm font-medium text-carbon hover:underline"
                    >
                      Change
                    </button>
                  </div>
                </div>
              ) : (
                <Field
                  id="cr-payout"
                  label="Payout address"
                  error={
                    customPayout && payoutInvalid
                      ? payoutBlacklisted === true
                        ? "This address can't receive USDC"
                        : 'Not a valid address'
                      : undefined
                  }
                >
                  <div className="flex gap-2">
                    <input
                      id="cr-payout"
                      placeholder="0x…"
                      spellCheck={false}
                      value={customPayout}
                      onChange={(e) => setCustomPayout(e.target.value.trim())}
                      className={`${inputClass} font-mono text-sm`}
                      style={inputStyle(!!customPayout && payoutInvalid)}
                    />
                    <button
                      type="button"
                      onClick={() => setCustomPayout(null)}
                      className="text-sm font-medium text-carbon px-2 shrink-0 hover:underline"
                    >
                      Mine
                    </button>
                  </div>
                </Field>
              )}
            </div>

            {/* Advanced toggle */}
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex items-center gap-1 text-sm font-medium text-ink/50 hover:text-ink"
              aria-expanded={showAdvanced}
            >
              Advanced settings
              <ChevronDown
                className={`size-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
              />
            </button>

            {showAdvanced && (
              <div
                className="space-y-4 rounded-sm p-4"
                style={{ border: '1px dashed var(--rule)' }}
              >
                <Field
                  id="cr-fee"
                  label="Platform fee (%)"
                  hint="Optional cut for a platform or partner, up to 10%."
                  error={feeBps === null ? 'Use 0–10, e.g. 2.5' : undefined}
                >
                  <input
                    id="cr-fee"
                    inputMode="decimal"
                    placeholder="0"
                    value={feePct}
                    onChange={(e) => setFeePct(e.target.value)}
                    className={inputClass}
                    style={inputStyle(feeBps === null)}
                  />
                </Field>
                {(feeBps ?? 0) > 0 && (
                  <Field
                    id="cr-fee-to"
                    label="Fee goes to"
                    error={feeTo && feeToInvalid ? 'Not a valid address' : undefined}
                  >
                    <input
                      id="cr-fee-to"
                      placeholder="0x…"
                      spellCheck={false}
                      value={feeTo}
                      onChange={(e) => setFeeTo(e.target.value.trim())}
                      className={`${inputClass} font-mono text-sm`}
                      style={inputStyle(!!feeTo && feeToInvalid)}
                    />
                  </Field>
                )}
                <Field
                  id="cr-max-reward"
                  label="Max collector reward (USDC)"
                  hint="Caps the gas refund a collector can claim; you can always collect yourself for free."
                  error={
                    maxRewardInvalid
                      ? `Must be at least ${typeof factoryTip === 'bigint' ? formatUsdc6(factoryTip) : '0.002'} USDC`
                      : undefined
                  }
                >
                  <input
                    id="cr-max-reward"
                    inputMode="decimal"
                    value={maxReward}
                    onChange={(e) => setMaxReward(e.target.value)}
                    className={inputClass}
                    style={inputStyle(maxRewardInvalid)}
                  />
                </Field>
              </div>
            )}

            {error && (
              <p
                className="rounded-sm p-3 text-sm"
                style={{ background: 'rgba(220,38,38,0.08)', color: 'var(--danger)' }}
              >
                {/rejected|denied/i.test(error.message)
                  ? 'You cancelled the transaction.'
                  : 'Could not create the link. Please try again.'}
              </p>
            )}

            {wrongChain ? (
              <Button className="w-full" loading={switching} onClick={() => switchChain({ chainId })}>
                Switch to {networkName(chainId)}
              </Button>
            ) : (
              <Button
                className="w-full"
                disabled={!valid}
                loading={isPending || confirming}
                onClick={handleCreate}
              >
                {!(isPending || confirming) && <Link2 className="size-4" />}
                {isPending ? 'Confirm in your wallet…' : confirming ? 'Creating…' : 'Create payment link'}
              </Button>
            )}

            {txHash && confirming && (
              <a
                href={buildTxExplorerUrl(chainId, txHash)}
                target="_blank"
                rel="noreferrer"
                className="block text-center text-xs text-carbon"
              >
                View on explorer
              </a>
            )}
          </div>
        )}
      </Card>

      {/* Live receipt preview — only when form is visible */}
      {!!wallet && !created && (
        <ReceiptPreview amount={amount} label={label} />
      )}
    </div>
  )
}
