// Runs a recovery plan on the foreign chain. Chain access is injected so the
// exact transaction sequence is unit-tested without a wallet or RPC.

import { erc20Abi, zeroAddress } from 'viem'
import { SLOT_ABI, SLOT_FACTORY_ABI, SLOT_VAULT_ABI, VAULT_FACTORY_ABI } from './abis'
import type { RecoveryStep, VaultSettings } from './recovery'

type Hex = `0x${string}`

export interface ChainIO {
  getCode(address: string): Promise<string | undefined>
  read(args: { address: Hex; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] }): Promise<unknown>
  write(args: { address: Hex; abi: readonly unknown[]; functionName: string; args?: readonly unknown[]; chainId: number }): Promise<Hex>
  wait(hash: Hex): Promise<void>
  /** EIP-191 signature over a raw 32-byte digest by the connected wallet */
  signMessage(digest: Hex): Promise<Hex>
}

const hasCode = (c: string | undefined) => !!c && c !== '0x'

export async function probeRecovery(io: ChainIO, p: { factory: string; slot: string; vault?: string }) {
  const [factory, slot, vault] = await Promise.all([
    io.getCode(p.factory),
    io.getCode(p.slot),
    p.vault ? io.getCode(p.vault) : Promise.resolve(undefined),
  ])
  return { factoryThere: hasCode(factory), slotThere: hasCode(slot), vaultThere: hasCode(vault) }
}

/** maxReimbursement for the recovery slot; must be >= the factory tip (0.002 USDC). Unused off Arc. */
const RECOVERY_MAX_REIMBURSEMENT = 50_000n

export async function executeRecovery(
  io: ChainIO,
  p: {
    steps: RecoveryStep[]
    chainId: number
    usdc: string
    factory: string
    vaultFactory: string
    slot: string
    merchant: string
    payRef: string
    wallet: string
    vault?: VaultSettings & { address: string }
  },
  onStep?: (step: RecoveryStep) => void,
): Promise<{ recovered: bigint }> {
  if (p.steps.includes('withdraw') && !p.vault) throw new Error('Vault details are needed to withdraw recovered funds')
  const send = async (args: Parameters<ChainIO['write']>[0]) => io.wait(await io.write(args))
  const balanceOf = (who: string) =>
    io.read({ address: p.usdc as Hex, abi: erc20Abi, functionName: 'balanceOf', args: [who] }) as Promise<bigint>

  let recovered = 0n
  for (const step of p.steps) {
    onStep?.(step)
    if (step === 'createVault') {
      const v = p.vault!
      await send({
        address: p.vaultFactory as Hex, abi: VAULT_FACTORY_ABI, functionName: 'createVault', chainId: p.chainId,
        args: [v.owner, v.pqKey, v.twoKey, BigInt(v.recoveryDelay), v.salt],
      })
    } else if (step === 'createSlot') {
      await send({
        address: p.factory as Hex, abi: SLOT_FACTORY_ABI, functionName: 'createSlot', chainId: p.chainId,
        args: [p.merchant, p.payRef, 0, zeroAddress, RECOVERY_MAX_REIMBURSEMENT],
      })
    } else if (step === 'collect') {
      recovered = await balanceOf(p.slot)
      await send({ address: p.slot as Hex, abi: SLOT_ABI, functionName: 'sweep', chainId: p.chainId })
    } else {
      // Off Arc the vault releases funds with the owner wallet's signature alone.
      const vault = p.vault!.address as Hex
      const amount = await balanceOf(vault)
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
      const digest = (await io.read({
        address: vault, abi: SLOT_VAULT_ABI, functionName: 'withdrawDigest',
        args: [p.wallet, amount, 0n, deadline],
      })) as Hex
      const ownerSig = await io.signMessage(digest)
      await send({
        address: vault, abi: SLOT_VAULT_ABI, functionName: 'withdraw', chainId: p.chainId,
        args: [p.wallet, amount, 0n, deadline, '0x', ownerSig],
      })
    }
  }
  return { recovered }
}
