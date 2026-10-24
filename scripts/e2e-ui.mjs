/* oxlint-disable typescript/no-unsafe-argument, typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-member-access, typescript/no-unsafe-return -- untyped Node test harness; app code stays fully type-checked */
// Browser end-to-end test on Arc TESTNET, driving the real UI with two wallets:
//   merchant creates a request -> payer opens the link and pays -> merchant collects.
//
// Wallets are a tiny EIP-1193 shim injected as window.ethereum that signs in
// Node with test keys (never sent to the page):
//   merchant = PRIVATE_KEY from .env, payer = PAYER_PRIVATE_KEY env var.
//
//   bun run dev --port 5179 &   # or set APP_URL
//   PAYER_PRIVATE_KEY=0x... node scripts/e2e-ui.mjs
import fs from 'node:fs'
import { chromium } from 'playwright'
import { createPublicClient, createWalletClient, http, numberToHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arcTestnet } from 'viem/chains'

const APP_URL = process.env.APP_URL ?? 'http://localhost:5179/'
const RPC = 'https://rpc.testnet.arc.io'
const SHOTS = process.env.SHOTS_DIR
const AMOUNT = '0.15'
const LABEL = `E2E coffee ${new Date().toISOString().slice(11, 19)}`

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8').split('\n').filter((l) => /^\w+=/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).trim()]),
)
const hexKey = (k) => (k.startsWith('0x') ? k : `0x${k}`)
if (!env.PRIVATE_KEY || !process.env.PAYER_PRIVATE_KEY) throw new Error('need PRIVATE_KEY in .env and PAYER_PRIVATE_KEY env')

const publicClient = createPublicClient({ chain: arcTestnet, transport: http(RPC) })

async function walletPage(browser, key, name) {
  const account = privateKeyToAccount(hexKey(key))
  const wallet = createWalletClient({ account, chain: arcTestnet, transport: http(RPC) })
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log(`[${name}] pageerror`, e.message))
  await page.exposeFunction('__walletRpc', async (method, params) => {
    switch (method) {
      case 'eth_requestAccounts':
      case 'eth_accounts': return [account.address]
      case 'eth_chainId': return numberToHex(arcTestnet.id)
      case 'net_version': return String(arcTestnet.id)
      case 'wallet_switchEthereumChain':
        if (Number(params[0].chainId) !== arcTestnet.id) throw new Error('e2e wallet is testnet-only')
        return null
      case 'wallet_requestPermissions':
      case 'wallet_getPermissions': return [{ parentCapability: 'eth_accounts' }]
      case 'eth_sendTransaction': {
        const tx = params[0]
        const hash = await wallet.sendTransaction({
          to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : 0n,
          maxPriorityFeePerGas: 1_000_000_000n,
        })
        console.log(`[${name}] sent ${hash}`)
        return hash
      }
      default: return publicClient.request({ method, params })
    }
  })
  await page.addInitScript(() => {
    const listeners = {}
    window.ethereum = {
      isMetaMask: true,
      request: ({ method, params }) => window.__walletRpc(method, params ?? []),
      on: (e, f) => { (listeners[e] ??= []).push(f) },
      removeListener: (e, f) => { listeners[e] = (listeners[e] ?? []).filter((x) => x !== f) },
    }
  })
  return { page, address: account.address }
}

async function connect(page) {
  await page.getByRole('button', { name: /connect wallet/i }).first().click()
  const option = page.getByRole('button', { name: /metamask|browser wallet|injected/i }).first()
  await option.click()
  await page.waitForTimeout(1500)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /^connect wallet$/i }).first().waitFor({ state: 'hidden', timeout: 20_000 })
}

async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/e2e-${name}.png`, fullPage: true })
}

const step = (msg) => console.log(`\n▶ ${msg}`)
const browser = await chromium.launch()
try {
  const merchant = await walletPage(browser, env.PRIVATE_KEY, 'merchant')
  const payer = await walletPage(browser, process.env.PAYER_PRIVATE_KEY, 'payer')
  console.log('merchant', merchant.address, '\npayer   ', payer.address)

  step('merchant creates a request')
  await merchant.page.goto(APP_URL)
  await connect(merchant.page)
  await merchant.page.getByLabel(/amount/i).first().fill(AMOUNT)
  await merchant.page.getByLabel(/what is it for/i).fill(LABEL)
  await merchant.page.getByRole('button', { name: /create payment link/i }).click()
  await merchant.page.getByText(/payment link ready/i).waitFor({ timeout: 60_000 })
  const link = (await merchant.page.getByTestId('pay-link').textContent()).trim()
  console.log('pay link', link)
  await shot(merchant.page, '1-link-ready')

  step('payer opens the link and pays')
  await payer.page.goto(link)
  await payer.page.getByRole('heading', { name: LABEL }).waitFor({ timeout: 20_000 })
  await shot(payer.page, '2-pay-page')
  await connect(payer.page)
  await payer.page.getByRole('button', { name: new RegExp(`pay ${AMOUNT}0? usdc`, 'i') }).click()
  await payer.page.getByText(/payment (sent|received)/i).waitFor({ timeout: 60_000 })
  await shot(payer.page, '3-paid')

  step('merchant sees it paid and collects')
  await merchant.page.getByRole('button', { name: /create another/i }).click()
  const card = merchant.page.locator('article', { hasText: LABEL })
  await card.getByText('Paid', { exact: true }).waitFor({ timeout: 30_000 })
  await shot(merchant.page, '4-paid-card')
  await card.getByRole('button', { name: /collect/i }).click()
  await card.getByText('Collected', { exact: true }).waitFor({ timeout: 60_000 })
  const received = await card.getByText(/you received/i).textContent()
  await shot(merchant.page, '5-collected')
  console.log(received)
  if (!/0\.15 USDC/.test(received)) throw new Error(`expected merchant to receive 0.15 USDC, got: ${received}`)

  console.log('\nPASS  UI end-to-end on Arc testnet')
} finally {
  await browser.close()
}
