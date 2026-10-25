/* oxlint-disable typescript/no-unsafe-argument, typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-member-access, typescript/no-unsafe-return -- untyped Node test harness; app code stays fully type-checked */
// Browser end-to-end on Arc TESTNET for the quantum-safe vault, driving the real UI:
//   merchant sets up a vault -> request pays into it -> payer sees the vault badge and pays
//   -> merchant collects into the vault -> merchant withdraws with PQ + wallet signatures.
//   PAYER_PRIVATE_KEY=0x... [APP_URL=...] [SHOTS_DIR=...] node scripts/e2e-ui-vault.mjs
import fs from 'node:fs'
import { chromium } from 'playwright'
import { walletPage, connect } from './e2e-wallet.mjs'

const APP_URL = process.env.APP_URL ?? 'http://localhost:5179/'
const SHOTS = process.env.SHOTS_DIR
const PASSWORD = 'e2e-vault-password'
const LABEL = `Vault e2e ${new Date().toISOString().slice(11, 19)}`

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8').split('\n').filter((l) => /^\w+=/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).trim()]),
)
if (!env.PRIVATE_KEY || !process.env.PAYER_PRIVATE_KEY) throw new Error('need PRIVATE_KEY in .env and PAYER_PRIVATE_KEY env')

const step = (m) => console.log(`\n▶ ${m}`)
const shot = (page, name) => (SHOTS ? page.screenshot({ path: `${SHOTS}/vault-${name}.png`, fullPage: true }) : Promise.resolve())
const usdc = (text) => Number(String(text).match(/([\d.]+)/)?.[1] ?? NaN)

const browser = await chromium.launch()
try {
  const merchant = await walletPage(browser, env.PRIVATE_KEY, 'merchant')
  const payer = await walletPage(browser, process.env.PAYER_PRIVATE_KEY, 'payer')
  const m = merchant.page

  step('merchant sets up a quantum-safe vault')
  await m.goto(APP_URL)
  await m.evaluate(() => localStorage.clear())
  await m.reload()
  await connect(m)
  await m.getByRole('button', { name: /set up vault/i }).click()
  await m.getByLabel(/^vault password$/i).fill(PASSWORD)
  await m.getByLabel(/confirm password/i).fill(PASSWORD)
  await m.getByRole('button', { name: /generate key/i }).click()
  await m.getByText(/save your backup/i).waitFor({ timeout: 30_000 })
  await m.getByLabel(/i saved my backup/i).check()
  await shot(m, '1-backup')
  await m.getByRole('button', { name: /create vault/i }).click()
  await m.getByText(/quantum-safe key \+ your wallet/i).waitFor({ timeout: 60_000 })
  console.log('vault created')

  step('request defaults to the vault')
  await m.getByText(/your quantum-safe vault/i).waitFor()
  await m.getByLabel(/^amount \(usdc\)$/i).first().fill('0.15')
  await m.getByLabel(/what is it for/i).fill(LABEL)
  await m.getByRole('button', { name: /create payment link/i }).click()
  await m.getByText(/payment link ready/i).waitFor({ timeout: 60_000 })
  const link = (await m.getByTestId('pay-link').textContent()).trim()
  console.log('pay link', link)

  step('payer sees the vault badge and pays')
  await payer.page.goto(link)
  await payer.page.getByText(/pays into a quantum-safe vault/i).waitFor({ timeout: 20_000 })
  await shot(payer.page, '2-pay-badge')
  await connect(payer.page)
  await payer.page.getByRole('button', { name: /pay 0\.15 usdc/i }).click()
  await payer.page.getByText(/payment (sent|received)/i).waitFor({ timeout: 60_000 })

  step('merchant collects into the vault')
  await m.getByRole('button', { name: /create another/i }).click()
  const card = m.locator('article', { hasText: LABEL })
  await card.getByText('Paid', { exact: true }).waitFor({ timeout: 30_000 })
  await card.getByRole('button', { name: /collect/i }).click()
  await card.getByText('Collected', { exact: true }).waitFor({ timeout: 60_000 })
  const balance = m.getByTestId('vault-balance')
  await m.waitForFunction(() => Number(document.querySelector('[data-testid="vault-balance"]')?.textContent?.match(/[\d.]+/)?.[0]) > 0.1, null, { timeout: 30_000 })
  const before = usdc(await balance.textContent())
  console.log('vault balance', before)

  step('merchant withdraws with PQ + wallet signatures')
  await m.getByRole('button', { name: /^withdraw$/i }).click()
  await m.getByLabel(/^amount \(usdc\)$/i).last().fill('0.1')
  await m.getByLabel(/^vault password$/i).fill(PASSWORD)
  await m.getByRole('button', { name: /sign & withdraw/i }).click()
  await m.getByText(/withdrawal sent/i).waitFor({ timeout: 90_000 })
  await m.waitForFunction((b) => Number(document.querySelector('[data-testid="vault-balance"]')?.textContent?.match(/[\d.]+/)?.[0]) < b - 0.09, before, { timeout: 30_000 })
  const after = usdc(await balance.textContent())
  await shot(m, '3-after-withdraw')
  console.log('vault balance after', after)
  if (Math.abs(before - after - 0.1) > 0.000001) throw new Error(`expected vault to drop by 0.1, ${before} -> ${after}`)

  console.log('\nPASS  quantum-safe vault UI end-to-end on Arc testnet')
} finally {
  await browser.close()
}
