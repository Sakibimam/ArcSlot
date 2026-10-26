import { useRef, useState } from 'react'
import { useAccount, useSwitchChain } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import type { EIP1193Provider } from 'viem'
import { CircleCheck, Info } from 'lucide-react'
import { type SourceChain, sourceChainsFor } from '@/lib/crosschain'
import {
  type CrossChainQuote, type PaymentStep,
  quoteCrossChainPayment, retryCrossChainPayment, sendCrossChainPayment,
} from '@/lib/crosschain-pay'
import { formatUsdc6 } from '@/lib/slot-logic'
import { checkQuote } from '@/lib/crosschain'
import { Button, Field, inputClass, inputStyle } from './ui'

interface CrossChainPayProps {
  arcChainId: number
  slot: string
  amount: bigint | undefined
}

const STEP_TEXT: Record<PaymentStep, string> = {
  approve: 'Approving USDC in your wallet…',
  burn: 'Sending from your chain…',
  fetchAttestation: "Waiting for Circle's confirmation…",
  mint: 'Arriving on Arc…',
}

type Status = 'idle' | 'quoting' | 'quoted' | 'sending' | 'stopped' | 'sent'
type Result = Awaited<ReturnType<typeof sendCrossChainPayment>>

export function CrossChainPay({ arcChainId, slot, amount }: CrossChainPayProps) {
  const { address: wallet, connector } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const sources = sourceChainsFor(arcChainId)
  const [sourceKey, setSourceKey] = useState(sources[0].key)
  const source = sources.find((s) => s.key === sourceKey) as SourceChain
  const [status, setStatus] = useState<Status>('idle')
  const [quote, setQuote] = useState<CrossChainQuote | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [step, setStep] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const burned = useRef(false)

  const provider = async () =>
    (await (connector as { getProvider: () => Promise<unknown> }).getProvider()) as EIP1193Provider

  async function review() {
    if (!amount) return
    setError(null); setStatus('quoting')
    try {
      await switchChainAsync({ chainId: source.chainId })
      const q = await quoteCrossChainPayment({ provider: await provider(), source: source.key, slot, amount, arcChainId })
      if (!checkQuote(q.summary, amount).ok) {
        setStatus('idle')
        setError(`This quote would deliver ${formatUsdc6(q.summary.receives)} USDC, not the requested ${formatUsdc6(amount)}. Nothing was sent.`)
        return
      }
      setQuote(q); setStatus('quoted')
    } catch {
      setStatus('idle')
      setError(`Couldn't get a quote from ${source.name}. Check your wallet is on ${source.name} and try again.`)
    }
  }

  function settle(res: Result) {
    setResult(res); setStep(null)
    if (burned.current) return
    if (res.state === 'success') {
      setStatus('sent')
    } else {
      const failed = res.steps.find((s) => s.state === 'error')
      setStatus('stopped')
      setError(`The payment stopped at the ${failed?.name ?? 'last'} step. Your funds are safe; resume to finish it.`)
    }
  }

  async function pay() {
    if (!amount || !quote) return
    setError(null); setStatus('sending')
    try {
      settle(await sendCrossChainPayment({
        provider: await provider(), source: source.key, slot, amount, arcChainId, quote: quote.quote,
        onStep: (s) => {
          setStep(STEP_TEXT[s])
          if (s === 'burn') { burned.current = true; setStatus('sent') }
        },
      }))
    } catch (e) {
      if (burned.current) return
      setStatus('quoted')
      setError(/rejected|denied/i.test(String(e)) ? 'You cancelled the payment.' : 'Payment failed before anything was sent. Try again.')
    }
  }

  async function resume() {
    if (!result) return
    setError(null); setStatus('sending')
    try { settle(await retryCrossChainPayment(result, await provider())) }
    catch { setStatus('stopped'); setError('Could not resume yet. Wait a moment and try again.') }
  }

  if (status === 'sent') {
    return (
      <div className="text-center space-y-2 py-2">
        <CircleCheck className="size-8 mx-auto text-paid" />
        <p className="font-semibold text-ink">Payment on its way</p>
        <p className="text-sm text-ink/60">
          It lands on Arc in about 20 seconds. This page updates when it arrives.
        </p>
      </div>
    )
  }

  if (!wallet) {
    return (
      <div className="text-center space-y-3">
        <p className="text-sm text-ink/60">Connect a wallet that holds USDC on another chain.</p>
        <div className="flex justify-center"><ConnectKitButton /></div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Field id="xc-chain" label="Pay from">
        <select
          id="xc-chain"
          value={sourceKey}
          disabled={status === 'quoting' || status === 'sending'}
          onChange={(e) => { setSourceKey(e.target.value); setQuote(null); setStatus('idle'); setError(null) }}
          className={inputClass}
          style={inputStyle()}
        >
          {sources.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
        </select>
      </Field>

      {!amount && (
        <p className="text-xs text-ink/50">Enter an amount under "Pay with wallet" first.</p>
      )}

      {quote && (status === 'quoted' || status === 'sending' || status === 'stopped') && (
        <dl
          className="rounded-sm p-3 text-sm space-y-1.5"
          style={{ background: 'var(--paper)', border: '1px solid var(--rule)' }}
        >
          <div className="flex justify-between gap-3">
            <dt className="text-ink/50">You send on {source.name}</dt>
            <dd data-testid="xc-debit" className="font-mono">{formatUsdc6(quote.summary.debit)} USDC</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink/50">Network fee (Circle relayer)</dt>
            <dd data-testid="xc-fee" className="font-mono">{formatUsdc6(quote.summary.fee)} USDC</dd>
          </div>
          <p className="pt-1 font-medium text-paid">
            Merchant receives exactly {formatUsdc6(quote.summary.receives)} USDC
          </p>
          {amount !== undefined && amount > 0n && (() => {
            const c = checkQuote(quote.summary, amount)
            return c.ok && c.highFee ? (
              <p className="pt-1 text-xs" style={{ color: 'var(--amber)' }}>
                The network fee is {c.feePercent}% of this payment. Paying on Arc directly costs far less.
              </p>
            ) : null
          })()}
        </dl>
      )}

      {status === 'idle' || status === 'quoting' ? (
        <Button className="w-full" disabled={!amount} loading={status === 'quoting'} onClick={() => void review()}>
          {status === 'quoting' ? 'Getting a quote…' : 'Review payment'}
        </Button>
      ) : status === 'stopped' ? (
        <Button className="w-full" onClick={() => void resume()}>Resume payment</Button>
      ) : (
        <Button className="w-full" loading={status === 'sending'} onClick={() => void pay()}>
          {status === 'sending'
            ? step ?? 'Confirm in your wallet…'
            : `Pay ${formatUsdc6(quote!.summary.debit)} USDC from ${source.name}`}
        </Button>
      )}

      {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
      <p className="flex gap-2 text-xs text-ink/50">
        <Info className="size-4 shrink-0" />
        <span>
          Uses Circle&apos;s CCTP. You need USDC and a little gas on {source.name}. No Arc wallet
          or Arc gas needed.
        </span>
      </p>
    </div>
  )
}
