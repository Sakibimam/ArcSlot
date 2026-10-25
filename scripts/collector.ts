/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access -- env + JSON parsing in a CLI */
// Slot collector: find paid payment requests on Arc and collect them for the
// USDC reward (gas refund at the base fee + tip). Anyone can run it.
//
//   COLLECTOR_PRIVATE_KEY=0x... bun scripts/collector.ts           # loop
//   COLLECTOR_PRIVATE_KEY=0x... bun scripts/collector.ts --once    # one pass
//   NETWORK=mainnet ...                                             # default: testnet
//
// Only your priority fee isn't refunded (1 gwei by default), so every
// collection should leave you about the tip ahead.
import { createPublicClient, createWalletClient, decodeEventLog, erc20Abi, http, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arc, arcTestnet } from 'viem/chains'
import { SLOT_ABI, SLOT_FACTORY_ABI } from '../src/lib/abis'
import { candidates, worthCollecting, type SlotState } from '../src/lib/collector-logic'
import { formatUsdc6 } from '../src/lib/slot-logic'

const NETWORK = process.env.NETWORK === 'mainnet' ? 'mainnet' : 'testnet'
const chain = NETWORK === 'mainnet' ? arc : arcTestnet
const RPC = process.env.RPC ?? (NETWORK === 'mainnet' ? 'https://rpc.mainnet.arc.io' : 'https://rpc.testnet.arc.io')
const FACTORY = (process.env.FACTORY ?? '0xFe3356346e2978a4BeA738e37144Ad52F4C8b01A') as Hex
const USDC = '0x3600000000000000000000000000000000000000' as Hex
const PRIORITY_FEE = BigInt(process.env.PRIORITY_FEE_WEI ?? 1_000_000_000) // 1 gwei
const INTERVAL_MS = Number(process.env.INTERVAL_SECONDS ?? 30) * 1000
const PAGE = 200n

const rawKey = process.env.COLLECTOR_PRIVATE_KEY ?? ''
if (!/^(0x)?[0-9a-fA-F]{64}$/.test(rawKey)) {
  console.error('Set COLLECTOR_PRIVATE_KEY to a wallet holding a little USDC on Arc for gas.')
  process.exit(1)
}
const account = privateKeyToAccount((rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as Hex)
const pub = createPublicClient({ chain, transport: http(RPC) })
const wallet = createWalletClient({ account, chain, transport: http(RPC) })

let earned = 0n
let collections = 0

async function allSlots(): Promise<Hex[]> {
  const count = await pub.readContract({ address: FACTORY, abi: SLOT_FACTORY_ABI, functionName: 'slotCount' })
  const out: Hex[] = []
  for (let offset = 0n; offset < count; offset += PAGE) {
    out.push(...(await pub.readContract({ address: FACTORY, abi: SLOT_FACTORY_ABI, functionName: 'slotsPage', args: [offset, PAGE] })))
  }
  return out
}

async function states(slots: Hex[]): Promise<SlotState[]> {
  const res = await pub.multicall({
    contracts: slots.flatMap((s) => [
      { address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [s] } as const,
      { address: s, abi: SLOT_ABI, functionName: 'quarantined' } as const,
    ]),
  })
  return slots.map((slot, i) => ({
    slot,
    balance: (res[2 * i].result as bigint | undefined) ?? 0n,
    quarantined: (res[2 * i + 1].result as boolean | undefined) ?? true,
  }))
}

async function collect(slot: Hex): Promise<void> {
  let gas: bigint
  try {
    await pub.simulateContract({ account, address: slot, abi: SLOT_ABI, functionName: 'sweepFor', args: [account.address] })
    gas = await pub.estimateContractGas({ account, address: slot, abi: SLOT_ABI, functionName: 'sweepFor', args: [account.address] })
  } catch {
    return // GasTooHigh, below minimum, or someone collected first
  }
  const tip = await pub.readContract({ address: slot, abi: SLOT_ABI, functionName: 'tip' })
  if (!worthCollecting({ simulated: true, gasEstimate: gas, priorityFee: PRIORITY_FEE, tip })) return

  const hash = await wallet.writeContract({
    address: slot, abi: SLOT_ABI, functionName: 'sweepFor', args: [account.address],
    maxPriorityFeePerGas: PRIORITY_FEE,
  })
  const receipt = await pub.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') {
    console.log(`  ✗ ${slot} reverted (${hash})`)
    return
  }
  const cost = receipt.gasUsed * receipt.effectiveGasPrice / 1_000_000_000_000n
  for (const log of receipt.logs) {
    try {
      const ev = decodeEventLog({ abi: SLOT_ABI, data: log.data, topics: log.topics })
      if (ev.eventName !== 'Received') continue
      const reward = ev.args.reimbursement
      earned += reward - cost
      collections += 1
      console.log(`  ✓ collected ${formatUsdc6(ev.args.gross)} USDC from ${slot} · reward ${formatUsdc6(reward)} − gas ${formatUsdc6(cost)} = +${formatUsdc6(reward - cost)} USDC · ${hash}`)
    } catch { /* not a Slot event */ }
  }
}

async function round(): Promise<void> {
  const slots = await allSlots()
  const minSweep = await pub.readContract({ address: FACTORY, abi: SLOT_FACTORY_ABI, functionName: 'minSweep' })
  const todo = candidates(await states(slots), minSweep)
  console.log(`[${new Date().toISOString()}] ${slots.length} slots, ${todo.length} ready to collect`)
  for (const s of todo) await collect(s.slot as Hex)
  console.log(`  session: ${collections} collections, net +${formatUsdc6(earned)} USDC`)
}

console.log(`Slot collector on Arc ${NETWORK} as ${account.address}`)
if (process.argv.includes('--once')) {
  await round()
} else {
  for (;;) {
    try { await round() } catch (e) { console.error('round failed:', e instanceof Error ? e.message : e) }
    await new Promise((r) => setTimeout(r, INTERVAL_MS))
  }
}
