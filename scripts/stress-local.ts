/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access -- CLI harness */
// Stress test: 1,000 simulated users against a LOCAL Arc node (arc-anvil).
// Never points at a public RPC — it refuses anything but localhost.
//
//   arc-anvil --port 8547 --chain-id 5042002 -a 1000 --balance 1000 -b 1 --block-base-fee-per-gas 20000000000 &
//   RPC=http://127.0.0.1:8547 PRIVATE_KEY=<anvil key 0> bash scripts/deploy-deterministic.sh
//   FACTORY=0x... bun scripts/stress-local.ts
//
// Roles: 400 merchants (2 requests each), 500 payers (native + token sends),
// 50 collector bots racing for every slot, 49 attackers. Then it checks every
// cent against the contracts' own events, and measures RPC polling load.
import { createPublicClient, createWalletClient, erc20Abi, http, parseEventLogs, type Hex } from 'viem'
import { mnemonicToAccount } from 'viem/accounts'
import { arcTestnet } from 'viem/chains'
import { SLOT_ABI, SLOT_FACTORY_ABI } from '../src/lib/abis'

const RPC = process.env.RPC ?? 'http://127.0.0.1:8547'
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(RPC)) throw new Error('stress-local only runs against a local node')
const FACTORY = process.env.FACTORY as Hex
if (!FACTORY) throw new Error('set FACTORY')
const USDC = '0x3600000000000000000000000000000000000000' as Hex
const MNEMONIC = 'test test test test test test test test test test test junk' // anvil's public test mnemonic
const N = 1_000

const chain = { ...arcTestnet, rpcUrls: { default: { http: [RPC] } } }
const transport = http(RPC, { batch: false, retryCount: 0, timeout: 60_000 })
const pub = createPublicClient({ chain, transport, pollingInterval: 250 })

const t0 = Date.now()
const log = (m: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s] ${m}`)
const rand = (n: number) => Math.floor(Math.random() * n)

log(`deriving ${N} accounts`)
const accounts = Array.from({ length: N }, (_, i) => mnemonicToAccount(MNEMONIC, { addressIndex: i }))
const wallets = accounts.map((account) => createWalletClient({ account, chain, transport }))
const merchants = accounts.slice(1, 401)
const payers = accounts.slice(401, 901)
const collectors = accounts.slice(901, 951)
const attackers = accounts.slice(951, 999)
const platform = accounts[999]
const W = (a: { address: Hex }) => wallets[accounts.indexOf(a as never)]

type Outcome = { ok: number; failed: number; reasons: Map<string, number>; latencies: number[] }
const outcome = (): Outcome => ({ ok: 0, failed: 0, reasons: new Map(), latencies: [] })
function note(o: Outcome, e: unknown) {
  o.failed++
  const msg = e instanceof Error ? (e.message.match(/reverted with the following reason:\s*\n?(.*)|Error: (\w+)\(|(\w+)\(\)/)?.slice(1).find(Boolean) ?? e.message.split('\n')[0]) : String(e)
  o.reasons.set(msg.slice(0, 80), (o.reasons.get(msg.slice(0, 80)) ?? 0) + 1)
}
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0 }
const report = (name: string, o: Outcome) =>
  log(`${name}: ${o.ok} ok, ${o.failed} failed  | latency p50 ${pct(o.latencies, 0.5)}ms p95 ${pct(o.latencies, 0.95)}ms p99 ${pct(o.latencies, 0.99)}ms` +
    (o.reasons.size ? `\n           reasons: ${[...o.reasons].map(([k, v]) => `${v}× ${k}`).join(' | ')}` : ''))

async function timed(o: Outcome, f: () => Promise<Hex>) {
  const s = Date.now()
  try {
    const hash = await f()
    const r = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 })
    if (r.status !== 'success') throw new Error('tx reverted')
    o.ok++
    o.latencies.push(Date.now() - s)
    return r
  } catch (e) { note(o, e); return undefined }
}

const balanceOf = (a: Hex) => pub.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [a] })

// ─── Phase 1: 400 merchants × 2 requests, all at once ──────────────────────
type Req = { slot: Hex; merchant: Hex; feeBps: number }
const requests: Req[] = []
const p1 = outcome()
log('phase 1: 800 payment requests from 400 merchants, concurrently')
await Promise.all(merchants.map(async (m, i) => {
  for (let k = 0; k < 2; k++) {
    const feeBps = i % 2 === 0 ? 0 : 100 + rand(200) // half the platform's merchants pay a 1-3% fee
    const payRef: Hex = `0x${(BigInt(i) * 10n + BigInt(k)).toString(16).padStart(64, "0")}`
    const feeTo: Hex = feeBps ? platform.address : '0x0000000000000000000000000000000000000000'
    const args = [m.address, payRef, feeBps, feeTo, 50_000n, 0n, `Stress #${i}.${k}`, 0n] as const
    const slot = await pub.readContract({ address: FACTORY, abi: SLOT_FACTORY_ABI, functionName: 'predict', args: [m.address, m.address, payRef] })
    const r = await timed(p1, () => W(m).writeContract({ address: FACTORY, abi: SLOT_FACTORY_ABI, functionName: 'createRequest', args }))
    if (r) requests.push({ slot, merchant: m.address, feeBps })
  }
}))
report('create', p1)

// ─── Phase 2: 500 payers pay, 40% native USDC, 60% ERC-20 ──────────────────
const paid = new Map<Hex, bigint>()
const p2 = outcome()
log(`phase 2: payments into ${requests.length} slots from 500 payers (native + token)`)
await Promise.all(payers.map(async (p, i) => {
  const mine = requests.filter((_, j) => j % payers.length === i)
  for (const r of mine.length ? mine : [requests[rand(requests.length)]]) {
    const amount = BigInt(100_000 + rand(50_000_000)) // 0.1 – 50 USDC
    const native = rand(10) < 4
    const rec = await timed(p2, () => native
      ? W(p).sendTransaction({ to: r.slot, value: amount * 1_000_000_000_000n })
      : W(p).writeContract({ address: USDC, abi: erc20Abi, functionName: 'transfer', args: [r.slot, amount] }))
    if (rec) paid.set(r.slot, (paid.get(r.slot) ?? 0n) + amount)
  }
}))
report('pay', p2)

// ─── Phase 3: 50 collector bots race for every slot; attackers try their tricks
const p3 = outcome()
const p3a = outcome()
log('phase 3: 50 collectors race to collect every slot; 48 attackers attack')
const receipts: { reward: bigint }[] = []
await Promise.all([
  ...collectors.map(async (c) => {
    for (const r of [...requests].sort(() => Math.random() - 0.5)) {
      if ((await balanceOf(r.slot)) < 100_000n) continue
      const rec = await timed(p3, () => W(c).writeContract({ address: r.slot, abi: SLOT_ABI, functionName: 'sweepFor', args: [c.address], gas: 400_000n }))
      if (rec) receipts.push({ reward: 0n })
    }
  }),
  ...attackers.map(async (a, i) => {
    const r = requests[rand(requests.length)]
    // grief collectors by sweeping "for the merchant", or credit someone else
    const victim = i % 2 ? r.merchant : collectors[rand(collectors.length)].address
    const rec = await timed(p3a, () => W(a).writeContract({ address: r.slot, abi: SLOT_ABI, functionName: 'sweepFor', args: [victim], gas: 400_000n }))
    if (rec) log(`!!! ATTACK SUCCEEDED: ${a.address} swept ${r.slot} for ${victim}`)
  }),
])
report('collect (races: losers revert by design)', p3)
report('attacks (all must fail)', p3a)

// Merchants collect whatever collectors left (below 10% headroom or minSweep).
const p4 = outcome()
await Promise.all(requests.map(async (r) => {
  const [bal, held] = await Promise.all([balanceOf(r.slot), pub.readContract({ address: r.slot, abi: SLOT_ABI, functionName: 'heldFees' })])
  if (bal - held === 0n) return
  const m = merchants.find((x) => x.address === r.merchant)!
  await timed(p4, () => W(m).writeContract({ address: r.slot, abi: SLOT_ABI, functionName: 'sweep', gas: 400_000n }))
}))
report('merchant self-collect of leftovers', p4)

// ─── Verification from on-chain events ──────────────────────────────────────
log('verifying every slot against its Received events')
const head = await pub.getBlockNumber()
const logs = await pub.getLogs({ address: requests.map((r) => r.slot), fromBlock: 0n, toBlock: head })
const events = parseEventLogs({ abi: SLOT_ABI, logs, eventName: 'Received' })
let problems = 0
let maxRewardBps = 0
let totalPaid = 0n, totalGross = 0n, totalReward = 0n, totalFee = 0n, leftover = 0n
for (const r of requests) {
  const mine = events.filter((e) => e.address.toLowerCase() === r.slot.toLowerCase())
  const gross = mine.reduce((s, e) => s + e.args.gross, 0n)
  const parts = mine.reduce((s, e) => s + e.args.net + e.args.fee + e.args.reimbursement, 0n)
  for (const e of mine) {
    if (e.args.sweeper.toLowerCase() !== r.merchant.toLowerCase() && e.args.gross > 0n) {
      maxRewardBps = Math.max(maxRewardBps, Number((e.args.reimbursement * 10_000n) / e.args.gross))
      if (e.args.reimbursement * 10n > e.args.gross) { problems++; log(`reward >10% on ${r.slot}`) }
    }
    totalReward += e.args.reimbursement
    totalFee += e.args.fee
  }
  const bal = await balanceOf(r.slot)
  const p = paid.get(r.slot) ?? 0n
  totalPaid += p; totalGross += gross; leftover += bal
  if (parts !== gross) { problems++; log(`split mismatch on ${r.slot}`) }
  if (gross + bal !== p) { problems++; log(`conservation broken on ${r.slot}: paid ${p}, swept ${gross}, left ${bal}`) }
  const total = await pub.readContract({ address: r.slot, abi: SLOT_ABI, functionName: 'totalCollected' })
  if (total !== gross) { problems++; log(`totalCollected mismatch on ${r.slot}`) }
}
const totalCollections = await pub.readContract({ address: FACTORY, abi: SLOT_FACTORY_ABI, functionName: 'totalCollections' })
log(`paid ${Number(totalPaid) / 1e6} USDC into ${requests.length} slots; swept ${Number(totalGross) / 1e6}; left in slots ${Number(leftover) / 1e6} (sub-micro native dust + held fees)`)
log(`collector rewards ${Number(totalReward) / 1e6} USDC over ${totalCollections} collections; max reward ${maxRewardBps / 100}% of a payment; fees ${Number(totalFee) / 1e6} USDC`)

// ─── RPC load: 1,000 open pay pages polling every 6 s ──────────────────────
log('RPC load: 1,000 pay pages polling the node for 30 s (one batched read each)')
const lat: number[] = []
let rpcErrors = 0
const until = Date.now() + 30_000
await Promise.all(Array.from({ length: 1_000 }, async (_, i) => {
  await new Promise((r) => setTimeout(r, rand(6_000)))
  while (Date.now() < until) {
    const r = requests[i % requests.length]
    const s = Date.now()
    try {
      await pub.multicall({
        contracts: [
          { address: r.slot, abi: SLOT_ABI, functionName: 'merchant' },
          { address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [r.slot] },
          { address: r.slot, abi: SLOT_ABI, functionName: 'totalCollected' },
          { address: FACTORY, abi: SLOT_FACTORY_ABI, functionName: 'requestOf', args: [r.slot] },
          { address: FACTORY, abi: SLOT_FACTORY_ABI, functionName: 'isSlot', args: [r.slot] },
        ],
        multicallAddress: '0xcA11bde05977b3631167028862bE2a173976CA11',
      })
      lat.push(Date.now() - s)
    } catch { rpcErrors++ }
    await new Promise((res) => setTimeout(res, 6_000))
  }
}))
log(`RPC: ${lat.length} page refreshes in 30 s = ${(lat.length / 30).toFixed(0)} req/s; p50 ${pct(lat, 0.5)}ms p95 ${pct(lat, 0.95)}ms p99 ${pct(lat, 0.99)}ms; errors ${rpcErrors}`)

const ok = problems === 0 && p3a.ok === 0
log(ok ? 'PASS  1,000-user stress test' : `FAIL  ${problems} accounting problems, ${p3a.ok} successful attacks`)
process.exit(ok ? 0 : 1)
