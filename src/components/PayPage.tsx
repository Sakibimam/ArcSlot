import { useEffect, useState } from 'react'
import { useAccount, useBytecode, useReadContract, useReadContracts, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { type ContractFunctionParameters, erc20Abi, zeroAddress } from 'viem'
import { QRCodeSVG } from 'qrcode.react'
import { AlertTriangle, Atom, BadgeCheck, CircleCheck, Shuffle, ExternalLink, QrCode, ShieldCheck, Wallet } from 'lucide-react'
import { SLOT_ABI, SLOT_FACTORY_ABI, SLOT_VAULT_ABI } from '@/lib/abis'
import type { ChainRequest } from '@/lib/use-chain-requests'
import {
  ARC_TESTNET_ID,
  type SupportedChainId,
  LEGACY_FACTORY_ADDRESSES,
  SLOT_VAULT_IMPL,
  TESTNET_FAUCET_URL,
  USDC_ADDRESS,
  getFactoryAddress,
  networkName,
  shortAddr,
} from '@/lib/chains'
import { formatUsdc6, isMinimalProxyTo, isRequestPaid, parseUsdc6, requestTrust, sanitizeLabel } from '@/lib/slot-logic'
import { buildAddressExplorerUrl, buildTxExplorerUrl } from '@/onchain-facts'
import { Button, Card, CopyButton, Field, NetworkBadge, inputClass, inputStyle } from './ui'
import { CrossChainPay } from './CrossChainPay'

interface PayPageProps {
  chainId: SupportedChainId
  slot: string
  amount: bigint | undefined
  label: string | undefined
}

export function PayPage({ chainId, slot, amount: linkAmount, label: linkLabel }: PayPageProps) {
  const testnet = chainId === ARC_TESTNET_ID
  const network = networkName(chainId)
  const addr = slot as `0x${string}`
  const { address: wallet, chainId: walletChain } = useAccount()
  const { switchChain, isPending: switching } = useSwitchChain()
  const [mode, setMode] = useState<'wallet' | 'crosschain' | 'manual'>('wallet')
  const [typed, setTyped] = useState('')

  // Everything that matters comes from the chain, never from the link: who gets
  // paid (the slot), what was received and collected, and the request itself.
  const factory = getFactoryAddress(chainId)
  // Mixed ABIs in one batch: typed as plain call descriptors, results narrowed below.
  const contracts: (ContractFunctionParameters & { chainId: number })[] = [
    { address: addr, abi: SLOT_ABI, functionName: 'merchant', chainId },
      { address: USDC_ADDRESS, abi: erc20Abi, functionName: 'balanceOf', args: [addr], chainId },
      { address: addr, abi: SLOT_ABI, functionName: 'totalCollected', chainId },
      // No factory on this network: the read fails harmlessly and links fall back to their own values.
      { address: factory ?? zeroAddress, abi: SLOT_FACTORY_ABI, functionName: 'requestOf', args: [addr], chainId },
      // Anyone can deploy a contract that answers merchant() with a famous payee
      // and keeps the money; only slots this factory deployed are payable.
      { address: factory ?? zeroAddress, abi: SLOT_FACTORY_ABI, functionName: 'isSlot', args: [addr], chainId },
      ...LEGACY_FACTORY_ADDRESSES[chainId].map((f) => ({ address: f, abi: SLOT_FACTORY_ABI, functionName: 'isSlot', args: [addr], chainId })),
  ]
  // Poll while waiting for payment; stop once it's paid (1,000 open pages would
  // otherwise keep hammering the RPC). Hidden tabs don't poll (react-query default).
  const { data, isError, isLoading } = useReadContracts({
    contracts,
    query: {
      refetchInterval: (query) => {
        const d = query.state.data as { result?: unknown }[] | undefined
        const [bal, col, req] = [d?.[1]?.result, d?.[2]?.result, d?.[3]?.result as ChainRequest | undefined]
        const want = req?.exists ? (req.amount > 0n ? req.amount : undefined) : linkAmount
        const paid = typeof bal === 'bigint' && typeof col === 'bigint' && want !== undefined && isRequestPaid(want, bal, col)
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
  const invalid = isError || (!isLoading && data !== undefined && (!merchant || !isFactorySlot))

  // On-chain request data wins; link values are only a fallback for older links.
  const requested = request ? (request.amount > 0n ? request.amount : undefined) : linkAmount
  const rawLabel = request ? request.label : linkLabel
  const label = rawLabel === undefined ? undefined : sanitizeLabel(rawLabel)
  const now = useNow(30_000)
  const expired = !!request && request.expiresAt > 0n && now / 1000 > Number(request.expiresAt)

  // A payee that answers pqKey() is a SlotVault: show the protection to the payer.
  const { data: payeeKey } = useReadContract({
    address: merchant as `0x${string}` | undefined,
    abi: SLOT_VAULT_ABI,
    functionName: 'pqKey',
    chainId,
    query: { enabled: !!merchant },
  })
  // pqKey() alone can be faked; a real vault is a clone of the SlotVault implementation.
  const { data: payeeCode } = useBytecode({ address: merchant as `0x${string}` | undefined, chainId, query: { enabled: !!merchant } })
  const payeeIsVault =
    typeof payeeKey === 'string' && /^0x(?!0+$)[0-9a-f]{64}$/i.test(payeeKey) && isMinimalProxyTo(payeeCode, SLOT_VAULT_IMPL)
  const { data: vaultOwner } = useReadContract({
    address: merchant as `0x${string}` | undefined,
    abi: SLOT_VAULT_ABI,
    functionName: 'owner',
    chainId,
    query: { enabled: !!merchant && payeeIsVault },
  })
  const trust =
    request && merchant
      ? requestTrust({ creator: request.creator, merchant, vaultOwner: payeeIsVault ? (vaultOwner) : undefined })
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

  const fullyPaid = requested !== undefined && slotBalance !== undefined && isRequestPaid(requested, slotBalance, collected)

  if (invalid) {
    return (
      <Card className="text-center">
        <AlertTriangle className="size-8 mx-auto mb-3" style={{ color: 'var(--warning)' }} />
        <h1 className="display text-xl font-semibold">This payment link is not valid</h1>
        <p className="text-sm mt-2" style={{ color: 'var(--subtle)' }}>
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
      <Card>
        <div className="flex items-center justify-between gap-2 mb-4">
          <span className="text-sm" style={{ color: 'var(--subtle)' }}>Payment request</span>
          <NetworkBadge name={network} testnet={testnet} />
        </div>
        <h1 className="display text-2xl font-semibold break-words">{label || 'Payment'}</h1>
        {label && (
          <p className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>Description written by whoever created this request.</p>
        )}
        {requested !== undefined && (
          <p data-testid="pay-amount" className="display text-4xl font-bold mt-2 tabular-nums">
            {formatUsdc6(requested)} <span className="text-xl font-semibold" style={{ color: 'var(--subtle)' }}>USDC</span>
          </p>
        )}
        <div className="mt-4 flex items-center gap-2 text-sm" style={{ color: 'var(--muted)' }}>
          <ShieldCheck className="size-4 shrink-0" style={{ color: 'var(--success)' }} />
          <span>
            Pays to{' '}
            {merchant ? (
              <a href={buildAddressExplorerUrl(chainId, merchant)} target="_blank" rel="noreferrer" className="mono underline decoration-dotted">
                {shortAddr(merchant)}
              </a>
            ) : '…'}
            {' '}— fixed in the contract
          </span>
        </div>
        {trust === 'verified' && (
          <div className="mt-2 flex items-center gap-2 text-sm" style={{ color: 'var(--success)' }}>
            <BadgeCheck className="size-4 shrink-0" />
            <span>Created by the payee&apos;s own wallet</span>
          </div>
        )}
        {legacySlot && (
          <p className="mt-2 text-xs" style={{ color: 'var(--subtle)' }}>
            This request uses an earlier version of ArcSlot. Payments still reach the payee.
          </p>
        )}
        {trust === 'unverified' && (
          <p className="mt-3 flex gap-2 rounded-xl p-3 text-xs" style={{ background: 'rgba(245,201,122,0.1)', color: 'var(--warning)' }}>
            <AlertTriangle className="size-4 shrink-0" />
            <span>This request was created by someone other than the payee. Only pay if you trust whoever sent you this link.</span>
          </p>
        )}
        {payeeIsVault && (
          <div className="mt-2 flex items-center gap-2 text-sm" style={{ color: 'var(--success)' }}>
            <Atom className="size-4 shrink-0" />
            <span>Pays into a quantum-safe vault</span>
          </div>
        )}
      </Card>

      {!(fullyPaid || sent) && expired ? (
        <Card className="text-center">
          <AlertTriangle className="size-8 mx-auto mb-2" style={{ color: 'var(--warning)' }} />
          <h2 className="display text-xl font-semibold">This request expired</h2>
          <p className="text-sm mt-1" style={{ color: 'var(--subtle)' }}>
            It stopped accepting payments on {new Date(Number(request.expiresAt) * 1000).toLocaleString()}. Ask the merchant for a new link.
          </p>
        </Card>
      ) : fullyPaid || sent ? (
        <Card className="text-center">
          <CircleCheck className="size-10 mx-auto mb-2" style={{ color: 'var(--success)' }} />
          <h2 className="display text-xl font-semibold">{sent ? 'Payment sent' : 'Payment received'}</h2>
          <p className="text-sm mt-1" style={{ color: 'var(--subtle)' }}>
            {sent ? 'Arc confirms in under a second — you’re all set.' : 'The merchant has received the full amount.'}
          </p>
          {txHash && (
            <a href={buildTxExplorerUrl(chainId, txHash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm mt-3" style={{ color: 'var(--accent)' }}>
              View transaction <ExternalLink className="size-3.5" />
            </a>
          )}
        </Card>
      ) : (
        <Card>
          <div className="grid grid-cols-3 gap-1 rounded-2xl p-1 mb-5" style={{ background: 'var(--surface-muted)' }} role="tablist">
            {([
              ['wallet', 'Pay with wallet', Wallet],
              ['crosschain', 'Another chain', Shuffle],
              ['manual', 'Send manually', QrCode],
            ] as const).map(([key, text, Icon]) => (
              <button
                key={key}
                role="tab"
                aria-selected={mode === key}
                onClick={() => setMode(key)}
                className="flex items-center justify-center gap-1.5 rounded-xl px-1 py-2.5 text-xs sm:text-sm font-semibold transition-all"
                style={mode === key ? { background: 'var(--surface-strong)', color: 'var(--ink)' } : { color: 'var(--subtle)' }}
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
                <Field id="pay-amount-input" label="Amount to pay (USDC)">
                  <input
                    id="pay-amount-input"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={typed}
                    onChange={(e) => setTyped(e.target.value.replace(',', '.'))}
                    className={`${inputClass} display text-2xl font-semibold`}
                    style={inputStyle(typed !== '' && !typedRaw)}
                  />
                </Field>
              )}

              {!wallet ? (
                <div className="text-center space-y-3">
                  <p className="text-sm" style={{ color: 'var(--muted)' }}>Connect a wallet holding USDC on {network}.</p>
                  <div className="flex justify-center"><ConnectKitButton /></div>
                </div>
              ) : walletChain !== chainId ? (
                <Button className="w-full" loading={switching} onClick={() => switchChain({ chainId })}>
                  Switch to {network}
                </Button>
              ) : (
                <>
                  {typeof myBalance === 'bigint' && (
                    <p className="text-xs text-center" style={{ color: insufficient ? 'var(--danger)' : 'var(--subtle)' }}>
                      {insufficient ? 'Not enough USDC — ' : ''}You have {formatUsdc6(myBalance)} USDC
                    </p>
                  )}
                  <Button className="w-full text-base" disabled={!payAmount || insufficient} loading={isPending || confirming} onClick={pay}>
                    {isPending ? 'Confirm in your wallet…' : confirming ? 'Sending…' : payAmount ? `Pay ${formatUsdc6(payAmount)} USDC` : 'Enter an amount'}
                  </Button>
                  {error && (
                    <p className="text-xs text-center" style={{ color: 'var(--danger)' }}>
                      {/rejected|denied/i.test(error.message) ? 'You cancelled the payment.' : 'Payment failed. Please try again.'}
                    </p>
                  )}
                </>
              )}
              {testnet && (wallet === undefined || insufficient) && (
                <p className="text-xs text-center" style={{ color: 'var(--subtle)' }}>
                  Testing?{' '}
                  <a href={TESTNET_FAUCET_URL} target="_blank" rel="noreferrer" className="underline" style={{ color: 'var(--accent)' }}>
                    Get test USDC
                  </a>{' '}
                  (choose Arc Testnet).
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex justify-center">
                <div className="rounded-2xl p-3 bg-white">
                  <QRCodeSVG value={slot} size={168} />
                </div>
              </div>
              <p className="mono text-xs break-all rounded-xl p-3 text-center" style={{ background: 'var(--surface-muted)' }}>{slot}</p>
              <CopyButton text={slot} label="Copy address" variant="primary" className="w-full" />
              <p className="flex gap-2 rounded-xl p-3 text-xs" style={{ background: 'rgba(245,201,122,0.1)', color: 'var(--warning)' }}>
                <AlertTriangle className="size-4 shrink-0" />
                <span>
                  Send USDC on {network} (native or token){requested !== undefined ? <> — exactly <b>{formatUsdc6(requested)} USDC</b></> : null}. Sent the wrong token or network by mistake? The payee can still recover it.
                </span>
              </p>
            </div>
          )}

          {slotBalance !== undefined && slotBalance > 0n && !fullyPaid && (
            <p className="mt-4 text-xs text-center" style={{ color: 'var(--subtle)' }}>
              {formatUsdc6(slotBalance)} USDC received so far
            </p>
          )}
        </Card>
      )}
    </div>
  )
}

/** Current time, refreshed every `ms`, so expiry flips without a reload. */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}
