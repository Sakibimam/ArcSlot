import { useEffect, useRef, useState } from 'react'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { LogoMark } from '@/components/Logo'
import { getFactoryAddress, ARC_MAINNET_ID } from '@/lib/chains'

// ── Helpers ──────────────────────────────────────────────────────────────────

function useNetworkStatus(): string {
  const mainnetLive = getFactoryAddress(ARC_MAINNET_ID) !== null
  return mainnetLive ? 'Live on Arc mainnet' : 'Live on Arc testnet'
}

/** Read prefers-reduced-motion once at mount. */
function usePrefersReducedMotion(): boolean {
  const [reduced] = useState(
    () => typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false),
  )
  return reduced
}

/** True once the element has scrolled into view (always true without IntersectionObserver). */
function useInView<T extends Element>(): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null)
  const [inView, setInView] = useState(() => typeof window === 'undefined' || !('IntersectionObserver' in window))
  useEffect(() => {
    if (inView || !ref.current) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setInView(true)
    }, { threshold: 0.35 })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [inView])
  return [ref, inView]
}

const usd = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ── Rosette ──────────────────────────────────────────────────────────────────
// The guilloché of a bank note: ellipses turned around one centre, plus rings.
// It turns very slowly, like an engraving lathe (motion-safe only).

export function Rosette({ className = '', petals = 18, rx = 420, ry = 130 }: {
  className?: string; petals?: number; rx?: number; ry?: number
}) {
  const r = rx + 30
  return (
    <svg viewBox={`${-r} ${-r} ${r * 2} ${r * 2}`} className={className} aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="0.8" className="motion-safe:animate-rosette">
        {Array.from({ length: petals }, (_, i) => (
          <ellipse key={i} rx={rx} ry={ry} transform={`rotate(${(180 / petals) * i})`} />
        ))}
        <circle r={rx * 0.62} />
        <circle r={rx * 0.635} />
        <circle r={rx * 0.36} />
      </g>
    </svg>
  )
}

// ── Hero receipt ─────────────────────────────────────────────────────────────
// A thermal receipt printing out of its slot. Every few seconds the next one
// prints, with the next serial. Under reduced motion it stays on the first.

export const HERO_RECEIPTS = [
  { payee: 'Rachel Mayer', item: 'Logo design', amount: 1000, net: 999.98 },
  { payee: 'Tomás Lindqvist', item: 'Translation', amount: 240, net: 239.98 },
  { payee: 'Aiko Tanaka', item: 'Product photos', amount: 680, net: 679.98 },
  { payee: 'Nørre Studio', item: 'Website retainer', amount: 2500, net: 2499.98 },
]
const RECEIPT_MS = 5_500

const RULE = '- - - - - - - - - - - - - - - - - - - -'
const TORN_EDGE =
  'M0 0H400' + Array.from({ length: 34 }, (_, i) => `L${400 - i * 12 - 6} 10L${400 - (i + 1) * 12} 0`).join('') + 'Z'

function HeroReceipt() {
  const reduced = usePrefersReducedMotion()
  const [n, setN] = useState(0)
  useEffect(() => {
    if (reduced) return
    const t = setInterval(() => setN((i) => i + 1), RECEIPT_MS)
    return () => clearInterval(t)
  }, [reduced])
  const r = HERO_RECEIPTS[n % HERO_RECEIPTS.length]
  const serial = `No. AS ${String(42 + n).padStart(4, '0')}`

  return (
    <figure className="flex flex-col items-center select-none" aria-label={`Example receipt: ${r.payee} receives ${usd(r.net)} USDC for a ${usd(r.amount)} invoice`}>
      {/* The slot */}
      <div className="relative z-10 flex h-[30px] w-full max-w-[480px] items-center justify-center rounded-full bg-ink shadow-[0_10px_24px_-12px_rgba(11,42,33,0.6)]">
        <div className="h-1 w-[84%] rounded-full bg-[#061611]" />
      </div>

      {/* Keyed by n, so each new receipt prints from the top again. */}
      <div key={n} className="-mt-[15px] w-[86%] max-w-[400px] motion-safe:animate-receipt-unroll" aria-live="off">
        <div className="relative overflow-hidden bg-surface px-6 sm:px-8 pb-7 pt-10 font-mono text-[13px] sm:text-[14px] text-ink shadow-[inset_1px_0_0_var(--rule),inset_-1px_0_0_var(--rule)]">
          <Rosette className="pointer-events-none absolute left-1/2 top-[42%] w-[300px] -translate-x-1/2 -translate-y-1/2 text-ink opacity-[0.06]" petals={9} rx={140} ry={44} />

          <div className="relative flex items-baseline justify-between">
            <span className="engraved text-[17px] tracking-[0.06em]" style={{ fontStretch: '125%' }}>ArcSlot</span>
            <span className="tracking-[0.1em] text-serial">{serial}</span>
          </div>
          <p className="relative mt-2 text-[11px] tracking-[0.06em] text-ink/80">ISSUED ON ARC · USDC</p>
          <p className="relative my-3 overflow-hidden whitespace-nowrap text-rule" aria-hidden="true">{RULE}</p>

          <dl className="relative space-y-2.5">
            <div className="flex justify-between gap-4"><dt>PAY TO</dt><dd className="text-right uppercase">{r.payee}</dd></div>
            <div className="flex justify-between gap-4"><dt className="uppercase">{r.item}</dt><dd className="tabular">{usd(r.amount)}</dd></div>
            <div className="flex justify-between gap-4"><dt>NETWORK FEE</dt><dd className="tabular">~0.02</dd></div>
            <div className="flex justify-between gap-4"><dt>PROCESSOR FEE</dt><dd className="tabular">0.00</dd></div>
          </dl>

          <p className="relative my-3 overflow-hidden whitespace-nowrap text-rule" aria-hidden="true">{RULE}</p>
          <div className="relative flex items-baseline justify-between gap-4">
            <span>YOU GET · USDC</span>
            <span className="dot text-[36px] sm:text-[42px] leading-none">{usd(r.net)}</span>
          </div>
          <p className="relative mt-3 text-[11px] leading-relaxed text-ink/80">
            WITH A 1.5% PROCESSOR: {usd(r.amount * 0.985)}
          </p>
          <p className="relative mt-4 text-center dot text-[28px] tracking-[0.3em] text-serial motion-safe:animate-stamp-in">
            *PAID*
          </p>
        </div>
        {/* Torn edge */}
        <svg viewBox="0 0 400 10" preserveAspectRatio="none" className="block h-2.5 w-full" aria-hidden="true">
          <path d={TORN_EDGE} fill="var(--surface)" />
        </svg>
      </div>
    </figure>
  )
}

// ── Ledger ────────────────────────────────────────────────────────────────────

interface LedgerRowProps {
  label: string
  sublabel: string
  amount: string
  barPct: number      // 0-100, proportional to fee
  highlight?: boolean
  drawn: boolean      // bars draw in once the ledger is in view
  delayMs: number
}

function LedgerRow({ label, sublabel, amount, barPct, highlight, drawn, delayMs }: LedgerRowProps) {
  return (
    <div className="py-5 border-b border-ink/25">
      <div className="flex items-baseline justify-between gap-4">
        <div className="min-w-0">
          <p className={['serial text-[13px] font-medium', highlight ? 'text-serial' : 'text-ink'].join(' ')}>
            {label}
          </p>
          <p className="text-[14px] mt-1 text-ink/80">{sublabel}</p>
        </div>
        <span
          className={['engraved tabular flex-none', highlight ? 'text-serial' : 'text-ink'].join(' ')}
          style={{ fontSize: 'clamp(26px,3.4vw,40px)', lineHeight: 1 }}
        >
          {amount}
        </span>
      </div>
      {/* Proportional bar, engraved as fine hatching */}
      <div className="mt-3 h-2 border border-ink/30">
        <div
          data-part="fee-bar"
          className={[highlight ? 'h-full bg-serial' : 'h-full', 'motion-safe:transition-[width] motion-safe:duration-1000 motion-safe:ease-out'].join(' ')}
          style={{
            width: drawn ? `${barPct}%` : '0%',
            minWidth: highlight && drawn ? 3 : undefined,
            transitionDelay: `${delayMs}ms`,
            backgroundImage: highlight ? undefined : 'repeating-linear-gradient(135deg, var(--ink) 0 1px, transparent 1px 4px)',
          }}
        />
      </div>
    </div>
  )
}

function Ledger() {
  const [ref, drawn] = useInView<HTMLDivElement>()
  return (
    <div ref={ref}>
      <LedgerRow label="Card payment" sublabel="2.36% average US credit interchange" amount="$23.60" barPct={100} drawn={drawn} delayMs={0} />
      <LedgerRow label="Stablecoin processor" sublabel="1.5% of every payment" amount="$15.00" barPct={64} drawn={drawn} delayMs={250} />
      <LedgerRow label="ArcSlot" sublabel="Network fee only" amount="~$0.02" barPct={0.09} highlight drawn={drawn} delayMs={700} />
    </div>
  )
}

// ── How it works ──────────────────────────────────────────────────────────────

const STEPS = [
  { n: '01', title: 'Make a link', body: "Amount, what it's for, and an optional expiry. It takes ten seconds.", tag: 'arc-slot.app/#/pay/…' },
  { n: '02', title: 'Your customer pays', body: 'They scan the QR code or open the link, and pay from any wallet, on Arc or from Ethereum, Base or Arbitrum.', tag: 'Scan or click' },
  { n: '03', title: 'The money is yours', body: 'It lands in your wallet, usually within seconds. Nobody can redirect it.', tag: '*PAID*' },
]

// ── Code sample ───────────────────────────────────────────────────────────────

const CODE_SAMPLE = `import { createWalletClient, http, parseUnits, toHex, padHex } from 'viem'
import { arcTestnet } from 'viem/chains'
import { SLOT_FACTORY_ABI } from './abis'

const walletClient = createWalletClient({
  account,                               // your 0x... address
  chain: arcTestnet,
  transport: http(),
})

const factory = '0x4baEfAb2E5fc17b7Ff69E6263d04d1D38319EB49'

const hash = await walletClient.writeContract({
  address: factory,
  abi: SLOT_FACTORY_ABI,
  functionName: 'createRequest',
  args: [
    merchant,                            // address
    padHex(toHex('invoice-001'), { size: 32 }), // payRef
    0,                                   // feeBps
    '0x0000000000000000000000000000000000000000',
    parseUnits('0.10', 6),               // maxReimbursement
    parseUnits('1000', 6),               // amount (1 000 USDC)
    'Logo design',                       // label
    0n,                                  // expiresAt (no expiry)
  ],
})`

const FAQ = [
  { q: 'Do I need an account?', a: 'No. Just a wallet.' },
  { q: 'Do I get dollars in my bank?', a: 'Not directly. You receive USDC, and you can cash out with any exchange.' },
  { q: 'What does it cost?', a: 'About 2 cents of network fees per payment. A collector pays the network fee to deliver your money and keeps a small tip from the payment, capped at 10%. You can always collect it yourself and pay only the network fee.' },
  { q: 'Is it audited?', a: 'Two security audits in Arc Studio and an independent review, with every finding fixed. There is no third-party audit yet.' },
  { q: 'What if a customer pays on the wrong network?', a: 'You can recover it from your dashboard.' },
]

const ctaPrimary =
  'inline-flex items-center justify-center h-14 px-7 bg-ink text-paper text-[16px] font-bold hover:bg-[#164537] active:translate-y-px transition-colors'
const ctaSecondary =
  'inline-flex items-center justify-center h-14 px-7 border-[1.5px] border-ink text-ink text-[16px] font-semibold hover:bg-ink hover:text-paper active:translate-y-px transition-colors'

// ── Main page ─────────────────────────────────────────────────────────────────

export function LandingPage() {
  const networkStatus = useNetworkStatus()
  const stepsRef = useRef<HTMLElement>(null)

  function scrollToSteps(e: React.MouseEvent) {
    e.preventDefault()
    stepsRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <div className="min-h-dvh bg-paper text-ink overflow-x-hidden">

      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 bg-paper/95 backdrop-blur-sm border-b border-ink/20">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-8 h-16 flex items-center justify-between gap-4">
          <a href="#/" className="inline-flex items-center gap-2.5 text-ink">
            <LogoMark className="size-9" />
            <span className="engraved text-[19px] tracking-[0.06em]" style={{ fontStretch: '125%' }}>ArcSlot</span>
          </a>
          <nav className="flex items-center gap-6 serial text-[12px]" aria-label="Site">
            <a href="#how-it-works" onClick={scrollToSteps} className="hidden md:inline hover:text-serial">How it works</a>
            <a href="#fees" className="hidden md:inline hover:text-serial">Fees</a>
            <a href="#agents" className="hidden md:inline hover:text-serial">For agents</a>
            <a href="#/app" className="inline-flex items-center h-10 px-4 bg-ink text-paper hover:bg-ink/90">Open app</a>
          </nav>
        </div>
      </header>

      <main>

        {/* ── Hero ────────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden">
          <Rosette className="pointer-events-none absolute -right-[22rem] -top-40 w-[900px] text-ink opacity-[0.08]" />
          <div className="relative mx-auto max-w-[1200px] px-4 sm:px-8 pt-14 pb-20 lg:pt-24 lg:pb-28">
            <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-14 lg:gap-12 items-start">

              <div className="lg:pt-6">
                <p className="serial text-[12px] sm:text-[13px] text-serial">Series 5042 · Issued on Arc</p>
                <h1
                  className="engraved mt-6 leading-[0.95]"
                  style={{ fontSize: 'clamp(40px, 5.2vw, 74px)' }}
                >
                  Get paid in USDC for cents, not percent.
                </h1>
                <p className="mt-7 text-[18px] text-ink/80 leading-relaxed max-w-[50ch]">
                  Every invoice gets its own address that can only pay you. Your customer pays
                  from any wallet, on Arc or from Ethereum, Base or Arbitrum. Nobody holds the
                  money, and nobody takes 1.5%.
                </p>
                <div className="mt-9 flex flex-wrap gap-3">
                  <a href="#/app" className={ctaPrimary}>Create a payment link</a>
                  <a href="#how-it-works" onClick={scrollToSteps} className={ctaSecondary}>See how it works</a>
                </div>
                <p className="mt-7 serial text-[11px] text-ink/80">{networkStatus}</p>
              </div>

              <HeroReceipt />
            </div>
          </div>
        </section>

        {/* ── Ledger ──────────────────────────────────────────────────────── */}
        <section id="fees" className="border-t border-ink/20">
          <div className="mx-auto max-w-[1200px] px-4 sm:px-8 py-20 grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-10 lg:gap-20">
            <div>
              <p className="serial text-[12px] text-serial">Schedule of fees</p>
              <h2 className="engraved mt-4 leading-[0.98]" style={{ fontSize: 'clamp(30px,4vw,52px)' }}>
                What a $1,000 invoice costs
              </h2>
              <p className="mt-5 text-[16px] text-ink/75 max-w-[40ch] leading-relaxed">
                Per payment, for comparison. Processors pay you out in dollars to a bank. ArcSlot
                pays you in USDC, straight to your wallet.
              </p>
            </div>
            <div>
              <Ledger />
              <p className="mt-5 text-[13px] text-ink/80">
                Sources:{' '}
                <a href="https://www.fool.com/money/research/average-credit-card-processing-fees-costs-america/" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-serial">Motley Fool Money</a>
                {' · '}
                <a href="https://finance.yahoo.com/news/stripe-charges-1-5-stablecoin-145737023.html" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-serial">Cryptonews via Yahoo Finance</a>
              </p>
            </div>
          </div>
        </section>

        {/* ── How it works ────────────────────────────────────────────────── */}
        <section id="how-it-works" ref={stepsRef} className="border-t border-ink/20">
          <div className="mx-auto max-w-[1200px] px-4 sm:px-8 py-20">
            <p className="serial text-[12px] text-serial">Terms of issue</p>
            <h2 className="engraved mt-4 mb-12" style={{ fontSize: 'clamp(30px,4vw,52px)' }}>How it works</h2>
            <ol className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {STEPS.map((s) => (
                <li key={s.n} className="note-frame bg-surface p-7 flex flex-col gap-4 motion-safe:transition-transform motion-safe:duration-200 hover:-translate-y-1">
                  <div className="flex items-baseline justify-between">
                    <span className="serial text-[12px] text-serial">No. {s.n}</span>
                    <span className={s.tag === '*PAID*' ? 'dot text-[15px] tracking-[0.2em] text-serial' : 'font-mono text-[12px] text-ink/80'}>{s.tag}</span>
                  </div>
                  <h3 className="engraved text-[22px] leading-tight">{s.title}</h3>
                  <p className="text-[15px] text-ink/75 leading-relaxed">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── Nobody holds your money + Why trust it ──────────────────────── */}
        <section className="relative overflow-hidden bg-ink text-paper">
          <Rosette className="pointer-events-none absolute -left-80 -bottom-80 w-[900px] text-paper opacity-[0.08]" />
          <div className="relative mx-auto max-w-[1200px] px-4 sm:px-8 py-20 grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20">
            <div>
              <h2 className="engraved leading-[0.97]" style={{ fontSize: 'clamp(30px,4.4vw,58px)', maxWidth: '14ch' }}>
                Nobody holds your money. Not even us.
              </h2>
              <ul className="mt-10 space-y-5">
                {[
                  'Every invoice gets its own address that can only pay you.',
                  'If this website disappeared tomorrow, your links would still work.',
                  'Sent on the wrong network? You can still recover it.',
                  "Circle's compliance checks are built in.",
                ].map((item, i) => (
                  <li key={item} className="flex gap-4 items-baseline">
                    <span className="serial text-[12px] text-[#F08A7E] flex-none">0{i + 1}</span>
                    <span className="text-[17px] text-paper/90 leading-snug">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="lg:border-l lg:border-paper/20 lg:pl-16">
              <h3 className="serial text-[12px] text-paper/80 mb-8">Why trust it</h3>
              <ul className="space-y-7">
                {[
                  { text: 'Stripe paid $1.1 billion for a stablecoin company and charges 1.5% per payment.', href: 'https://www.nbcnewyork.com/news/business/money-report/stripe-closes-1-1-billion-bridge-deal-prepares-for-aggressive-stablecoin-push/6135508/', linkText: 'NBC New York' },
                  { text: 'Business stablecoin payments grew 733% in 2025.', href: 'https://ambcrypto.com/stablecoin-volumes-surge-to-35-trillion-but-real-world-payments-still-lag-at-1/', linkText: 'AMBCrypto' },
                  { text: 'Audited twice in Arc Studio, reviewed independently, and open source.', href: 'https://github.com/Sakibimam/ArcSlot', linkText: 'GitHub' },
                ].map((fact) => (
                  <li key={fact.href} className="border-t border-paper/20 pt-5 text-[16px] text-paper/85 leading-relaxed">
                    {fact.text}{' '}
                    <a href={fact.href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 text-paper hover:text-[#F08A7E]">
                      {fact.linkText}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ── For apps and AI agents ───────────────────────────────────────── */}
        <section id="agents">
          <div className="mx-auto max-w-[1200px] px-4 sm:px-8 py-20">
            <p className="serial text-[12px] text-serial">For apps and AI agents</p>
            <h2 className="engraved mt-4 mb-4" style={{ fontSize: 'clamp(30px,4vw,52px)' }}>No API key. No sign-up.</h2>
            <p className="text-[17px] text-ink/75 mb-9 max-w-[52ch] leading-relaxed">
              Any app or agent can create and pay links on-chain. One contract call issues a link.
            </p>
            <div className="note-frame bg-ink text-paper">
              <div className="flex items-center justify-between border-b border-paper/15 px-5 py-3 serial text-[11px] text-paper/80">
                <span>createRequest · viem</span><span>Arc testnet</span>
              </div>
              <div className="overflow-x-auto">
                <pre className="font-mono text-[13px] leading-relaxed p-5 min-w-0" style={{ tabSize: 2 }} aria-label="viem code sample for createRequest">
                  <code>{CODE_SAMPLE}</code>
                </pre>
              </div>
            </div>
          </div>
        </section>

        {/* ── FAQ ─────────────────────────────────────────────────────────── */}
        <section className="border-t border-ink/20">
          <div className="mx-auto max-w-[1200px] px-4 sm:px-8 py-20 grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-10 lg:gap-20">
            <div>
              <p className="serial text-[12px] text-serial">Small print</p>
              <h2 className="engraved mt-4" style={{ fontSize: 'clamp(30px,4vw,52px)' }}>Questions</h2>
            </div>
            <Accordion type="single" collapsible>
              {FAQ.map((item, i) => (
                <AccordionItem key={i} value={`faq-${i}`} className="border-ink/25">
                  <AccordionTrigger className="text-left text-[17px] font-semibold text-ink hover:no-underline">
                    {item.q}
                  </AccordionTrigger>
                  <AccordionContent className="text-[16px] text-ink/75 leading-relaxed">
                    {item.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </section>

        {/* ── Final CTA ───────────────────────────────────────────────────── */}
        <section className="px-4 sm:px-8 pb-20">
          <div className="note-frame relative overflow-hidden mx-auto max-w-[1200px] bg-surface px-6 py-16 sm:py-20 text-center">
            <Rosette className="pointer-events-none absolute left-1/2 top-1/2 w-[760px] -translate-x-1/2 -translate-y-1/2 text-ink opacity-[0.06]" />
            <p className="relative serial text-[12px] text-serial">Series 5042 · Next issue</p>
            <h2 className="relative engraved mt-5 mb-9 mx-auto leading-[0.97]" style={{ fontSize: 'clamp(30px,4.4vw,58px)', maxWidth: '18ch' }}>
              Your next invoice could cost two cents.
            </h2>
            <a href="#/app" className={`relative ${ctaPrimary}`}>Create a payment link</a>
          </div>
        </section>
      </main>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="border-t border-ink/20">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-8 py-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 serial text-[11px] text-ink/80">
          <span>ArcSlot · Non-custodial USDC payments on Arc</span>
          <div className="flex items-center gap-5">
            <a href="https://github.com/Sakibimam/ArcSlot" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-serial">
              Open source on GitHub
            </a>
            <a href="https://studio.arc.io/" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-serial">
              Built with Arc Studio
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
