import { useRef, useState } from 'react'
import { QrCode } from 'lucide-react'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Separator } from '@/components/ui/separator'
import { LogoMark } from '@/components/Logo'
import { getFactoryAddress, ARC_MAINNET_ID } from '@/lib/chains'

// ── Helpers ──────────────────────────────────────────────────────────────────

function useNetworkStatus(): string {
  const mainnetLive = getFactoryAddress(ARC_MAINNET_ID) !== null
  return mainnetLive ? 'Live on Arc mainnet.' : 'Live on Arc testnet.'
}

/** Read prefers-reduced-motion once at mount (lazy initialiser avoids setState-in-effect). */
function usePrefersReducedMotion(): boolean {
  const [reduced] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false
  })
  return reduced
}

// ── Receipt ───────────────────────────────────────────────────────────────────
//
// The stamp is driven purely by a CSS animation (animation-delay 350 ms, `both`
// fill-mode so it starts invisible). No timer, no setState, no useEffect.

function HeroReceipt() {
  const reduced = usePrefersReducedMotion()

  // Zigzag mask: repeating triangles along the top and bottom edge.
  const zigzagMask = [
    'repeating-linear-gradient(',
    '  -45deg,',
    '  transparent,',
    '  transparent 5px,',
    '  white 5px,',
    '  white 10px',
    ')',
  ].join(' ')

  return (
    <div
      className="relative select-none"
      style={{ filter: 'drop-shadow(0 8px 32px rgba(19,35,58,0.13))' }}
      aria-hidden="true"
    >
      {/* Torn top edge */}
      <div
        className="h-3 w-full bg-surface"
        style={{
          WebkitMaskImage: zigzagMask,
          maskImage: zigzagMask,
        }}
      />

      {/* Receipt body */}
      <div
        className="bg-surface px-6 pt-5 pb-6"
        style={{ transform: 'rotate(-1.5deg)' }}
      >
        {/* Header */}
        <div className="mb-5 pb-4 border-b border-rule">
          <p className="text-[11px] font-medium text-ink/40 mb-1">
            Invoice 0042
          </p>
          <p className="text-base font-bold text-ink">To Priya Rao Design</p>
          <p className="text-[13px] text-ink/50 mt-0.5">Paid in USDC on Arc</p>
        </div>

        {/* Line items */}
        <div className="space-y-3 tabular">
          <div className="flex justify-between items-baseline">
            <span className="text-[15px] text-ink/70">Logo design</span>
            <span className="text-[20px] font-semibold text-ink tracking-tight">$1,000.00</span>
          </div>
          <div className="flex justify-between items-baseline">
            <span className="text-[13px] text-ink/50">Network fee</span>
            <span className="text-[15px] text-ink/50">~$0.02</span>
          </div>

          <Separator className="my-3 bg-rule" />

          <div className="flex justify-between items-baseline">
            <span className="text-[15px] font-bold text-ink">You receive</span>
            <span
              className="font-extrabold text-ink display-num"
              style={{ fontSize: '32px', lineHeight: 1, letterSpacing: '-0.01em' }}
            >
              $999.98
            </span>
          </div>
        </div>

        {/* Comparison */}
        <p className="mt-5 text-[12px] text-ink/35 tabular leading-snug">
          With a 1.5% processor you&apos;d receive $985.00
        </p>

        {/* PAID stamp — double-ring, pure CSS animation, never covers text */}
        <div className="mt-6 flex justify-end pr-2">
          <div
            className={reduced ? '' : 'animate-stamp-press'}
            style={reduced ? { opacity: 0.85, transform: 'rotate(-8deg)' } : undefined}
          >
            {/* Outer ring */}
            <div
              className="rounded-full border-[3px] border-paid p-[5px]"
              style={{ opacity: 0.85 }}
            >
              {/* Inner ring */}
              <div className="rounded-full border-[1.5px] border-paid px-5 py-2">
                <div className="text-center">
                  <p
                    className="text-paid font-extrabold tracking-[0.18em] leading-none"
                    style={{ fontSize: '22px' }}
                  >
                    PAID
                  </p>
                  <p className="text-paid text-[9px] tracking-widest mt-0.5 font-medium">
                    Oct 25, 2026
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Torn bottom edge */}
      <div
        className="h-3 w-full bg-surface"
        style={{
          WebkitMaskImage: zigzagMask,
          maskImage: zigzagMask,
          transform: 'scaleY(-1)',
        }}
      />
    </div>
  )
}

// ── Ledger ────────────────────────────────────────────────────────────────────

interface LedgerRowProps {
  label: string
  sublabel: string
  amount: string
  barPct: number      // 0-100, proportional to fee
  highlight?: boolean
}

function LedgerRow({ label, sublabel, amount, barPct, highlight }: LedgerRowProps) {
  return (
    <div className={['py-4 border-b border-rule', highlight ? 'text-paid' : 'text-ink'].join(' ')}>
      <div className="flex items-baseline justify-between gap-4">
        <div className="min-w-0">
          <p className={['text-[15px] font-semibold leading-snug', highlight ? 'text-paid' : 'text-ink'].join(' ')}>
            {label}
          </p>
          <p className={['text-[13px] mt-0.5', highlight ? 'text-paid/70' : 'text-ink/50'].join(' ')}>
            {sublabel}
          </p>
        </div>
        <span
          className={['tabular font-bold flex-none', highlight ? 'text-paid' : 'text-ink'].join(' ')}
          style={{ fontSize: '26px', lineHeight: 1, letterSpacing: '-0.01em' }}
        >
          {amount}
        </span>
      </div>
      {/* Proportional bar */}
      <div className="mt-2.5 h-1.5 rounded-full bg-rule/40 overflow-hidden">
        <div
          className={['h-full rounded-full', highlight ? 'bg-paid' : 'bg-ink/25'].join(' ')}
          style={{ width: `${barPct}%` }}
        />
      </div>
    </div>
  )
}

// ── How it works ──────────────────────────────────────────────────────────────

function StepSequence() {
  const steps = [
    {
      n: '1',
      title: 'Make a link',
      body: 'Amount, what it\'s for, and an optional expiry. It takes ten seconds.',
      fragment: (
        <span className="inline-flex items-center h-6 px-2.5 rounded-full border border-carbon/30 bg-carbon/5 text-carbon text-[11px] font-medium truncate max-w-[200px]">
          arc-slot.app/#/pay/…
        </span>
      ),
    },
    {
      n: '2',
      title: 'Your customer pays',
      body: 'They scan the QR code or open the link, and pay from any wallet, on Arc or from Ethereum, Base or Arbitrum.',
      fragment: (
        <span className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full border border-rule bg-paper text-ink/60 text-[11px] font-medium">
          <QrCode size={12} aria-hidden="true" />
          Scan or click
        </span>
      ),
    },
    {
      n: '3',
      title: 'The money is yours',
      body: 'It lands in your wallet, usually within seconds. Nobody can redirect it.',
      fragment: (
        <span className="inline-flex items-center h-6 px-2.5 rounded-full bg-paid/10 text-paid text-[11px] font-semibold border border-paid/20">
          Paid
        </span>
      ),
    },
  ]

  return (
    <ol>
      {/* Desktop: horizontal with connector line */}
      <div className="hidden sm:flex items-start gap-0">
        {steps.map((step, i) => (
          <li key={step.n} className="flex-1 flex items-start gap-0">
            <div className="flex-1 pr-8">
              <div className="flex items-center gap-3 mb-3">
                <span className="w-7 h-7 rounded-full border-2 border-ink flex-none flex items-center justify-center text-[13px] font-bold text-ink tabular">
                  {step.n}
                </span>
                <div className="h-px flex-1 bg-rule" />
              </div>
              <div className="mb-3">{step.fragment}</div>
              <h3 className="text-[15px] font-bold text-ink mb-1">{step.title}</h3>
              <p className="text-[14px] text-ink/60 leading-relaxed">{step.body}</p>
            </div>
            {i < steps.length - 1 && <div className="w-px" />}
          </li>
        ))}
      </div>

      {/* Mobile: vertical with left rule */}
      <div className="sm:hidden relative pl-7">
        <div className="absolute left-3 top-2 bottom-2 w-px bg-rule" />
        {steps.map((step) => (
          <li key={step.n} className="relative mb-10 last:mb-0">
            <span className="absolute -left-7 w-6 h-6 rounded-full border-2 border-ink bg-paper flex items-center justify-center text-[11px] font-bold text-ink tabular">
              {step.n}
            </span>
            <div className="mb-2">{step.fragment}</div>
            <h3 className="text-[15px] font-bold text-ink mb-1">{step.title}</h3>
            <p className="text-[14px] text-ink/60 leading-relaxed">{step.body}</p>
          </li>
        ))}
      </div>
    </ol>
  )
}

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
      <header className="sticky top-0 z-30 bg-paper/90 backdrop-blur-sm border-b border-rule">
        <div className="mx-auto max-w-[1120px] px-4 sm:px-6 h-14 flex items-center justify-between">
          <a href="#/" className="inline-flex items-center gap-1.5 font-bold text-ink tracking-tight text-[15px]">
            <LogoMark />
            ArcSlot
          </a>
          <a
            href="#/app"
            className="inline-flex items-center h-9 px-4 rounded bg-ink text-paper text-[13px] font-semibold hover:bg-ink/90 focus-visible:outline-2 focus-visible:outline-carbon transition-colors"
          >
            Open app
          </a>
        </div>
      </header>

      <main>

        {/* ── Hero ────────────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-[1120px] px-4 sm:px-6 pt-14 pb-0 lg:pt-20">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_460px] gap-10 lg:gap-16 items-start">

            {/* Copy */}
            <div className="lg:pt-10">
              <h1
                className="font-extrabold text-ink leading-[0.95] tracking-tight"
                style={{
                  fontSize: 'clamp(44px, 6vw, 88px)',
                  maxWidth: '12ch',
                }}
              >
                Get paid in USDC for cents, not percent.
              </h1>
              <p className="mt-6 text-[17px] text-ink/65 leading-relaxed max-w-[48ch]">
                Create a payment link for any invoice. Your customer pays from
                any wallet, on Arc or from Ethereum, Base or Arbitrum. The money
                goes straight to your wallet. No processor holds it, and nobody
                takes 1.5%.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a
                  href="#/app"
                  className="inline-flex items-center h-12 px-7 rounded bg-ink text-paper text-[15px] font-semibold hover:bg-ink/90 focus-visible:outline-2 focus-visible:outline-carbon transition-colors"
                >
                  Create a payment link
                </a>
                <a
                  href="#how-it-works"
                  onClick={scrollToSteps}
                  className="inline-flex items-center h-12 px-7 rounded border border-rule text-ink text-[15px] font-medium hover:bg-rule/30 focus-visible:outline-2 focus-visible:outline-carbon transition-colors"
                >
                  See how it works
                </a>
              </div>
              <p className="mt-6 text-[13px] text-ink/35">{networkStatus}</p>
            </div>

            {/* Receipt — overhangs hero bottom on lg */}
            <div className="lg:translate-y-12 w-full max-w-[460px] mx-auto lg:mx-0">
              <HeroReceipt />
            </div>
          </div>
        </section>

        {/* Spacer to accommodate the receipt overhang on lg */}
        <div className="hidden lg:block h-20" />

        {/* ── Ledger ──────────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-[1120px] px-4 sm:px-6 py-16">
          <h2 className="font-bold text-ink mb-1" style={{ fontSize: 'clamp(22px,3vw,32px)' }}>
            What a $1,000 invoice costs
          </h2>
          <p className="text-[14px] text-ink/50 mb-8">Per payment, for comparison.</p>

          <div className="max-w-xl">
            <LedgerRow
              label="Card payment"
              sublabel="2.36% average US credit interchange"
              amount="$23.60"
              barPct={100}
            />
            <LedgerRow
              label="Stablecoin processor"
              sublabel="1.5% of every payment"
              amount="$15.00"
              barPct={64}
            />
            <LedgerRow
              label="ArcSlot"
              sublabel="Network fee only"
              amount="~$0.02"
              barPct={0.09}
              highlight
            />
          </div>

          <p className="mt-6 text-[15px] text-ink/60 max-w-[52ch] leading-relaxed">
            Processors pay you out in dollars to a bank. ArcSlot pays you in
            USDC, straight to your wallet.
          </p>
          <p className="mt-3 text-[13px] text-ink/40">
            Sources:{' '}
            <a
              href="https://www.fool.com/money/research/average-credit-card-processing-fees-costs-america/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-carbon"
            >
              Motley Fool Money
            </a>
            {' · '}
            <a
              href="https://finance.yahoo.com/news/stripe-charges-1-5-stablecoin-145737023.html"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-carbon"
            >
              Cryptonews via Yahoo Finance
            </a>
          </p>
        </section>

        {/* ── How it works ────────────────────────────────────────────────── */}
        <section
          id="how-it-works"
          ref={stepsRef}
          className="mx-auto max-w-[1120px] px-4 sm:px-6 py-16 border-t border-rule"
        >
          <h2 className="font-bold text-ink mb-10" style={{ fontSize: 'clamp(22px,3vw,32px)' }}>
            How it works
          </h2>
          <StepSequence />
        </section>

        {/* ── Nobody holds your money + Why trust it (merged) ─────────────── */}
        <section className="border-t border-rule">
          <div className="mx-auto max-w-[1120px] px-4 sm:px-6 py-16">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-20">

              {/* Left: statement */}
              <div>
                <h2
                  className="font-extrabold text-ink leading-[0.97] tracking-tight"
                  style={{ fontSize: 'clamp(28px,4vw,52px)', maxWidth: '14ch' }}
                >
                  Nobody holds your money. Not even us.
                </h2>
                <ul className="mt-8 space-y-4">
                  {[
                    'Every invoice gets its own address that can only pay you.',
                    'If this website disappeared tomorrow, your links would still work.',
                    'Sent on the wrong network? You can still recover it.',
                    "Circle's compliance checks are built in.",
                  ].map((item) => (
                    <li key={item} className="flex gap-3 items-start">
                      <span className="mt-0.5 w-5 h-5 rounded-full bg-paid/12 text-paid flex-none flex items-center justify-center">
                        <svg viewBox="0 0 12 10" fill="none" className="w-3 h-3" aria-hidden="true">
                          <path d="M1 5l3 3 7-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                      <span className="text-[16px] text-ink/75 leading-snug">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Right: facts */}
              <div>
                <h3 className="text-[13px] font-semibold text-ink/35 mb-6">
                  Why trust it
                </h3>
                <ul className="space-y-6">
                  {[
                    {
                      text: 'Stripe paid $1.1 billion for a stablecoin company and charges 1.5% per payment.',
                      href: 'https://www.nbcnewyork.com/news/business/money-report/stripe-closes-1-1-billion-bridge-deal-prepares-for-aggressive-stablecoin-push/6135508/',
                      linkText: 'NBC New York',
                    },
                    {
                      text: 'Business stablecoin payments grew 733% in 2025.',
                      href: 'https://ambcrypto.com/stablecoin-volumes-surge-to-35-trillion-but-real-world-payments-still-lag-at-1/',
                      linkText: 'AMBCrypto',
                    },
                    {
                      text: 'Audited twice in Arc Studio, reviewed independently, and open source.',
                      href: 'https://github.com/Sakibimam/ArcSlot',
                      linkText: 'GitHub',
                    },
                  ].map((fact) => (
                    <li key={fact.href} className="flex gap-3 items-start">
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-carbon flex-none" aria-hidden="true" />
                      <span className="text-[15px] text-ink/70 leading-relaxed">
                        {fact.text}{' '}
                        <a
                          href={fact.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-carbon underline underline-offset-2 hover:text-carbon/80"
                        >
                          {fact.linkText}
                        </a>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ── For apps and AI agents ───────────────────────────────────────── */}
        <section className="border-t border-rule">
          <div className="mx-auto max-w-[1120px] px-4 sm:px-6 py-16">
            <h2 className="font-bold text-ink mb-2" style={{ fontSize: 'clamp(22px,3vw,32px)' }}>
              For apps and AI agents
            </h2>
            <p className="text-[16px] text-ink/60 mb-7 max-w-[52ch] leading-relaxed">
              Any app or agent can create and pay links on-chain. No API key, no sign-up.
            </p>
            <div className="overflow-x-auto rounded border border-rule bg-surface">
              <pre
                className="text-[13px] leading-relaxed text-ink p-5 min-w-0"
                style={{ fontFamily: '"Schibsted Grotesk", sans-serif', tabSize: 2 }}
                aria-label="viem code sample for createRequest"
              >
                <code>{CODE_SAMPLE}</code>
              </pre>
            </div>
          </div>
        </section>

        {/* ── FAQ ─────────────────────────────────────────────────────────── */}
        <section className="border-t border-rule">
          <div className="mx-auto max-w-[1120px] px-4 sm:px-6 py-16">
            <h2 className="font-bold text-ink mb-8" style={{ fontSize: 'clamp(22px,3vw,32px)' }}>
              Questions
            </h2>
            <Accordion type="single" collapsible className="max-w-2xl">
              {[
                {
                  q: 'Do I need an account?',
                  a: 'No. Just a wallet.',
                },
                {
                  q: 'Do I get dollars in my bank?',
                  a: 'Not directly. You receive USDC, and you can cash out with any exchange.',
                },
                {
                  q: 'What does it cost?',
                  a: 'About 2 cents of network fees per payment. A collector pays the network fee to deliver your money and keeps a small tip from the payment, capped at 10%. You can always collect it yourself and pay only the network fee.',
                },
                {
                  q: 'Is it audited?',
                  a: 'Two security audits in Arc Studio and an independent review, with every finding fixed. There is no third-party audit yet.',
                },
                {
                  q: 'What if a customer pays on the wrong network?',
                  a: 'You can recover it from your dashboard.',
                },
              ].map((item, i) => (
                <AccordionItem key={i} value={`faq-${i}`}>
                  <AccordionTrigger className="text-left text-[15px] font-medium text-ink">
                    {item.q}
                  </AccordionTrigger>
                  <AccordionContent className="text-[15px] text-ink/65 leading-relaxed">
                    {item.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </section>

        {/* ── Final CTA ───────────────────────────────────────────────────── */}
        <section className="bg-ink">
          <div className="mx-auto max-w-[1120px] px-4 sm:px-6 py-20 text-center">
            <h2
              className="font-extrabold text-paper leading-[0.97] tracking-tight mb-8"
              style={{ fontSize: 'clamp(28px,4vw,52px)' }}
            >
              Your next invoice could cost two cents.
            </h2>
            <a
              href="#/app"
              className="inline-flex items-center h-12 px-8 rounded bg-paper text-ink text-[15px] font-semibold hover:bg-paper/90 focus-visible:outline-2 focus-visible:outline-carbon transition-colors"
            >
              Create a payment link
            </a>
          </div>
        </section>
      </main>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="border-t border-rule bg-paper">
        <div className="mx-auto max-w-[1120px] px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-[13px] text-ink/40">
          <span>ArcSlot. Non-custodial USDC payments on Arc.</span>
          <div className="flex items-center gap-4">
            <a
              href="https://github.com/Sakibimam/ArcSlot"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-carbon"
            >
              Open source on GitHub
            </a>
            <span className="text-ink/20" aria-hidden="true">|</span>
            <span className="text-ink/30">Built with Arc Studio</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
