/* oxlint-disable typescript/no-unsafe-argument, typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-member-access, typescript/no-unsafe-return -- untyped Node deploy tool; app code stays fully type-checked */
// Deterministic deploy through the standard CREATE2 deployer, same addresses on every chain.
// Unlike scripts/deploy-deterministic.sh, the private key never appears on a command line or in
// output: it is read here from .env (PRIVATE_KEY) or from KEY_FILE (a JSON list, `.[0].private_key`).
//
//   RPC=https://rpc.testnet.arc.io [ONLY=payments] [DRY_RUN=1] [GAS_PRICE_GWEI=30] node scripts/deploy-deterministic.mjs
//
// ONLY=payments deploys Slot + SlotFactory (no vault). DRY_RUN=1 prints the addresses and what
// would be sent, and sends nothing. Idempotent: anything already deployed is skipped.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createPublicClient, createWalletClient, http, concatHex, encodeAbiParameters, getContractAddress, keccak256, toHex, parseGwei, formatUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const D = '0x4e59b44847b379578588920cA78FbF26c0B4956C'
const SALT_PREFIX = 'arc-slot.v5.' // never bump: it would also move unchanged contracts
const TIP = 2000n
const MIN_SWEEP = 100000n
const GAS_LIMIT = 16_000_000n

const RPC = process.env.RPC
if (!RPC) throw new Error('set RPC')
const DRY = process.env.DRY_RUN === '1'
const ONLY = process.env.ONLY ?? 'all'

export const saltOf = (name) => keccak256(toHex(SALT_PREFIX + name))
export const addressOf = (name, init) => getContractAddress({ from: D, opcode: 'CREATE2', salt: saltOf(name), bytecode: init })

function loadKey() {
  if (process.env.KEY_FILE) return JSON.parse(fs.readFileSync(process.env.KEY_FILE, 'utf8'))[0].private_key
  const line = fs.readFileSync('.env', 'utf8').split('\n').find((l) => l.startsWith('PRIVATE_KEY='))
  if (!line) throw new Error('no PRIVATE_KEY in .env')
  return line.slice('PRIVATE_KEY='.length).trim()
}
const hexKey = (k) => (k.startsWith('0x') ? k : `0x${k}`)
const bytecode = (name) => execFileSync('forge', ['inspect', name, 'bytecode'], { encoding: 'utf8' }).trim()

const pub = createPublicClient({ transport: http(RPC) })
const chainId = await pub.getChainId()
if ((await pub.getCode({ address: D })) === undefined) throw new Error('CREATE2 deployer missing on this chain')

execFileSync('forge', ['build'], { stdio: 'ignore' })
const slotInit = bytecode('Slot')
const slotImpl = addressOf('Slot', slotInit)
const factoryInit = concatHex([bytecode('SlotFactory'), encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }, { type: 'uint256' }], [slotImpl, TIP, MIN_SWEEP])])
const plan = [['Slot', slotInit], ['SlotFactory', factoryInit]]
if (ONLY !== 'payments') {
  const vaultInit = bytecode('SlotVault')
  plan.push(['SlotVault', vaultInit], ['VaultFactory', concatHex([bytecode('VaultFactory'), encodeAbiParameters([{ type: 'address' }], [addressOf('SlotVault', vaultInit)])])])
}

const account = DRY ? null : privateKeyToAccount(hexKey(loadKey()))
const wallet = account && createWalletClient({ account, transport: http(RPC) })
const block = await pub.getBlock()
const priority = parseGwei(process.env.PRIORITY_GWEI ?? '1')
// the fee cap must always cover the tip (Sepolia's base fee can be near zero)
const maxFee = process.env.GAS_PRICE_GWEI ? parseGwei(process.env.GAS_PRICE_GWEI) : block.baseFeePerGas * 2n + priority
if (maxFee < priority) throw new Error('GAS_PRICE_GWEI must be at least PRIORITY_GWEI')
console.log(`chain ${chainId}  base fee ${formatUnits(block.baseFeePerGas, 9)} gwei  max fee ${formatUnits(maxFee, 9)} gwei  ${DRY ? 'DRY RUN' : `deployer ${account.address}`}`)

for (const [name, init] of plan) {
  const addr = addressOf(name, init)
  const code = await pub.getCode({ address: addr })
  if (code && code !== '0x') { console.log(`${name.padEnd(12)} ${addr}  exists`); continue }
  if (DRY) { console.log(`${name.padEnd(12)} ${addr}  would deploy (${(init.length - 2) / 2} bytes init code)`); continue }
  let hash
  try {
    hash = await wallet.sendTransaction({
      chain: null, to: D, data: concatHex([saltOf(name), init]), gas: GAS_LIMIT, maxFeePerGas: maxFee, maxPriorityFeePerGas: priority,
    })
  } catch (e) {
    console.error(`${name}: not sent: ${e.shortMessage ?? e.message}`) // never dump calldata or keys
    process.exit(1)
  }
  const r = await pub.waitForTransactionReceipt({ hash })
  const deployed = await pub.getCode({ address: addr })
  if (r.status !== 'success' || !deployed || deployed === '0x') throw new Error(`${name} failed: ${hash}`)
  console.log(`${name.padEnd(12)} ${addr}  deployed  tx ${hash}  gas ${r.gasUsed}  cost ${formatUnits(r.gasUsed * r.effectiveGasPrice, 18)} USDC`)
}
