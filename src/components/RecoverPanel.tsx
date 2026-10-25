import { useState } from 'react'
import { useAccount, useReadContracts, useSignMessage, useSwitchChain, useWriteContract } from 'wagmi'
import { type ContractFunctionParameters, erc20Abi } from 'viem'
import { LifeBuoy } from 'lucide-react'
import { SLOT_ABI } from '@/lib/abis'
import { type SupportedChainId, getFactoryAddress, getVaultFactoryAddress } from '@/lib/chains'
import { type SourceChain, sourceChainsFor } from '@/lib/crosschain'
import { type RecoveryStep, planRecovery } from '@/lib/recovery'
import { executeRecovery, probeRecovery } from '@/lib/recovery-exec'
import { chainIO } from '@/lib/recovery-io'
import { formatUsdc6 } from '@/lib/slot-logic'
import { loadVault } from '@/lib/vault-store'
import { getUsdc } from '@/onchain-facts'
import { Button } from './ui'

type Hex = `0x${string}`

interface RecoverPanelProps {
  arcChainId: SupportedChainId
  slot: string
}

const STEP_TEXT: Record<RecoveryStep, (chain: string) => string> = {
  createVault: (c) => `Recreating your vault on ${c}…`,
  createSlot: (c) => `Deploying the payment address on ${c}…`,
  collect: () => 'Collecting…',
  withdraw: () => 'Sign in your wallet to release the funds…',
}

/** Finds USDC a payer sent to this Slot's address on another chain, and recovers it. */
export function RecoverPanel({ arcChainId, slot }: RecoverPanelProps) {
  const { address: wallet } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const { signMessageAsync } = useSignMessage()
  const chains = sourceChainsFor(arcChainId)
  const usdcOn = (c: SourceChain) => getUsdc(c.chainId)?.address as Hex

  // One batch: who the slot pays on Arc, its reference, and its USDC on every other chain.
  // Mixed ABIs in one batch: typed as plain call descriptors, results narrowed below.
  const contracts: (ContractFunctionParameters & { chainId: number })[] = [
    { address: slot as Hex, abi: SLOT_ABI, functionName: 'merchant', chainId: arcChainId },
    { address: slot as Hex, abi: SLOT_ABI, functionName: 'payRef', chainId: arcChainId },
    ...chains.map((c) => ({ address: usdcOn(c), abi: erc20Abi, functionName: 'balanceOf', args: [slot as Hex], chainId: c.chainId })),
  ]
  const { data, refetch } = useReadContracts({
    contracts,
    query: { refetchInterval: 30_000 },
  })
  const merchant = data?.[0]?.result as string | undefined
  const payRef = data?.[1]?.result as string | undefined
  const stray = chains
    .map((chain, i) => ({ chain, amount: data?.[2 + i]?.result }))
    .filter((s): s is { chain: SourceChain; amount: bigint } => typeof s.amount === 'bigint' && s.amount > 0n)

  const [busy, setBusy] = useState<string | null>(null)
  const [status, setStatus] = useState<Record<string, string>>({})
  const [recovered, setRecovered] = useState<Record<string, boolean>>({})

  if (!merchant || stray.length === 0) return null

  const record = wallet ? loadVault(arcChainId, wallet) : null
  const payout: 'wallet' | 'vault' | 'other' =
    wallet && merchant.toLowerCase() === wallet.toLowerCase() ? 'wallet'
      : record && merchant.toLowerCase() === record.vault.toLowerCase() ? 'vault'
        : 'other'
  const vault = record?.salt && record.pqKey && record.recoveryDelay
    ? { address: record.vault, owner: wallet!, pqKey: record.pqKey, twoKey: record.twoKey ?? true, recoveryDelay: record.recoveryDelay, salt: record.salt }
    : undefined

  async function recover(chain: SourceChain) {
    const factory = getFactoryAddress(arcChainId)
    const vaultFactory = getVaultFactoryAddress(arcChainId)
    if (!factory || !vaultFactory || !wallet || !payRef || !merchant) return
    const payee = merchant
    const say = (text: string) => setStatus((s) => ({ ...s, [chain.key]: text }))
    setBusy(chain.key)
    try {
      await switchChainAsync({ chainId: chain.chainId })
      const io = chainIO(chain.chainId, {
        write: (args) => writeContractAsync(args as never),
        signMessage: (digest) => signMessageAsync({ message: { raw: digest } }),
      })
      const found = await probeRecovery(io, {
        factory, slot, vault: payout === 'vault' ? record?.vault : undefined, wallet, merchant: payee, payRef,
      })
      const plan = planRecovery({ ...found, payout, vault })
      if (!plan.ok) {
        say(plan.reason === 'not-deployed'
          ? `Recovery isn't set up on ${chain.name} yet. It will work once Slot is deployed there.`
          : plan.reason === 'vault-settings-missing'
            ? 'Restore your vault backup on this device first; recovery needs its settings.'
            : plan.reason === 'not-creator'
              ? 'Switch to the wallet that created this request; only it can recover the payment.'
              : 'Only the payee can recover this.')
        return
      }
      const { recovered } = await executeRecovery(io, {
        steps: plan.steps, chainId: chain.chainId, usdc: usdcOn(chain), factory, vaultFactory,
        slot, merchant: payee, payRef, wallet, vault,
      }, (step) => say(STEP_TEXT[step](chain.name)))
      say(`Recovered ${formatUsdc6(recovered)} USDC on ${chain.name} to your wallet.`)
      setRecovered((r) => ({ ...r, [chain.key]: true }))
      void refetch()
      // Put the wallet back on Arc so the rest of the app keeps working.
      await switchChainAsync({ chainId: arcChainId }).catch(() => undefined)
    } catch (e) {
      say(/rejected|denied/i.test(String(e)) ? 'You cancelled the recovery.' : 'Recovery failed. Try again.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mt-3 space-y-2">
      {stray.map(({ chain, amount }) => (
        <div key={chain.key} className="rounded-xl p-3 text-xs space-y-2" style={{ background: 'rgba(245,201,122,0.1)', color: 'var(--warning)' }}>
          <p className="flex gap-2">
            <LifeBuoy className="size-4 shrink-0" />
            <span>{formatUsdc6(amount)} USDC was sent on {chain.name} by mistake.</span>
          </p>
          {recovered[chain.key] ? null : payout === 'other' ? (
            <p style={{ color: 'var(--subtle)' }}>Only the payee can recover this.</p>
          ) : (
            <Button variant="secondary" className="w-full" loading={busy === chain.key} disabled={!!busy} onClick={() => void recover(chain)}>
              Recover to my wallet
            </Button>
          )}
          {status[chain.key] && <p style={{ color: 'var(--muted)' }}>{status[chain.key]}</p>}
        </div>
      ))}
    </div>
  )
}
