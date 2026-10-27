/* oxlint-disable typescript/no-unsafe-argument, typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-member-access, typescript/no-unsafe-return -- untyped Node demo harness */
// One real 1 USDC payment through the LIVE app on Arc MAINNET (for the grant submission):
//   merchant (.env PRIVATE_KEY) creates a request -> payer (PAYER_KEY_FILE) pays it -> merchant collects.
// Refuses to run without MAINNET_DEMO=1. Keys are read from files, never printed or passed on a command line.
//   MAINNET_DEMO=1 PAYER_KEY_FILE=... [APP_URL=...] [SHOTS_DIR=...] node scripts/demo-mainnet.mjs
import fs from 'node:fs'
import { chromium } from 'playwright'
import { arc } from 'viem/chains'
import { walletPage, connect } from './e2e-wallet.mjs'

if (process.env.MAINNET_DEMO !== '1') throw new Error('this moves real USDC on Arc mainnet: set MAINNET_DEMO=1 to confirm')
const APP_URL = process.env.APP_URL ?? 'https://arc-slot-three.vercel.app/'
const SHOTS = process.env.SHOTS_DIR
const AMOUNT = '1'
const LABEL = 'ArcSlot mainnet demo'
const MAINNET = { [arc.id]: { chain: arc, rpc: 'https://rpc.mainnet.arc.io' } }
const opts = { chains: MAINNET, initialChain: arc.id }

const envKey = fs.readFileSync('.env', 'utf8').split('\n').find((l) => l.startsWith('PRIVATE_KEY=')).slice('PRIVATE_KEY='.length).trim()
const payerKey = JSON.parse(fs.readFileSync(process.env.PAYER_KEY_FILE, 'utf8'))[0].private_key
const shot = async (page, n) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/mainnet-${n}.png`, fullPage: true }) }
const step = (msg) => console.log(`\n▶ ${msg}`)

const browser = await chromium.launch()
try {
  const merchant = await walletPage(browser, envKey, 'merchant', {}, opts)
  const payer = await walletPage(browser, payerKey, 'payer', {}, opts)
  console.log('merchant', merchant.address, '\npayer   ', payer.address)

  step('merchant opens the live app on Arc mainnet and creates a 1 USDC request')
  await merchant.page.goto(`${APP_URL}#/app`)
  await connect(merchant.page)
  await merchant.page.getByRole('button', { name: /^mainnet$/i }).click()
  await merchant.page.getByRole('note').filter({ hasText: /real USDC/i }).waitFor({ timeout: 20_000 })
  await merchant.page.getByLabel(/amount/i).first().fill(AMOUNT)
  await merchant.page.getByLabel(/what is it for/i).fill(LABEL)
  await merchant.page.getByRole('button', { name: /create payment link/i }).click()
  await merchant.page.getByText(/payment link ready/i).waitFor({ timeout: 90_000 })
  const link = (await merchant.page.getByTestId('pay-link').textContent()).trim()
  if (!link.includes('/pay/5042/')) throw new Error(`expected a mainnet link, got ${link}`)
  console.log('pay link', link)
  await shot(merchant.page, '1-link-ready')

  step('payer opens the link and pays 1 USDC')
  await payer.page.goto(link)
  await payer.page.getByRole('heading', { name: LABEL }).waitFor({ timeout: 30_000 })
  await connect(payer.page)
  await payer.page.getByRole('button', { name: /pay 1(\.0+)? usdc/i }).click()
  await payer.page.getByText(/payment (sent|received)/i).waitFor({ timeout: 90_000 })
  await shot(payer.page, '2-paid')

  step('merchant sees it paid and collects')
  await merchant.page.getByRole('button', { name: /create another/i }).click()
  const card = merchant.page.locator('article', { hasText: LABEL }).first()
  await card.getByText('Paid', { exact: true }).waitFor({ timeout: 60_000 })
  await card.getByRole('button', { name: /collect/i }).click()
  await card.getByText('Collected', { exact: true }).waitFor({ timeout: 90_000 })
  console.log(await card.getByText(/you received/i).textContent())
  await shot(merchant.page, '3-collected')

  console.log('\nTRANSACTIONS (Arc mainnet)')
  for (const [who, w] of [['merchant', merchant], ['payer', payer]])
    for (const s of w.sent) console.log(`${who.padEnd(9)} https://explorer.arc.io/tx/${s.hash}`)
  console.log(`slot      ${link.split('/').pop()}`)
  console.log('\nPASS  real 1 USDC payment on Arc mainnet through the live app')
} finally {
  await browser.close()
}
