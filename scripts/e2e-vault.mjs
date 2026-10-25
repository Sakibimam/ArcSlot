/* oxlint-disable typescript/no-unsafe-argument, typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-member-access, typescript/no-unsafe-return -- untyped Node test harness */
// Live end-to-end check of the quantum-safe vault on Arc TESTNET:
//   create vault (real SLH-DSA key) -> fund it -> two-key withdrawal -> assert balances.
//   VAULT_FACTORY=0x... node scripts/e2e-vault.mjs
import fs from 'node:fs'
import { createPublicClient, createWalletClient, http, parseAbi, keccak256, toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arcTestnet } from 'viem/chains'
import { slh_dsa_sha2_128s as slh } from '@noble/post-quantum/slh-dsa.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

const RPC = 'https://rpc.testnet.arc.io'
const USDC = '0x3600000000000000000000000000000000000000'
const FACTORY = process.env.VAULT_FACTORY
if (!FACTORY) throw new Error('set VAULT_FACTORY')

const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n').filter((l) => /^\w+=/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).trim()]))
const account = privateKeyToAccount(env.PRIVATE_KEY.startsWith('0x') ? env.PRIVATE_KEY : `0x${env.PRIVATE_KEY}`)
const pub = createPublicClient({ chain: arcTestnet, transport: http(RPC) })
const wallet = createWalletClient({ account, chain: arcTestnet, transport: http(RPC) })
const send = async (args) => {
  const hash = await wallet.writeContract({ ...args, maxPriorityFeePerGas: 1_000_000_000n })
  const r = await pub.waitForTransactionReceipt({ hash })
  if (r.status !== 'success') throw new Error(`tx failed ${hash}`)
  return r
}

const factoryAbi = parseAbi([
  'function createVault(address owner, bytes32 pqKey, bool twoKey, uint256 recoveryDelay, bytes32 salt) returns (address)',
  'function predict(address owner, bytes32 pqKey, bool twoKey, uint256 recoveryDelay, bytes32 salt) view returns (address)',
])
const vaultAbi = parseAbi([
  'function withdrawDigest(address to, uint256 amount, uint256 relayerFee, uint256 deadline) view returns (bytes32)',
  'function withdraw(address to, uint256 amount, uint256 relayerFee, uint256 deadline, bytes pqSig, bytes ownerSig)',
  'function pqKey() view returns (bytes32)',
  'function nonce() view returns (uint256)',
])
const erc20 = parseAbi(['function balanceOf(address) view returns (uint256)', 'function transfer(address,uint256) returns (bool)'])
const bal = (a) => pub.readContract({ address: USDC, abi: erc20, functionName: 'balanceOf', args: [a] })
const fail = (m) => { console.error('FAIL:', m); process.exit(1) }

const seed = crypto.getRandomValues(new Uint8Array(48))
const keys = slh.keygen(seed)
const pqKey = `0x${bytesToHex(keys.publicKey)}`
const salt = keccak256(toHex(`e2e-${Date.now()}`))
const DELAY = 7n * 86400n

console.log('owner   ', account.address)
const predicted = await pub.readContract({ address: FACTORY, abi: factoryAbi, functionName: 'predict', args: [account.address, pqKey, true, DELAY, salt] })
const r1 = await send({ address: FACTORY, abi: factoryAbi, functionName: 'createVault', args: [account.address, pqKey, true, DELAY, salt] })
console.log('vault   ', predicted, ' create', r1.transactionHash)
if ((await pub.readContract({ address: predicted, abi: vaultAbi, functionName: 'pqKey' })) !== pqKey) fail('pqKey not stored')

await send({ address: USDC, abi: erc20, functionName: 'transfer', args: [predicted, 200_000n] })
console.log('funded   0.20 USDC')

const payee = '0x000000000000000000000000000000000000dEaD'
const before = await bal(payee)
const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
const digest = await pub.readContract({ address: predicted, abi: vaultAbi, functionName: 'withdrawDigest', args: [payee, 150_000n, 0n, deadline] })
const t0 = Date.now()
const pqSig = `0x${bytesToHex(slh.sign(hexToBytes(digest.slice(2)), keys.secretKey))}`
console.log(`pq sign   ${Date.now() - t0} ms, ${(pqSig.length - 2) / 2} bytes`)
const ownerSig = await account.signMessage({ message: { raw: digest } })

const r2 = await send({ address: predicted, abi: vaultAbi, functionName: 'withdraw', args: [payee, 150_000n, 0n, deadline, pqSig, ownerSig] })
console.log('withdraw', r2.transactionHash, 'gas', r2.gasUsed.toString())
const got = (await bal(payee)) - before
if (got !== 150_000n) fail(`payee got ${got}`)
if ((await bal(predicted)) !== 50_000n) fail('vault remainder wrong')
if ((await pub.readContract({ address: predicted, abi: vaultAbi, functionName: 'nonce' })) !== 1n) fail('nonce')

// Replay must fail
try {
  await pub.simulateContract({ account, address: predicted, abi: vaultAbi, functionName: 'withdraw', args: [payee, 150_000n, 0n, deadline, pqSig, ownerSig] })
  fail('replay accepted')
} catch (e) {
  if (!/BadPQSignature|0x/.test(String(e))) throw e
  console.log('replay   rejected')
}
console.log('PASS  quantum-safe vault on Arc testnet')
