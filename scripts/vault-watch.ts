// Vault watcher: alert the owner when a key recovery starts on a SlotVault.
// A thief holding only the owner wallet can start one; it succeeds unless the
// PQ key cancels it in time, so run this somewhere that is always on.
//
//   VAULTS=0xVault1,0xVault2 bun scripts/vault-watch.ts            # loop
//   VAULTS=0x... bun scripts/vault-watch.ts --once                 # one check
//   WEBHOOK_URL=https://ntfy.sh/your-topic ...                     # also POST alerts
//   NETWORK=mainnet ...                                            # default: testnet
import { createPublicClient, http, isAddress, type Hex } from 'viem'
import { arc, arcTestnet } from 'viem/chains'
import { SLOT_VAULT_ABI } from '../src/lib/abis'
import { recoveryAlert } from '../src/lib/vault-watch'

const NETWORK = process.env.NETWORK === 'mainnet' ? 'mainnet' : 'testnet'
const chain = NETWORK === 'mainnet' ? arc : arcTestnet
const RPC = process.env.RPC ?? (NETWORK === 'mainnet' ? 'https://rpc.mainnet.arc.io' : 'https://rpc.testnet.arc.io')
const INTERVAL_MS = Number(process.env.INTERVAL_SECONDS ?? 300) * 1000
const WEBHOOK = process.env.WEBHOOK_URL

const vaults = (process.env.VAULTS ?? '').split(',').map((v) => v.trim()).filter(Boolean)
if (vaults.length === 0 || !vaults.every((v) => isAddress(v))) {
  console.error('Set VAULTS to one or more comma-separated vault addresses.')
  process.exit(1)
}
const pub = createPublicClient({ chain, transport: http(RPC) })

async function check(): Promise<number> {
  const now = BigInt(Math.floor(Date.now() / 1000))
  let alerts = 0
  for (const vault of vaults as Hex[]) {
    const [pendingKey, recoveryReadyAt] = await Promise.all([
      pub.readContract({ address: vault, abi: SLOT_VAULT_ABI, functionName: 'pendingKey' }),
      pub.readContract({ address: vault, abi: SLOT_VAULT_ABI, functionName: 'recoveryReadyAt' }),
    ])
    const alert = recoveryAlert({ pendingKey, recoveryReadyAt, now })
    if (!alert) { console.log(`ok       ${vault}`); continue }
    alerts++
    console.log(`${alert.level.padEnd(8)} ${vault}  ${alert.message}`)
    if (WEBHOOK) {
      await fetch(WEBHOOK, { method: 'POST', body: `[${alert.level}] ArcSlot vault ${vault}: ${alert.message}` }).catch((e: unknown) => {
        console.error('webhook failed:', e instanceof Error ? e.message : e)
      })
    }
  }
  return alerts
}

if (process.argv.includes('--once')) {
  process.exit((await check()) > 0 ? 2 : 0)
}
for (;;) {
  await check().catch((e: unknown) => console.error('check failed:', e instanceof Error ? e.message : e))
  await new Promise((r) => setTimeout(r, INTERVAL_MS))
}
