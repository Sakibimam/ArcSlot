/* oxlint-disable typescript/no-unsafe-argument, typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-member-access, typescript/no-unsafe-return -- untyped Node test harness; app code stays fully type-checked */
// Browser end-to-end on TESTNET for wrong-network recovery:
//   merchant creates a request on Arc testnet -> USDC is sent to the SAME address on
//   Ethereum Sepolia by mistake -> the merchant's card flags it -> Recover deploys the
//   slot on Sepolia and collects -> merchant's Sepolia USDC goes up by exactly that amount.
// The merchant (PRIVATE_KEY in .env) needs Sepolia ETH for gas and Sepolia USDC to "mis-send".
//   [APP_URL=...] [SHOTS_DIR=...] node scripts/e2e-ui-recovery.mjs
import fs from 'node:fs'
import { chromium } from 'playwright'
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import { walletPage, connect, hexKey } from './e2e-wallet.mjs'

const APP_URL = process.env.APP_URL ?? 'http://localhost:5179/'
const SHOTS = process.env.SHOTS_DIR
const LABEL = `Recovery e2e ${new Date().toISOString().slice(11, 19)}`
const MISTAKE = 50_000n // 0.05 USDC
const SEPOLIA_RPC = 'https://ethereum-sepolia-rpc.publicnode.com'
const SEPOLIA_USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8').split('\n').filter((l) => /^\w+=/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).trim()]),
)
const account = privateKeyToAccount(hexKey(env.PRIVATE_KEY))
const sep = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC) })
const sepWallet = createWalletClient({ account, chain: sepolia, transport: http(SEPOLIA_RPC) })
const erc20 = parseAbi(['function balanceOf(address) view returns (uint256)', 'function transfer(address,uint256) returns (bool)'])
const bal = (a) => sep.readContract({ address: SEPOLIA_USDC, abi: erc20, functionName: 'balanceOf', args: [a] })
const step = (m) => console.log(`\n▶ ${m}`)
const shot = (page, name) => (SHOTS ? page.screenshot({ path: `${SHOTS}/rec-${name}.png`, fullPage: true }) : Promise.resolve())

const browser = await chromium.launch()
try {
  const merchant = await walletPage(browser, env.PRIVATE_KEY, 'merchant')
  const m = merchant.page

  step('merchant creates a request on Arc testnet')
  await m.goto(APP_URL)
  await connect(m)
  await m.getByLabel(/^amount \(usdc\)$/i).first().fill('1')
  await m.getByLabel(/what is it for/i).fill(LABEL)
  await m.getByRole('button', { name: /create payment link/i }).click()
  await m.getByText(/payment link ready/i).waitFor({ timeout: 60_000 })
  const slot = (await m.getByTestId('pay-link').textContent()).trim().match(/0x[0-9a-fA-F]{40}$/)[0]
  console.log('slot', slot)

  step('USDC sent to the same address on Ethereum Sepolia by mistake')
  const hash = await sepWallet.writeContract({ address: SEPOLIA_USDC, abi: erc20, functionName: 'transfer', args: [slot, MISTAKE] })
  await sep.waitForTransactionReceipt({ hash })
  console.log('mistaken transfer', hash, 'slot on Sepolia holds', (await bal(slot)).toString())

  step('merchant sees the stray funds and recovers them')
  const before = await bal(account.address)
  await m.reload()
  const card = m.locator('article', { hasText: LABEL })
  await card.getByText(/0\.05 usdc was sent on ethereum sepolia by mistake/i).waitFor({ timeout: 90_000 })
  await shot(m, '1-flagged')
  await card.getByRole('button', { name: /recover to my wallet/i }).click()
  await card.getByText(/recovered 0\.05 usdc on ethereum sepolia/i).waitFor({ timeout: 300_000 })
  await shot(m, '2-recovered')

  const after = await bal(account.address)
  console.log('merchant Sepolia USDC', before.toString(), '->', after.toString())
  if (after - before !== MISTAKE) throw new Error(`expected +${MISTAKE}, got +${after - before}`)
  if ((await bal(slot)) !== 0n) throw new Error('slot on Sepolia not emptied')

  console.log('\nPASS  wrong-network recovery (Ethereum Sepolia) via the UI')
} finally {
  await browser.close()
}
