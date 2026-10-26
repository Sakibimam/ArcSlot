import { useEffect, useRef, useState } from 'react'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { LogoMark } from '@/components/Logo'
import { getFactoryAddress, ARC_MAINNET_ID } from '@/lib/chains'
import { SkyHero, useMorphMode, HERO_RECEIPTS } from '@/components/SkyHero'

export { HERO_RECEIPTS }

// ── How it works ─────────────────────────────────────────────────────────────

const STEPS = [
  { n: '01', title: 'Make a link', body: "Amount, what it's for, and an optional expiry. It takes ten seconds.", tag: 'arc-slot.app/#/pay/…' },
  { n: '02', title: 'Your customer pays', body: "They scan the QR code or open the link and pay from any wallet: on Arc, or from Ethereum, Base or Arbitrum through Circle's CCTP.", tag: 'Scan or click' },
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
  { q: 'Can customers pay from another chain?', a: "Yes. Circle's CCTP moves their USDC from Ethereum, Base, Arbitrum, OP Mainnet, Polygon or Avalanche, and Circle's Forwarding Service delivers exactly the requested amount into your request on Arc. They cover a small relayer fee on their side; you receive the full amount." },
  { q: 'Do I get dollars in my bank?', a: 'Not directly. You receive USDC, and you can cash out with any exchange.' },
  { q: 'What does it cost?', a: 'About 2 cents of network fees per payment. A collector pays the network fee to deliver your money and keeps a small tip from the payment, capped at 10%. You can always collect it yourself and pay only the network fee.' },
  { q: 'Is it audited?', a: 'Two security audits in Arc Studio and an independent review, with every finding fixed. There is no third-party audit yet.' },
  { q: 'What if a customer pays on the wrong network?', a: 'You can recover it from your dashboard.' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

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


// ── Rosette ───────────────────────────────────────────────────────────────────

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

// ── Ledger ────────────────────────────────────────────────────────────────────

interface LedgerRowProps {
  label: string
  sublabel: string
  amount: string
  barPct: number
  highlight?: boolean
  drawn: boolean
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

// ── Photo card ────────────────────────────────────────────────────────────────

interface PhotoCardProps {
  src: string
  alt: string
  role: string
  tall?: boolean
  children: React.ReactNode
}

function PhotoCard({ src, alt, role, tall = false, children }: PhotoCardProps) {
  const [ref, inView] = useInView<HTMLDivElement>()
  const height = tall ? 470 : 420

  return (
    <div
      ref={ref}
      className="relative overflow-hidden transition-all duration-300 motion-safe:hover:-translate-y-1"
      style={{
        width: tall ? 340 : 300,
        height,
        maxWidth: '100%',
        borderRadius: 22,
        background: '#4B5651',
        flexShrink: 0,
      }}
    >
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        aria-hidden="true"
        className="absolute inset-0 w-full h-full object-cover"
        style={{
          objectPosition: role === 'DESIGNER' ? '66% 40%' : role === 'STRATEGIST' ? '50% 30%' : '30% 35%',
          ...(inView
            ? { animation: 'card-reveal 700ms cubic-bezier(.15,.5,.5,1) both' }
            : { clipPath: 'inset(18% 12% round 24px)', transform: 'scale(1.06)' }),
        }}
      />

      {/* Gradient overlay */}
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(180deg, rgba(0,0,0,0) 45%, rgba(0,0,0,0.50) 100%)',
          borderRadius: 22,
        }}
      />

      {/* Role chip */}
      <span
        className="absolute left-4 top-4 rounded-full px-3 py-1.5 serial text-[11px] font-medium text-ink"
        style={{ background: 'rgba(255,255,255,0.92)' }}
      >
        {role}
      </span>

      {children}
    </div>
  )
}

// ── Section blur-in wrapper ───────────────────────────────────────────────────

function BlurIn({ children, delay = 0, className = '' }: { children: React.ReactNode; delay?: number; className?: string }) {
  const [ref, inView] = useInView<HTMLDivElement>()
  const reduced = usePrefersReducedMotion()
  return (
    <div
      ref={ref}
      data-reveal
      className={className}
      style={reduced ? undefined : inView
        ? { animation: `blur-in 600ms cubic-bezier(.15,.5,.5,1) ${delay}ms both` }
        : { opacity: 0 }}
    >
      {children}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function LandingPage() {
  const networkStatus = useNetworkStatus()
  const morph = useMorphMode()
  const stepsRef = useRef<HTMLElement>(null)

  return (
    <div className="min-h-dvh bg-paper text-ink [overflow-x:clip]">

      {/* Desktop with motion: the pinned sky hero that morphs into the cards row.
          Phones, tablets and reduced motion: a static hero. Only one is ever rendered. */}
      <SkyHero morph={morph} networkStatus={networkStatus} />

      <main>

        {/* ── At a glance ───────────────────────────────────────────────────── */}
        <section className="border-t border-ink/20">
          <div className="mx-auto max-w-[1200px] px-4 sm:px-8">
            <ul
              aria-label="At a glance"
              className="grid grid-cols-3 divide-x divide-ink/15 border-b border-ink/15"
            >
              {([
                ['Fee per payment', '~$0.02'],
                ['Settles', 'under a second'],
                ['Who holds it', 'No custody'],
              ] as const).map(([k, v]) => (
                <li key={k} className="py-6 px-4 sm:px-8 first:pl-0 last:pr-0">
                  <p className="serial text-[10px] sm:text-[11px] text-ink/75">{k}</p>
                  <p className="mt-2 text-[15px] sm:text-[17px] font-semibold text-ink">{v}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── Get paid by anyone, anywhere ─────────────────────────────────── */}
        {/* In morph mode this row is part of the pinned hero stage instead. */}
        {!morph && (
        <section className="py-20 sm:py-24 px-4 sm:px-8 bg-white">
          <div className="mx-auto max-w-[1200px]">
            <BlurIn className="text-center mb-12 sm:mb-16">
              <p className="serial text-[12px] text-serial mb-4">Series 5042 · Issued on Arc</p>
              <h2
                className="heading-tight mx-auto"
                style={{ fontSize: 'clamp(36px,5vw,64px)', lineHeight: 1, maxWidth: '16ch' }}
              >
                Get paid by anyone,{' '}
                <span className="font-serif italic" style={{ fontWeight: 400 }}>anywhere.</span>
              </h2>
              <p className="mt-5 text-[17px] sm:text-[20px] leading-[1.45] text-ink/80 mx-auto max-w-[52ch]">
                Every invoice gets its own address that can only pay you. Clients pay from Arc,
                Ethereum, Base or Arbitrum. You keep all of it, minus about two cents.
              </p>
              <a
                href="#/app"
                className="mt-7 inline-flex items-center h-12 px-7 rounded-full text-[15px] font-semibold text-paper bg-ink hover:bg-ink/90 transition-all hover:-translate-y-px hover:shadow-md"
              >
                Create a payment link
              </a>
            </BlurIn>

            {/* Photo cards */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-end justify-center gap-5 sm:gap-6">

              <PhotoCard src="/images/card-designer.jpg" alt="" role="DESIGNER">
                <div className="absolute left-3 right-3 bottom-3 bg-white rounded-[14px] px-3.5 py-3 flex items-center gap-3 shadow-[0_12px_30px_-14px_rgba(0,0,0,0.5)]">
                  <span className="shrink-0 w-8 h-8 rounded-full bg-ink flex items-center justify-center"><LogoMark className="size-4 text-white" /></span>
                  <div className="grow min-w-0"><p className="text-[14px] font-semibold text-ink leading-tight">Packaging design</p><p className="text-[11px] text-ink/80 mt-0.5">From Ethereum · today, 09:02</p></div>
                  <div className="text-right shrink-0"><p className="dot text-[16px] text-ink">+850.00</p><p className="dot text-[10px] tracking-[0.2em] text-serial mt-0.5">*PAID*</p></div>
                </div>
              </PhotoCard>


              <PhotoCard src="/images/card-consultant.jpg" alt="" role="CONSULTANT">
                <div className="absolute left-3 right-3 bottom-3 bg-white rounded-[14px] px-3.5 py-3 flex items-center gap-3 shadow-[0_12px_30px_-14px_rgba(0,0,0,0.5)]">
                  <span className="shrink-0 w-8 h-8 rounded-full bg-ink flex items-center justify-center"><LogoMark className="size-4 text-white" /></span>
                  <div className="grow min-w-0"><p className="text-[14px] font-semibold text-ink leading-tight">Strategy session</p><p className="text-[11px] text-ink/80 mt-0.5">Waiting · link sent 10:40</p></div>
                  <div className="text-right shrink-0"><p className="dot text-[16px] text-ink">300.00</p><p className="serial text-[10px] mt-0.5" style={{ color: '#8A5300' }}>PENDING</p></div>
                </div>
              </PhotoCard>

            </div>
          </div>
        </section>
        )}

        {/* ── Ledger ──────────────────────────────────────────────────────── */}
        <section id="fees" className="border-t border-ink/20">
          <div className="mx-auto max-w-[1200px] px-4 sm:px-8 py-20 grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-10 lg:gap-20">
            <BlurIn>
              <p className="serial text-[12px] text-serial">Schedule of fees</p>
              <h2 className="heading-tight mt-4 leading-[0.98]" style={{ fontSize: 'clamp(30px,4vw,52px)' }}>
                What a $1,000 invoice costs
              </h2>
              <p className="mt-5 text-[16px] text-ink/80 max-w-[40ch] leading-relaxed">
                Per payment, for comparison. Processors pay you out in dollars to a bank. ArcSlot
                pays you in USDC, straight to your wallet.
              </p>
            </BlurIn>
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
            <BlurIn>
              <p className="serial text-[12px] text-serial">Terms of issue</p>
              <h2 className="heading-tight mt-4 mb-12" style={{ fontSize: 'clamp(30px,4vw,52px)' }}>
                How it works
              </h2>
            </BlurIn>
            <ol className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {STEPS.map((s) => (
                <li
                  key={s.n}
                  className="bg-surface rounded-[18px] p-7 flex flex-col gap-4 transition-all duration-200 motion-safe:hover:-translate-y-1"
                  style={{ border: '1px solid rgba(11,42,33,0.10)', boxShadow: '0 30px 60px -20px rgba(11,42,33,0.25)' }}
                >
                  <div className="flex items-baseline justify-between">
                    <span className="serial text-[12px] text-serial">No. {s.n}</span>
                    <span className={s.tag === '*PAID*' ? 'dot text-[15px] tracking-[0.2em] text-serial' : 'font-mono text-[12px] text-ink/80'}>{s.tag}</span>
                  </div>
                  <h3 className="heading-tight text-[22px] leading-tight">{s.title}</h3>
                  <p className="text-[15px] text-ink/80 leading-relaxed">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── Nobody holds your money ──────────────────────────────────────── */}
        <section className="relative overflow-hidden bg-ink text-paper">
          <Rosette className="pointer-events-none absolute -left-80 -bottom-80 w-[900px] text-paper opacity-[0.08]" />
          <div className="relative mx-auto max-w-[1200px] px-4 sm:px-8 py-20 grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20">
            <BlurIn>
              <h2 className="heading-tight leading-[0.97] text-paper" style={{ fontSize: 'clamp(30px,4.4vw,58px)', maxWidth: '14ch' }}>
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
            </BlurIn>
            <BlurIn delay={120} className="lg:border-l lg:border-paper/20 lg:pl-16">
              <h3 className="serial text-[12px] text-paper/80 mb-8">Why trust it</h3>
              <ul className="space-y-7">
                {[
                  { text: 'Stripe paid $1.1 billion for a stablecoin company and charges 1.5% per payment.', href: 'https://www.nbcnewyork.com/news/business/money-report/stripe-closes-1-1-billion-bridge-deal-prepares-for-aggressive-stablecoin-push/6135508/', linkText: 'NBC New York' },
                  { text: 'Business stablecoin payments grew 733% in 2025.', href: 'https://ambcrypto.com/stablecoin-volumes-surge-to-35-trillion-but-real-world-payments-still-lag-at-1/', linkText: 'AMBCrypto' },
                  { text: 'Audited twice in Arc Studio, reviewed independently, and open source.', href: 'https://github.com/Sakibimam/ArcSlot', linkText: 'GitHub' },
                ].map((fact) => (
                  <li key={fact.href} className="border-t border-paper/20 pt-5 text-[16px] text-paper/85 leading-relaxed">
                    {fact.text}{' '}
                    <a href={fact.href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 text-paper hover:text-[#F08A7E]">{fact.linkText}</a>
                  </li>
                ))}
              </ul>
            </BlurIn>
          </div>
        </section>

        {/* ── For apps and AI agents ───────────────────────────────────────── */}
        <section id="agents">
          <div className="mx-auto max-w-[1200px] px-4 sm:px-8 py-20">
            <BlurIn>
              <p className="serial text-[12px] text-serial">For apps and AI agents</p>
              <h2 className="heading-tight mt-4 mb-4" style={{ fontSize: 'clamp(30px,4vw,52px)' }}>No API key. No sign-up.</h2>
              <p className="text-[17px] text-ink/80 mb-9 max-w-[52ch] leading-relaxed">
                Any app or agent can create and pay links on-chain. One contract call issues a link.
              </p>
            </BlurIn>
            <div
              className="bg-ink text-paper rounded-[18px] overflow-hidden"
              style={{ border: '1px solid rgba(255,255,255,0.08)' }}
            >
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
            <BlurIn>
              <p className="serial text-[12px] text-serial">Small print</p>
              <h2 className="heading-tight mt-4" style={{ fontSize: 'clamp(30px,4vw,52px)' }}>Questions</h2>
            </BlurIn>
            <Accordion type="single" collapsible>
              {FAQ.map((item, i) => (
                <AccordionItem key={i} value={`faq-${i}`} className="border-ink/25">
                  <AccordionTrigger className="text-left text-[17px] font-semibold text-ink hover:no-underline">
                    {item.q}
                  </AccordionTrigger>
                  <AccordionContent className="text-[16px] text-ink/80 leading-relaxed">
                    {item.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </section>

        {/* ── Final CTA ───────────────────────────────────────────────────── */}
        <section className="px-4 sm:px-8 pb-20">
          <div
            className="relative overflow-hidden mx-auto max-w-[1200px] bg-surface px-6 py-16 sm:py-20 text-center rounded-[24px]"
            style={{ border: '1px solid rgba(11,42,33,0.10)', boxShadow: '0 30px 60px -20px rgba(11,42,33,0.25)' }}
          >
            <Rosette className="pointer-events-none absolute left-1/2 top-1/2 w-[760px] -translate-x-1/2 -translate-y-1/2 text-ink opacity-[0.06]" />
            <p className="relative serial text-[12px] text-serial">Series 5042 · Next issue</p>
            <h2
              className="relative heading-tight mt-5 mb-9 mx-auto leading-[0.97]"
              style={{ fontSize: 'clamp(30px,4.4vw,58px)', maxWidth: '18ch' }}
            >
              Your next invoice could cost two cents.
            </h2>
            <a
              href="#/app"
              className="relative inline-flex items-center h-12 px-8 rounded-full text-[15px] font-semibold text-paper bg-ink hover:bg-ink/90 transition-all hover:-translate-y-px hover:shadow-md"
            >
              Create a payment link
            </a>
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
