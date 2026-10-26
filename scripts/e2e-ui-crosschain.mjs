/* oxlint-disable typescript/no-unsafe-argument, typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-member-access, typescript/no-unsafe-return -- untyped Node test harness; app code stays fully type-checked */
// Browser end-to-end on TESTNET for paying a Slot from another chain:
//   merchant creates a request on Arc testnet -> payer pays it from Ethereum Sepolia
//   via CCTP + Circle's forwarder -> USDC lands in the Slot on Arc -> both sides see it paid.
// The payer (PRIVATE_KEY in .env) needs Sepolia ETH for gas and Sepolia USDC.
//   MERCHANT_PRIVATE_KEY=0x... [APP_URL=...] [SHOTS_DIR=...] node scripts/e2e-ui-crosschain.mjs
import fs from 'node:fs'
import { chromium } from 'playwright'
import { parseAbi } from 'viem'
import { walletPage, connect, publicClient } from './e2e-wallet.mjs'

const APP_URL = process.env.APP_URL ?? 'http://localhost:5179/'
const SHOTS = process.env.SHOTS_DIR
const LABEL = `Cross-chain e2e ${new Date().toISOString().slice(11, 19)}`
const AMOUNT = process.env.AMOUNT ?? '0.2'
const AMOUNT6 = BigInt(Math.round(Number(AMOUNT) * 1e6))
const AMOUNT_TEXT = Number(AMOUNT).toFixed(2).replace('.', '\\.')

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8').split('\n').filter((l) => /^\w+=/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).trim()]),
)
if (!env.PRIVATE_KEY || !process.env.MERCHANT_PRIVATE_KEY) throw new Error('need PRIVATE_KEY in .env (payer) and MERCHANT_PRIVATE_KEY env')

const step = (m) => console.log(`\n▶ ${m}`)
const shot = (page, name) => (SHOTS ? page.screenshot({ path: `${SHOTS}/xc-${name}.png`, fullPage: true }) : Promise.resolve())
const erc20 = parseAbi(['function balanceOf(address) view returns (uint256)'])
const USDC = '0x3600000000000000000000000000000000000000'

const browser = await chromium.launch()
try {
  const merchant = await walletPage(browser, process.env.MERCHANT_PRIVATE_KEY, 'merchant')
  const payer = await walletPage(browser, env.PRIVATE_KEY, 'payer')
  console.log('merchant', merchant.address, '\npayer   ', payer.address)

  step('merchant creates a request on Arc testnet')
  await merchant.page.goto(`${APP_URL}#/app`)
  await connect(merchant.page)
  await merchant.page.getByLabel(/^amount \(usdc\)$/i).first().fill(AMOUNT)
  await merchant.page.getByLabel(/what is it for/i).fill(LABEL)
  await merchant.page.getByRole('button', { name: /create payment link/i }).click()
  await merchant.page.getByText(/payment link ready/i).waitFor({ timeout: 60_000 })
  const link = (await merchant.page.getByTestId('pay-link').textContent()).trim()
  const slot = link.match(/0x[0-9a-fA-F]{40}$/)[0]
  console.log('pay link', link)

  step('payer pays from Ethereum Sepolia')
  await payer.page.goto(link)
  await payer.page.getByRole('heading', { name: LABEL }).waitFor({ timeout: 20_000 })
  await connect(payer.page)
  await payer.page.getByRole('tab', { name: /another chain/i }).click()
  await payer.page.getByLabel(/pay from/i).selectOption('Ethereum_Sepolia')
  await payer.page.getByRole('button', { name: /review payment/i }).click()
  await payer.page.getByText(new RegExp(`merchant receives exactly ${AMOUNT_TEXT} usdc`, 'i')).waitFor({ timeout: 60_000 })
  const debit = await payer.page.getByTestId('xc-debit').textContent()
  const fee = await payer.page.getByTestId('xc-fee').textContent()
  console.log(`quote: payer sends ${debit}, fee ${fee}`)
  await shot(payer.page, '1-quote')
  await payer.page.getByRole('button', { name: /from ethereum sepolia/i }).click()
  await payer.page.getByText(/payment on its way/i).waitFor({ timeout: 900_000 })
  console.log('bridge reported success')

  step('USDC lands in the Slot on Arc')
  const deadline = Date.now() + 600_000
  let bal = 0n
  while (Date.now() < deadline) {
    bal = await publicClient.readContract({ address: USDC, abi: erc20, functionName: 'balanceOf', args: [slot] })
    if (bal >= AMOUNT6) break
    await new Promise((r) => setTimeout(r, 5_000))
  }
  console.log('slot balance on Arc', bal.toString())
  if (bal !== AMOUNT6) throw new Error(`expected exactly ${AMOUNT} USDC in the slot, got ${bal}`)

  step('both sides see it paid')
  await payer.page.goto('about:blank')
  await payer.page.goto(link)
  await payer.page.getByText(/payment received/i).waitFor({ timeout: 60_000 })
  await shot(payer.page, '2-received')
  await merchant.page.getByRole('button', { name: /create another/i }).click()
  await merchant.page.locator('article', { hasText: LABEL }).getByText('Paid', { exact: true }).waitFor({ timeout: 60_000 })
  console.log('merchant card shows Paid')

  console.log('\nPASS  cross-chain payment (Ethereum Sepolia -> Arc testnet slot)')
} finally {
  await browser.close()
}
