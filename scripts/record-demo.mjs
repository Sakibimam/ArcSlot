/* oxlint-disable typescript/no-unsafe-argument, typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-member-access, typescript/no-unsafe-return -- untyped Node demo harness; app code stays fully type-checked */
// Records a real ArcSlot payment on Arc TESTNET for the demo video:
//   landing page -> merchant creates a link -> customer pays on a phone -> merchant collects.
// Real transactions on the live site; nothing is simulated. A visible cursor is
// drawn into each page (Playwright videos have none) and clicks are paced like a person.
//
//   DEMO_MERCHANT_KEY=0x... PAYER_PRIVATE_KEY=0x... OUT_DIR=./out node scripts/record-demo.mjs
// Writes one .webm per scene plus marks.json (ms offsets of each step, for editing).
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { walletPage } from './e2e-wallet.mjs'

const APP_URL = process.env.APP_URL ?? 'https://arc-slot-three.vercel.app/'
const OUT = process.env.OUT_DIR ?? 'demo-out'
const AMOUNT = process.env.AMOUNT ?? '12.50'
const LABEL = process.env.LABEL ?? 'Logo design'
if (!process.env.DEMO_MERCHANT_KEY || !process.env.PAYER_PRIVATE_KEY) throw new Error('need DEMO_MERCHANT_KEY and PAYER_PRIVATE_KEY')
fs.mkdirSync(OUT, { recursive: true })

const DESKTOP = { width: 1440, height: 900 }
const PHONE = { width: 390, height: 844 }
const marks = {}
const mark = (scene, t0, name) => { (marks[scene] ??= {})[name] = Date.now() - t0; console.log(`${scene}.${name} @ ${marks[scene][name]} ms`) }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// A drawn cursor that follows Playwright's mouse, with a ripple on click.
const CURSOR = () => {
  addEventListener('DOMContentLoaded', () => {
    const c = document.createElement('div')
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l15 11-6.5 1.2L16 21l-3 1.4-3.4-6.6L4 20z" fill="#0B2A21" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>'
    Object.assign(c.style, { position: 'fixed', left: '-40px', top: '-40px', zIndex: 2147483647, pointerEvents: 'none', transition: 'transform .08s' })
    document.body.appendChild(c)
    addEventListener('mousemove', (e) => { c.style.left = `${e.clientX - 3}px`; c.style.top = `${e.clientY - 2}px` }, true)
    addEventListener('mousedown', (e) => {
      c.style.transform = 'scale(.85)'
      const r = document.createElement('div')
      Object.assign(r.style, { position: 'fixed', left: `${e.clientX - 18}px`, top: `${e.clientY - 18}px`, width: '36px', height: '36px', borderRadius: '50%', border: '2px solid #B3261E', zIndex: 2147483646, pointerEvents: 'none', transition: 'transform .45s ease-out, opacity .45s ease-out' })
      document.body.appendChild(r)
      requestAnimationFrame(() => { r.style.transform = 'scale(1.8)'; r.style.opacity = '0' })
      setTimeout(() => r.remove(), 500)
    }, true)
    addEventListener('mouseup', () => { c.style.transform = '' }, true)
  })
}

async function glideClick(page, locator) {
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 28 })
  await wait(260)
  await page.mouse.down(); await wait(90); await page.mouse.up()
}
async function typeInto(page, locator, text) {
  await glideClick(page, locator)
  await locator.pressSequentially(text, { delay: 85 })
}
async function connectWallet(page) {
  await glideClick(page, page.getByRole('button', { name: /connect wallet/i }).first())
  await wait(700)
  await glideClick(page, page.getByRole('button', { name: /metamask|browser wallet|injected/i }).first())
  await wait(1500)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /^connect wallet$/i }).first().waitFor({ state: 'hidden', timeout: 20_000 })
}

const browser = await chromium.launch()
const video = (size, dir) => ({ recordVideo: { dir: path.join(OUT, dir), size } })
try {
  // ── Scene 1: the landing page ──────────────────────────────────────────────
  {
    const ctx = await browser.newContext({ viewport: DESKTOP, ...video(DESKTOP, 'landing') })
    await ctx.addInitScript(CURSOR)
    const page = await ctx.newPage(); const t0 = Date.now()
    await page.goto(APP_URL); mark('landing', t0, 'loaded')
    await page.mouse.move(700, 450)
    await wait(8_500); mark('landing', t0, 'secondReceipt')
    await page.evaluate(() => document.getElementById('fees').scrollIntoView({ behavior: 'smooth' }))
    await wait(3_500); mark('landing', t0, 'feesDrawn')
    await ctx.close()
  }

  // ── Scene 2: merchant creates a link ───────────────────────────────────────
  const merchant = await walletPage(browser, process.env.DEMO_MERCHANT_KEY, 'merchant', { viewport: DESKTOP, ...video(DESKTOP, 'merchant') })
  await merchant.ctx.addInitScript(CURSOR)
  const m = merchant.page; const tm = Date.now()
  await m.goto(`${APP_URL}#/app`); await wait(1_500); mark('merchant', tm, 'loaded')
  await connectWallet(m); mark('merchant', tm, 'connected')
  await wait(600)
  await typeInto(m, m.getByLabel(/amount/i).first(), AMOUNT)
  await typeInto(m, m.getByLabel(/what is it for/i), LABEL); mark('merchant', tm, 'filled')
  await wait(800)
  await glideClick(m, m.getByRole('button', { name: /create payment link/i })); mark('merchant', tm, 'createClicked')
  await m.getByText(/payment link ready/i).waitFor({ timeout: 60_000 }); mark('merchant', tm, 'linkReady')
  const link = (await m.getByTestId('pay-link').textContent()).trim()
  console.log('pay link', link)
  await wait(3_000); mark('merchant', tm, 'linkShown')

  // ── Scene 3: the customer pays on a phone ──────────────────────────────────
  const payer = await walletPage(browser, process.env.PAYER_PRIVATE_KEY, 'payer', {
    viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: false,
    ...video({ width: PHONE.width * 2, height: PHONE.height * 2 }, 'payer'),
  })
  await payer.ctx.addInitScript(CURSOR)
  const p = payer.page; const tp = Date.now()
  await p.goto(link)
  await p.getByRole('heading', { name: LABEL }).waitFor({ timeout: 30_000 }); mark('payer', tp, 'loaded')
  await wait(2_500)
  await connectWallet(p); mark('payer', tp, 'connected')
  await wait(1_000)
  await glideClick(p, p.getByRole('button', { name: new RegExp(`pay ${AMOUNT.replace('.', '\\.')}0? usdc`, 'i') })); mark('payer', tp, 'payClicked')
  await p.getByText(/payment (sent|received)/i).waitFor({ timeout: 60_000 }); mark('payer', tp, 'paid')
  await wait(4_000); mark('payer', tp, 'receiptShown')
  await payer.ctx.close()

  // ── Scene 4: merchant sees it paid and collects ────────────────────────────
  mark('merchant', tm, 'backToMerchant')
  await glideClick(m, m.getByRole('button', { name: /create another/i }))
  const card = m.locator('article', { hasText: LABEL })
  await card.getByText('Paid', { exact: true }).waitFor({ timeout: 30_000 }); mark('merchant', tm, 'seesPaid')
  await wait(2_000)
  await glideClick(m, card.getByRole('button', { name: /collect/i })); mark('merchant', tm, 'collectClicked')
  await card.getByText('Collected', { exact: true }).waitFor({ timeout: 60_000 }); mark('merchant', tm, 'collected')
  console.log(await card.getByText(/you received/i).textContent())
  await wait(3_500); mark('merchant', tm, 'end')
  await merchant.ctx.close()
} finally {
  await browser.close()
  fs.writeFileSync(path.join(OUT, 'marks.json'), JSON.stringify(marks, null, 2))
}
