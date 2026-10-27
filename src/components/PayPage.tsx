import { useEffect, useState } from 'react'
import {
  useAccount, useBytecode, useReadContract, useReadContracts,
  useSwitchChain, useWaitForTransactionReceipt, useWriteContract,
} from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { MainnetNote } from '@/components/MainnetNote'
import { explainSwitchError, isPhantom, walletAppLinks } from '@/lib/wallet-help'
import { type ContractFunctionParameters, erc20Abi, zeroAddress } from 'viem'
import { QRCodeSVG } from 'qrcode.react'
import {
  AlertTriangle, Atom, BadgeCheck,
  ExternalLink, QrCode, ShieldCheck, Shuffle, Wallet,
} from 'lucide-react'
import { SLOT_ABI, SLOT_FACTORY_ABI, SLOT_VAULT_ABI } from '@/lib/abis'
import type { ChainRequest } from '@/lib/use-chain-requests'
import {
  ARC_TESTNET_ID, type SupportedChainId, LEGACY_FACTORY_ADDRESSES,
  SLOT_VAULT_IMPL, TESTNET_FAUCET_URL, USDC_ADDRESS,
  getFactoryAddress, networkName, shortAddr,
} from '@/lib/chains'
import { formatUsdc6, isMinimalProxyTo, isRequestPaid, parseUsdc6, requestTrust, sanitizeLabel } from '@/lib/slot-logic'
import { buildAddressExplorerUrl, buildTxExplorerUrl } from '@/onchain-facts'
import { Button, Card, CopyButton, Field, NetworkBadge, inputClass, inputStyle } from './ui'
import { CrossChainPay } from './CrossChainPay'
import { PrintMark } from './Logo'

interface PayPageProps {
  chainId: SupportedChainId
  slot: string
  amount: bigint | undefined
  label: string | undefined
}

// ── PAID stamp — inline, beside the amount ────────────────────────────────────
function PaidStamp({ visible }: { visible: boolean }) {
  const prefersReduced = useState(
    () => typeof window !== 'undefined'
      ? (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false)
      : false
  )[0]

  if (!visible) return null
  return (
    <div
      aria-label="Paid"
      className="inline-flex select-none shrink-0"
      style={prefersReduced
        ? { opacity: 0.85, transform: 'rotate(-8deg)' }
        : undefined}
    >
      <div
        className={prefersReduced ? '' : 'animate-stamp-press'}
        style={prefersReduced ? undefined : { opacity: 0.85 }}
      >
        {/* Double-ring stamp */}
        <div
          className="border-[2.5px] border-serial p-[3px]"
          style={{ opacity: 0.85 }}
        >
          <div className="border-[1.5px] border-serial px-3 py-1">
            <span
              className="block dot text-[15px] tracking-[0.22em] text-serial leading-none"
            >
              PAID
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export function PayPage({ chainId, slot, amount: linkAmount, label: linkLabel }: PayPageProps) {
  const testnet = chainId === ARC_TESTNET_ID
  const network = networkName(chainId)
  const addr = slot as `0x${string}`
  const { address: wallet, chainId: walletChain, connector } = useAccount()
  const { switchChainAsync, isPending: switching } = useSwitchChain()
  const [switchError, setSwitchError] = useState<string | null>(null)
  const switchToArc = async () => {
    setSwitchError(null)
    try {
      await switchChainAsync({ chainId })
    } catch (e) {
      console.error('[ArcSlot] network switch failed', e)
      setSwitchError(explainSwitchError(e, { network, chainId, testnet, phantom: isPhantom(connector) }))
    }
  }
  // Phone browsers have no wallet: offer to reopen this page inside a wallet app.
  const [hasInjectedWallet] = useState(() => typeof window !== 'undefined' && 'ethereum' in window)
  const [mode, setMode] = useState<'wallet' | 'crosschain' | 'manual'>('wallet')
  const [typed, setTyped] = useState('')

  const factory = getFactoryAddress(chainId)
  const contracts: (ContractFunctionParameters & { chainId: number })[] = [
    { address: addr, abi: SLOT_ABI, functionName: 'merchant', chainId },
    { address: USDC_ADDRESS, abi: erc20Abi, functionName: 'balanceOf', args: [addr], chainId },
    { address: addr, abi: SLOT_ABI, functionName: 'totalCollected', chainId },
    { address: factory ?? zeroAddress, abi: SLOT_FACTORY_ABI, functionName: 'requestOf', args: [addr], chainId },
    { address: factory ?? zeroAddress, abi: SLOT_FACTORY_ABI, functionName: 'isSlot', args: [addr], chainId },
    ...LEGACY_FACTORY_ADDRESSES[chainId].map((f) => ({
      address: f, abi: SLOT_FACTORY_ABI, functionName: 'isSlot', args: [addr], chainId,
    })),
  ]
  const { data, isError, isLoading, refetch } = useReadContracts({
    contracts,
    query: {
      refetchInterval: (query) => {
        const d = query.state.data as { result?: unknown }[] | undefined
        const [bal, col, req] = [d?.[1]?.result, d?.[2]?.result, d?.[3]?.result as ChainRequest | undefined]
        const want = req?.exists ? (req.amount > 0n ? req.amount : undefined) : linkAmount
        const paid =
          typeof bal === 'bigint' &&
          typeof col === 'bigint' &&
          want !== undefined &&
          isRequestPaid(want, bal, col)
        return paid ? false : 6_000
      },
    },
  })
  const merchant = data?.[0]?.result as string | undefined
  const balRaw = data?.[1]?.result
  const slotBalance = typeof balRaw === 'bigint' ? balRaw : undefined
  const collectedRaw = data?.[2]?.result
  const collected = typeof collectedRaw === 'bigint' ? collectedRaw : 0n
  const chainReq = data?.[3]?.result as ChainRequest | undefined
  const request = chainReq?.exists ? chainReq : undefined
  const legacySlot = data?.[4]?.result !== true && !!data?.slice(5).some((r) => r?.result === true)
  const isFactorySlot = data?.[4]?.result === true || legacySlot
  // A failed request to Arc (rate limit, ad blocker, network) is NOT an invalid
  // link: say so and retry, instead of telling the payer the link is bad.
  const unreachable = isError && data === undefined
  const invalid = !unreachable && !isLoading && data !== undefined && (!merchant || !isFactorySlot)

  const requested = request ? (request.amount > 0n ? request.amount : undefined) : linkAmount
  const rawLabel = request ? request.label : linkLabel
  const label = rawLabel === undefined ? undefined : sanitizeLabel(rawLabel)
  const now = useNow(30_000)
  const expired = !!request && request.expiresAt > 0n && now / 1000 > Number(request.expiresAt)

  const { data: payeeKey } = useReadContract({
    address: merchant as `0x${string}` | undefined,
    abi: SLOT_VAULT_ABI,
    functionName: 'pqKey',
    chainId,
    query: { enabled: !!merchant },
  })
  const { data: payeeCode } = useBytecode({
    address: merchant as `0x${string}` | undefined,
    chainId,
    query: { enabled: !!merchant },
  })
  const payeeIsVault =
    typeof payeeKey === 'string' &&
    /^0x(?!0+$)[0-9a-f]{64}$/i.test(payeeKey) &&
    isMinimalProxyTo(payeeCode, SLOT_VAULT_IMPL)
  const { data: vaultOwner } = useReadContract({
    address: merchant as `0x${string}` | undefined,
    abi: SLOT_VAULT_ABI,
    functionName: 'owner',
    chainId,
    query: { enabled: !!merchant && payeeIsVault },
  })
  const trust =
    request && merchant
      ? requestTrust({
          creator: request.creator,
          merchant,
          vaultOwner: payeeIsVault ? vaultOwner : undefined,
        })
      : undefined

  const { data: myBalance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: wallet ? [wallet] : undefined,
    chainId,
    query: { enabled: !!wallet, refetchInterval: 6_000 },
  })

  const typedRaw = parseUsdc6(typed)
  const payAmount = requested ?? (typedRaw && typedRaw > 0n ? typedRaw : undefined)
  const insufficient = typeof myBalance === 'bigint' && payAmount !== undefined && myBalance < payAmount

  const { writeContract, data: txHash, isPending, error } = useWriteContract()
  const { isLoading: confirming, isSuccess: sent } = useWaitForTransactionReceipt({ hash: txHash, chainId })

  const fullyPaid =
    requested !== undefined &&
    slotBalance !== undefined &&
    isRequestPaid(requested, slotBalance, collected)

  if (unreachable) {
    return (
      <Card className="text-center">
        <AlertTriangle className="size-8 mx-auto mb-3" style={{ color: 'var(--amber)' }} />
        <h1 className="text-xl font-semibold text-ink">Can&apos;t reach Arc right now</h1>
        <p className="text-sm mt-2 text-ink/80">
          We&apos;re retrying automatically. If this keeps happening, check your connection or allow this site in your ad blocker.
        </p>
        <Button variant="secondary" className="mt-4" onClick={() => void refetch()}>Try again</Button>
      </Card>
    )
  }

  if (invalid) {
    return (
      <Card className="text-center">
        <AlertTriangle className="size-8 mx-auto mb-3 text-amber-600" style={{ color: 'var(--amber)' }} />
        <h1 className="text-xl font-semibold text-ink">This payment link is not valid</h1>
        <p className="text-sm mt-2 text-ink/80">
          It doesn&apos;t point to a payment request on {network}. Ask the merchant for a new link.
        </p>
      </Card>
    )
  }

  const pay = () => {
    if (!payAmount) return
    writeContract({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [addr, payAmount],
      chainId,
    })
  }

  return (
    <div className="space-y-4">
      <MainnetNote chainId={chainId} />
      {/* ── Receipt card ─────────────────────────────────────────────────── */}
      <div
        className="rounded-[16px] overflow-hidden"
        style={{
          background: 'var(--surface)',
          border: '1px solid rgba(11,42,33,0.10)',
          boxShadow: '0 30px 60px -20px rgba(11,42,33,0.25)',
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

        <div className="px-5 sm:px-6 py-5">
          {/* Network badge + status */}
          <div className="flex items-center justify-between gap-2 mb-4">
            <span className="serial text-[11px] text-serial">Payment request</span>
            <NetworkBadge name={network} testnet={testnet} />
          </div>

          {/* H1 = request label */}
          <h1 className="heading-tight text-[28px] leading-tight text-ink break-words">{label || 'Payment'}</h1>
          {label && (
            <p className="text-xs mt-1 text-ink/80">
              Description written by whoever created this request.
            </p>
          )}

          {/* Amount + inline PAID stamp */}
          {requested !== undefined && (
            <div className="flex items-center gap-3 mt-3 flex-wrap">
              <p
                data-testid="pay-amount"
                className="dot text-[44px] leading-none text-ink"
              >
                {formatUsdc6(requested)}{' '}
                <span className="serial text-[14px] text-ink/80">USDC</span>
              </p>
              <PaidStamp visible={!!(fullyPaid || sent)} />
            </div>
          )}

          {/* Trust indicators */}
          <div className="mt-4 space-y-2">
            <div className="flex items-center gap-2 text-sm text-ink/80">
              <ShieldCheck className="size-4 shrink-0 text-paid" />
              <span>
                Pays to{' '}
                {merchant ? (
                  <a
                    href={buildAddressExplorerUrl(chainId, merchant)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono underline decoration-dotted hover:text-carbon"
                  >
                    {shortAddr(merchant)}
                  </a>
                ) : '…'}
                {' '}— fixed in the contract
              </span>
            </div>
            {trust === 'verified' && (
              <div className="flex items-center gap-2 text-sm text-paid">
                <BadgeCheck className="size-4 shrink-0" />
                <span>Created by the payee&apos;s own wallet</span>
              </div>
            )}
            {payeeIsVault && (
              <div className="flex items-center gap-2 text-sm text-paid">
                <Atom className="size-4 shrink-0" />
                <span>Pays into a quantum-safe vault</span>
              </div>
            )}
            {legacySlot && (
              <p className="text-xs text-ink/80">
                This request uses an earlier version of ArcSlot. Payments still reach the payee.
              </p>
            )}
          </div>

          {trust === 'unverified' && (
            <div
              className="mt-3 flex gap-2 rounded-[12px] p-3 text-xs"
              style={{ background: 'rgba(154,91,0,0.08)', color: 'var(--amber)' }}
            >
              <AlertTriangle className="size-4 shrink-0" />
              <span>
                This request was created by someone other than the payee. Only pay if you trust
                whoever sent you this link.
              </span>
            </div>
          )}

          {/* Fallback stamp position when no fixed amount */}
          {requested === undefined && <PaidStamp visible={!!(fullyPaid || sent)} />}
        </div>

        {/* Torn bottom edge */}
        <div
          className="h-3 w-full"
          style={{
            background: 'var(--paper)',
            maskImage: 'radial-gradient(circle at 8px 0, transparent 6px, white 7px)',
            maskSize: '16px 100%',
            WebkitMaskImage: 'radial-gradient(circle at 8px 0, transparent 6px, white 7px)',
            WebkitMaskSize: '16px 100%',
          }}
        />
      </div>

      {/* ── Expiry / confirmation / payment panels ───────────────────────── */}
      {!(fullyPaid || sent) && expired ? (
        <Card className="text-center">
          <AlertTriangle className="size-8 mx-auto mb-2" style={{ color: 'var(--amber)' }} />
          <h2 className="text-xl font-semibold text-ink">This request expired</h2>
          <p className="text-sm mt-1 text-ink/80">
            It stopped accepting payments on{' '}
            {new Date(Number(request.expiresAt) * 1000).toLocaleString()}. Ask the merchant for a
            new link.
          </p>
        </Card>
      ) : fullyPaid || sent ? (
        <Card className="text-center">
          <PrintMark state="paid" className="size-16 mx-auto mb-1" />
          <h2 className="text-xl font-semibold text-ink">
            {sent ? 'Payment sent' : 'Payment received'}
          </h2>
          <p className="text-sm mt-1 text-ink/80">
            {sent
              ? 'Arc confirms in under a second — you\u2019re all set.'
              : 'The merchant has received the full amount.'}
          </p>
          {txHash && (
            <a
              href={buildTxExplorerUrl(chainId, txHash)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm mt-3 text-carbon"
            >
              View transaction <ExternalLink className="size-3.5" />
            </a>
          )}
        </Card>
      ) : (
        <Card>
          {/* Tab bar — pill segmented control */}
          <div
            className="grid grid-cols-3 gap-0.5 rounded-full p-1 mb-5"
            style={{ background: 'rgba(11,42,33,0.07)', border: '1px solid rgba(11,42,33,0.12)' }}
            role="tablist"
          >
            {(
              [
                ['wallet',      'Pay with wallet', Wallet],
                ['crosschain',  'Another chain',   Shuffle],
                ['manual',      'Send manually',   QrCode],
              ] as const
            ).map(([key, text, Icon]) => (
              <button
                key={key}
                role="tab"
                aria-selected={mode === key}
                onClick={() => setMode(key)}
                className="flex items-center justify-center gap-1.5 rounded-full px-1 py-2 text-xs sm:text-sm font-semibold transition-all"
                style={
                  mode === key
                    ? { background: 'var(--surface)', color: 'var(--ink)', boxShadow: '0 1px 3px rgba(11,42,33,0.15)' }
                    : { color: 'var(--muted-foreground)' }
                }
              >
                <Icon className="size-4" /> {text}
              </button>
            ))}
          </div>

          {mode === 'crosschain' ? (
            <CrossChainPay arcChainId={chainId} slot={slot} amount={payAmount} />
          ) : mode === 'wallet' ? (
            <div className="space-y-4">
              {requested === undefined && (
                <Field id="pay-amount-input" label="Amount to pay">
                  <input
                    id="pay-amount-input"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={typed}
                    onChange={(e) => setTyped(e.target.value.replace(',', '.'))}
                    className={`${inputClass} tabular text-2xl font-semibold`}
                    style={inputStyle(typed !== '' && !typedRaw)}
                  />
                </Field>
              )}
              {!wallet ? (
                <div className="text-center space-y-3">
                  <p className="text-sm text-ink/80">
                    Connect a wallet holding USDC on {network}.
                  </p>
                  <div className="flex justify-center">
                    <ConnectKitButton />
                  </div>
                  {!hasInjectedWallet && (
                    <div className="pt-2 space-y-2">
                      <p className="text-xs text-ink/80">On a phone? Open this page in your wallet app:</p>
                      <div className="flex justify-center gap-2">
                        {walletAppLinks(window.location.href).map((l) => (
                          <a
                            key={l.name}
                            href={l.href}
                            className="inline-flex h-10 items-center rounded-full border border-ink/20 px-4 text-sm font-semibold text-ink hover:bg-ink/[0.05]"
                          >
                            Open in {l.name}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : walletChain !== chainId ? (
                <div className="space-y-3">
                  <Button className="w-full" loading={switching} onClick={() => { void switchToArc() }}>
                    Switch to {network}
                  </Button>
                  {switchError && (
                    <div role="alert" className="rounded-[12px] border border-serial/25 bg-[#FDF2F0] p-3 text-sm text-ink space-y-2">
                      <p>{switchError}</p>
                      <p className="text-ink/80">Or pay another way:</p>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => setMode('crosschain')} className="rounded-full bg-ink px-3.5 py-1.5 text-xs font-semibold text-paper">Pay from another chain</button>
                        <button type="button" onClick={() => setMode('manual')} className="rounded-full border border-ink/25 px-3.5 py-1.5 text-xs font-semibold text-ink">Send manually</button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {typeof myBalance === 'bigint' && (
                    <p
                      className="text-xs text-center"
                      style={{ color: insufficient ? 'var(--danger)' : 'var(--muted-foreground)' }}
                    >
                      {insufficient ? 'Not enough USDC — ' : ''}You have {formatUsdc6(myBalance)} USDC
                    </p>
                  )}
                  <Button
                    className="w-full text-base"
                    disabled={!payAmount || insufficient || isPending || confirming}
                    onClick={pay}
                  >
                    {(isPending || confirming) && <PrintMark state="sending" tone="current" className="size-6" />}
                    {isPending
                      ? 'Confirm in your wallet…'
                      : confirming
                      ? 'Sending…'
                      : payAmount
                      ? `Pay ${formatUsdc6(payAmount)} USDC`
                      : 'Enter an amount'}
                  </Button>
                  {error && (
                    <p className="text-xs text-center" style={{ color: 'var(--danger)' }}>
                      {/rejected|denied/i.test(error.message)
                        ? 'You cancelled the payment.'
                        : 'Payment failed. Please try again.'}
                    </p>
                  )}
                </>
              )}
              {testnet && (wallet === undefined || insufficient) && (
                <p className="text-xs text-center text-ink/80">
                  Testing?{' '}
                  <a
                    href={TESTNET_FAUCET_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="underline text-carbon"
                  >
                    Get test USDC
                  </a>{' '}
                  (choose Arc Testnet).
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex justify-center">
                <div className="rounded-[14px] p-3 bg-white border border-rule">
                  <QRCodeSVG value={slot} size={168} />
                </div>
              </div>
              <p
                className="font-mono text-xs break-all rounded-[12px] p-3 text-center"
                style={{ background: 'var(--paper)', border: '1px solid rgba(11,42,33,0.10)' }}
              >
                {slot}
              </p>
              <CopyButton text={slot} label="Copy address" variant="primary" className="w-full" />
              <div
                className="flex gap-2 rounded-[12px] p-3 text-xs"
                style={{ background: 'rgba(154,91,0,0.08)', color: 'var(--amber)' }}
              >
                <AlertTriangle className="size-4 shrink-0" />
                <span>
                  Send USDC on {network} (native or token)
                  {requested !== undefined ? (
                    <> — exactly <b>{formatUsdc6(requested)} USDC</b></>
                  ) : null}
                  . Sent the wrong token or network by mistake? The payee can still recover it.
                </span>
              </div>
            </div>
          )}

          {slotBalance !== undefined && slotBalance > 0n && !fullyPaid && (
            <p className="mt-4 text-xs text-center text-ink/80">
              {formatUsdc6(slotBalance)} USDC received so far
            </p>
          )}
        </Card>
      )}
    </div>
  )
}

function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}
