import { useEffect, useRef, useState } from 'react'
import { useAccount, usePublicClient, useReadContracts, useSignMessage, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { erc20Abi, isAddress, toHex } from 'viem'
import { AlertTriangle, Atom, Download, KeyRound, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { SLOT_VAULT_ABI, VAULT_FACTORY_ABI } from '@/lib/abis'
import { type SupportedChainId, USDC_ADDRESS, getVaultFactoryAddress, shortAddr } from '@/lib/chains'
import { formatUsdc6, parseUsdc6 } from '@/lib/slot-logic'
import { backupText, decryptSeed, encryptSeed, newVaultSeed, parseBackup, signDigest, vaultKeyFromSeed } from '@/lib/pq'
import { type VaultRecord, loadVault, saveVault } from '@/lib/vault-store'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { Button, Card, CopyButton, Field, inputClass, inputStyle } from './ui'

const RECOVERY_DELAY = 7n * 24n * 60n * 60n // 7 days
const ZERO32 = `0x${'00'.repeat(32)}`
type Hex = `0x${string}`

interface VaultCardProps {
  chainId: SupportedChainId
  onVaultChange: (vault: string | null) => void
}

interface PendingVault {
  seed: Hex
  vk: Hex
  box: string
  salt: Hex
  predicted: Hex
}

/** Let the browser paint the "signing…" state before the ~1s SLH-DSA signature. */
const nextFrame = () => new Promise((r) => setTimeout(r, 30))

export function VaultCard({ chainId, onVaultChange }: VaultCardProps) {
  const { address: wallet } = useAccount()
  const publicClient = usePublicClient({ chainId })
  const { signMessageAsync } = useSignMessage()
  const factory = getVaultFactoryAddress(chainId)

  // The vault for this wallet + network. Read from device storage during render;
  // a just-created/restored vault is kept in state in case storage is unavailable.
  const storeKey = wallet ? `${chainId}:${wallet.toLowerCase()}` : ''
  const [localRecord, setLocalRecord] = useState<{ key: string; record: VaultRecord } | null>(null)
  const record = localRecord?.key === storeKey ? localRecord.record : wallet ? loadVault(chainId, wallet) : null
  const setRecord = (r: VaultRecord) => setLocalRecord({ key: storeKey, record: r })

  // Withdraw / cancel forms
  const [form, setForm] = useState<'withdraw' | 'cancel' | null>(null)
  const [amount, setAmount] = useState('')
  const [to, setTo] = useState('')
  const [unlockPw, setUnlockPw] = useState('')

  const { writeContract, data: txHash, isPending, error: txError, reset } = useWriteContract()
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash, chainId })
  const action = useRef<'create' | 'withdraw' | 'cancel' | null>(null)
  const handled = useRef<string | undefined>(undefined)
  const pendingRef = useRef<PendingVault | null>(null)

  const [step, setStep] = useState<'intro' | 'password' | 'backup' | 'restore'>('intro')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [pending, setPending] = useState<PendingVault | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [restoreText, setRestoreText] = useState('')

  // Live vault state (view calls only).
  const vault = record?.vault as Hex | undefined
  const { data, refetch } = useReadContracts({
    contracts: vault
      ? [
          { address: USDC_ADDRESS, abi: erc20Abi, functionName: 'balanceOf', args: [vault], chainId },
          { address: vault, abi: SLOT_VAULT_ABI, functionName: 'pqKey', chainId },
          { address: vault, abi: SLOT_VAULT_ABI, functionName: 'pendingKey', chainId },
          { address: vault, abi: SLOT_VAULT_ABI, functionName: 'recoveryReadyAt', chainId },
          { address: vault, abi: SLOT_VAULT_ABI, functionName: 'twoKey', chainId },
        ]
      : [],
    query: { enabled: !!vault, refetchInterval: 6_000 },
  })
  const balance = data?.[0]?.result
  const pendingKey = data?.[2]?.result as string | undefined
  const readyAt = data?.[3]?.result
  const twoKey = (data?.[4]?.result) ?? true
  const recoveryPending = !!pendingKey && pendingKey !== ZERO32

  // Report each confirmed tx once.
  useEffect(() => {
    if (!isSuccess || !txHash || handled.current === txHash || !wallet) return
    handled.current = txHash
    if (action.current === 'create' && pendingRef.current) {
      const r: VaultRecord = { chainId, owner: wallet, vault: pendingRef.current.predicted, box: pendingRef.current.box }
      saveVault(r)
      setLocalRecord({ key: storeKey, record: r })
      setPending(null)
      pendingRef.current = null
      onVaultChange(r.vault)
      toast.success('Quantum-safe vault created')
    } else if (action.current === 'withdraw') {
      toast.success('Withdrawal sent')
      setForm(null)
    } else if (action.current === 'cancel') {
      toast.success('Recovery cancelled')
      setForm(null)
    }
    action.current = null
    void refetch()
  }, [isSuccess, txHash, wallet, chainId, onVaultChange, refetch, storeKey])

  if (!wallet) return null

  if (!factory) {
    return null
  }

  const withdrawTo = (to || wallet) as Hex
  const amountRaw = parseUsdc6(amount)
  const canWithdraw =
    !!record && amountRaw !== null && amountRaw > 0n && balance !== undefined && amountRaw <= balance &&
    isAddress(withdrawTo) && unlockPw.length > 0 && !busy && !isPending && !confirming

  async function unlock(): Promise<Hex | null> {
    try {
      return await decryptSeed(record!.box, unlockPw)
    } catch {
      setErr('Wrong password')
      setBusy(null)
      return null
    }
  }

  async function handleWithdraw() {
    if (!record || amountRaw === null || !publicClient) return
    setErr(null)
    setBusy('Unlocking your key…')
    const seed = await unlock()
    if (!seed) return
    try {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
      const digest = (await publicClient.readContract({
        address: record.vault as Hex,
        abi: SLOT_VAULT_ABI,
        functionName: 'withdrawDigest',
        args: [withdrawTo, amountRaw, 0n, deadline],
      }))
      setBusy('Creating quantum-safe signature…')
      await nextFrame()
      const pqSig = signDigest(seed, digest)
      let ownerSig: Hex = '0x'
      if (twoKey) {
        setBusy('Confirm the signature in your wallet…')
        ownerSig = await signMessageAsync({ message: { raw: digest } })
      }
      setBusy(null)
      action.current = 'withdraw'
      writeContract({
        address: record.vault as Hex,
        abi: SLOT_VAULT_ABI,
        functionName: 'withdraw',
        args: [withdrawTo, amountRaw, 0n, deadline, pqSig, ownerSig],
        chainId,
      })
    } catch (e) {
      setBusy(null)
      setErr(/rejected|denied/i.test(String(e)) ? 'You cancelled the signature.' : 'Could not prepare the withdrawal. Try again.')
    }
  }

  async function handleCancelRecovery() {
    if (!record || !publicClient) return
    setErr(null)
    setBusy('Unlocking your key…')
    const seed = await unlock()
    if (!seed) return
    try {
      const digest = (await publicClient.readContract({
        address: record.vault as Hex,
        abi: SLOT_VAULT_ABI,
        functionName: 'cancelDigest',
      }))
      setBusy('Creating quantum-safe signature…')
      await nextFrame()
      const pqSig = signDigest(seed, digest)
      setBusy(null)
      action.current = 'cancel'
      writeContract({ address: record.vault as Hex, abi: SLOT_VAULT_ABI, functionName: 'cancelRecovery', args: [pqSig], chainId })
    } catch {
      setBusy(null)
      setErr('Could not cancel the recovery. Try again.')
    }
  }

  // ─── Setup ─────────────────────────────────────────────────────────────────
  async function handleGenerate() {
    if (!publicClient || !factory) return
    setErr(null)
    setBusy('Generating your quantum-safe key…')
    await nextFrame()
    try {
      const seed = newVaultSeed()
      const vk = vaultKeyFromSeed(seed)
      const box = await encryptSeed(seed, pw)
      const salt = toHex(crypto.getRandomValues(new Uint8Array(32)))
      const predicted = (await publicClient.readContract({
        address: factory,
        abi: VAULT_FACTORY_ABI,
        functionName: 'predict',
        args: [wallet as Hex, vk, true, RECOVERY_DELAY, salt],
      }))
      const p = { seed, vk, box, salt, predicted }
      setPending(p)
      pendingRef.current = p
      setStep('backup')
    } catch {
      setErr('Could not generate the key. Try again.')
    } finally {
      setBusy(null)
    }
  }

  function handleCreate() {
    if (!pending || !factory) return
    action.current = 'create'
    writeContract({
      address: factory,
      abi: VAULT_FACTORY_ABI,
      functionName: 'createVault',
      args: [wallet as Hex, pending.vk, true, RECOVERY_DELAY, pending.salt],
      chainId,
    })
  }

  function downloadBackup(text: string, vaultAddr: string) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `slot-vault-${vaultAddr.slice(2, 8)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleRestore() {
    if (!publicClient || !wallet) return
    setErr(null)
    setBusy('Checking your backup…')
    try {
      const b = parseBackup(restoreText)
      if (b.chainId !== chainId) throw new Error('This backup is for a different network')
      const [onchainKey, owner] = await Promise.all([
        publicClient.readContract({ address: b.vault as Hex, abi: SLOT_VAULT_ABI, functionName: 'pqKey' }),
        publicClient.readContract({ address: b.vault as Hex, abi: SLOT_VAULT_ABI, functionName: 'owner' }),
      ])
      if (String(onchainKey).toLowerCase() !== vaultKeyFromSeed(b.seed).toLowerCase()) throw new Error('This backup no longer matches the vault key')
      if (String(owner).toLowerCase() !== wallet.toLowerCase()) throw new Error('This vault belongs to a different wallet')
      const r: VaultRecord = { chainId, owner: wallet, vault: b.vault, box: await encryptSeed(b.seed, pw) }
      saveVault(r)
      setRecord(r)
      onVaultChange(r.vault)
      toast.success('Vault restored on this device')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not restore the backup')
    } finally {
      setBusy(null)
    }
  }

  const pwOk = pw.length >= 8 && pw === pw2
  const working = !!busy || isPending || confirming

  // ─── No vault yet ──────────────────────────────────────────────────────────
  if (!record) {
    return (
      <Card>
        <div className="flex items-center gap-2 mb-1">
          <Atom className="size-5" style={{ color: 'var(--accent)' }} />
          <h2 className="display text-lg font-semibold">Quantum-safe vault</h2>
        </div>
        <p className="text-sm mb-4" style={{ color: 'var(--subtle)' }}>
          Payments land in a vault that only moves money with two keys: your wallet and a quantum-safe key kept on this device.
          A stolen wallet key alone can't take your funds.
        </p>

        {step === 'intro' && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setStep('password')}><ShieldCheck className="size-4" /> Set up vault</Button>
            <Button variant="ghost" onClick={() => setStep('restore')}>Restore from backup</Button>
          </div>
        )}

        {(step === 'password' || step === 'restore') && (
          <div className="space-y-3">
            {step === 'restore' && (
              <Field id="vault-restore" label="Backup file contents" hint="Paste the contents of your slot-vault backup file.">
                <textarea id="vault-restore" rows={4} value={restoreText} onChange={(e) => setRestoreText(e.target.value)} className={`${inputClass} mono text-xs`} style={inputStyle()} />
              </Field>
            )}
            <Field id="vault-pw" label="Vault password" hint="Encrypts your key on this device. At least 8 characters.">
              <input id="vault-pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} className={inputClass} style={inputStyle()} />
            </Field>
            <Field id="vault-pw2" label="Confirm password" error={pw2 && pw !== pw2 ? "Passwords don't match" : undefined}>
              <input id="vault-pw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} className={inputClass} style={inputStyle(!!pw2 && pw !== pw2)} />
            </Field>
            {step === 'password' ? (
              <Button className="w-full" disabled={!pwOk} loading={!!busy} onClick={() => void handleGenerate()}>
                {busy ?? <><KeyRound className="size-4" /> Generate key</>}
              </Button>
            ) : (
              <Button className="w-full" disabled={!pwOk || !restoreText.trim()} loading={!!busy} onClick={() => void handleRestore()}>
                {busy ?? 'Restore vault'}
              </Button>
            )}
          </div>
        )}

        {step === 'backup' && pending && (
          <div className="space-y-3">
            <p className="text-sm font-semibold">Save your backup</p>
            <p className="text-xs" style={{ color: 'var(--subtle)' }}>
              Your key exists only on this device. Without the backup you can still recover the vault with your wallet after a 7-day waiting period.
            </p>
            <div className="rounded-xl p-3 text-xs" style={{ background: 'var(--surface-muted)' }}>
              <p style={{ color: 'var(--subtle)' }}>Vault address</p>
              <p className="mono break-all">{pending.predicted}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => downloadBackup(backupText({ vault: pending.predicted, chainId, seed: pending.seed }), pending.predicted)}>
                <Download className="size-4" /> Download
              </Button>
              <CopyButton text={backupText({ vault: pending.predicted, chainId, seed: pending.seed })} label="Copy backup" />
            </div>
            <label htmlFor="vault-saved" className="flex items-center gap-2 text-sm">
              <input id="vault-saved" type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
              I saved my backup somewhere safe
            </label>
            <Button className="w-full" disabled={!saved || working} loading={isPending || confirming} onClick={handleCreate}>
              {isPending ? 'Confirm in your wallet…' : confirming ? 'Creating vault…' : 'Create vault'}
            </Button>
          </div>
        )}

        {(err || txError) && (
          <p className="mt-3 text-sm" style={{ color: 'var(--danger)' }}>
            {err ?? (/rejected|denied/i.test(txError!.message) ? 'You cancelled the transaction.' : 'Transaction failed. Try again.')}
          </p>
        )}
      </Card>
    )
  }

  // ─── Existing vault ────────────────────────────────────────────────────────
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Atom className="size-5" style={{ color: 'var(--accent)' }} />
            <h2 className="display text-lg font-semibold whitespace-nowrap">Quantum-safe vault</h2>
          </div>
          <p className="mono text-xs mt-0.5" style={{ color: 'var(--subtle)' }}>{shortAddr(record.vault)}</p>
        </div>
        <span className="px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap" style={{ background: 'rgba(141,216,159,0.14)', color: 'var(--success)' }}>
          {twoKey ? 'Quantum-safe key + your wallet' : 'Quantum-safe key'}
        </span>
      </div>

      <p data-testid="vault-balance" className="display text-3xl font-bold mt-4 tabular-nums">
        {balance !== undefined ? formatUsdc6(balance) : '…'} <span className="text-base font-semibold" style={{ color: 'var(--subtle)' }}>USDC</span>
      </p>

      {recoveryPending && (
        <div className="mt-4 rounded-xl p-3 text-sm flex gap-2" style={{ background: 'rgba(232,109,122,0.1)', color: 'var(--danger)' }}>
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <div className="space-y-2">
            <p>
              A key recovery was started and completes {readyAt ? new Date(Number(readyAt) * 1000).toLocaleString() : 'soon'}.
              If you didn't start it, cancel it now with your vault key.
            </p>
            {form !== 'cancel' && <Button variant="secondary" onClick={() => { setForm('cancel'); setErr(null) }}>Cancel recovery</Button>}
          </div>
        </div>
      )}

      {form === null && (
        <div className="mt-4 flex gap-2">
          <Button onClick={() => { setForm('withdraw'); setErr(null) }}>Withdraw</Button>
          <CopyButton text={record.vault} label="Copy address" />
        </div>
      )}

      {form !== null && (
        <div className="mt-4 space-y-3">
          {form === 'withdraw' && (
            <>
              <Field id="vault-amount" label="Amount (USDC)" error={amountRaw !== null && balance !== undefined && amountRaw > balance ? 'More than the vault holds' : undefined}>
                <input id="vault-amount" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(',', '.'))} className={inputClass} style={inputStyle()} />
              </Field>
              <Field id="vault-to" label="Send to" hint="Defaults to your connected wallet.">
                <input id="vault-to" placeholder={wallet} spellCheck={false} value={to} onChange={(e) => setTo(e.target.value.trim())} className={`${inputClass} mono text-sm`} style={inputStyle(!!to && !isAddress(to))} />
              </Field>
            </>
          )}
          <Field id="vault-unlock" label="Vault password">
            <input id="vault-unlock" type="password" autoComplete="current-password" value={unlockPw} onChange={(e) => setUnlockPw(e.target.value)} className={inputClass} style={inputStyle()} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => { setForm(null); setErr(null); reset() }}>Back</Button>
            {form === 'withdraw' ? (
              <Button disabled={!canWithdraw} loading={working} onClick={() => void handleWithdraw()}>
                {busy ?? (isPending ? 'Confirm…' : confirming ? 'Sending…' : 'Sign & withdraw')}
              </Button>
            ) : (
              <Button disabled={!unlockPw || working} loading={working} onClick={() => void handleCancelRecovery()}>
                {busy ?? (isPending ? 'Confirm…' : confirming ? 'Cancelling…' : 'Sign & cancel')}
              </Button>
            )}
          </div>
          {busy && <p className="text-xs text-center" style={{ color: 'var(--subtle)' }}>{busy}</p>}
        </div>
      )}

      {(err || txError) && (
        <p className="mt-3 text-sm" style={{ color: 'var(--danger)' }}>
          {err ?? (/rejected|denied/i.test(txError!.message) ? 'You cancelled the transaction.' : 'Transaction failed. Try again.')}
        </p>
      )}
      {txHash && isSuccess && (
        <a href={buildTxExplorerUrl(chainId, txHash)} target="_blank" rel="noreferrer" className="block mt-2 text-xs" style={{ color: 'var(--accent)' }}>
          View transaction
        </a>
      )}
    </Card>
  )
}
