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
  { n: '03', title: 'The money is yours', body: 'It settles within seconds at an address only you can collect from. One click moves it to your wallet.', tag: '*PAID*' },
]

// ── createRequest, as shown in "Let your software get paid" ──────────────────
// One entry per ABI input, in order; LandingPage.test checks it against SLOT_FACTORY_ABI.

export const CREATE_REQUEST_ARGS = [
  { param: 'merchant', value: 'merchant' },
  { param: 'payRef', value: 'payRef' },
  { param: 'feeBps', value: '0' },
  { param: 'feeRecipient', value: 'zeroAddress' },
  { param: 'maxReimbursement', value: "parseUnits('0.05', 6)" },
  { param: 'amount', value: "parseUnits('1000', 6)" },
  { param: 'label', value: "'Logo design'" },
  { param: 'expiresAt', value: '0n' },
] as const

// ── FAQ ───────────────────────────────────────────────────────────────────────

const FAQ = [
  { q: 'Do I need an account?', a: 'No. Just a wallet.' },
  { q: 'Can customers pay from another chain?', a: "Yes. Circle's CCTP moves their USDC from Ethereum, Base, Arbitrum, OP Mainnet, Polygon or Avalanche, and Circle's Forwarding Service delivers exactly the requested amount into your request on Arc. They cover a small relayer fee on their side; you receive the full amount." },
  { q: 'Do I get dollars in my bank?', a: 'Not directly. You receive USDC, and you can cash out with any exchange.' },
  { q: 'What does it cost?', a: 'About 2 cents of network fees per payment. A collector pays the network fee to deliver your money and keeps a small tip from the payment, capped at 10%. You can always collect it yourself and pay only the network fee.' },
  { q: 'Is it audited?', a: 'Two security audits in Arc Studio and an independent review, with every finding fixed. There is no third-party audit yet.' },
  { q: 'What if a customer pays on the wrong network?', a: 'You can recover it from your dashboard.' },
]

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

// ── Value propositions ───────────────────────────────────────────────────────

const TWIST = 'font-serif italic font-normal whitespace-nowrap'
const CTA =
  'mt-8 inline-flex items-center h-12 px-7 rounded-full text-[16px] font-semibold transition-all hover:-translate-y-px hover:shadow-md'

function Story({ id, labelId, title, lead, cta, visual, visualFirst = false, tone = 'paper' }: {
  id?: string
  labelId: string
  title: React.ReactNode
  lead: string
  cta: { text: string; href: string }
  visual: React.ReactNode
  /** On desktop, put the visual on the left. On phones the text always comes first. */
  visualFirst?: boolean
  tone?: 'paper' | 'white' | 'ink'
}) {
  const dark = tone === 'ink'
  const external = cta.href.startsWith('https://')
  return (
    <section
      id={id}
      aria-labelledby={labelId}
      className={[
        'relative overflow-hidden',
        tone === 'white' ? 'bg-surface' : dark ? 'bg-ink text-paper' : 'bg-paper',
      ].join(' ')}
    >
      {dark && <Rosette className="pointer-events-none absolute -right-80 -bottom-80 w-[900px] text-paper opacity-[0.08]" />}
      <div className="relative mx-auto max-w-[1200px] px-4 sm:px-8 py-20 lg:py-28 grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
        <BlurIn className={visualFirst ? 'lg:order-2' : ''}>
          <h2 id={labelId} className="heading-tight leading-[1]" style={{ fontSize: 'clamp(40px,5vw,64px)' }}>
            {title}
          </h2>
          <p className={['mt-6 text-[18px] sm:text-[21px] leading-[1.5] max-w-[30ch]', dark ? 'text-paper/85' : 'text-ink/80'].join(' ')}>
            {lead}
          </p>
          <a
            href={cta.href}
            {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            className={[CTA, dark ? 'bg-paper text-ink hover:bg-white' : 'bg-ink text-paper hover:bg-ink/90'].join(' ')}
          >
            {cta.text}
          </a>
        </BlurIn>
        <BlurIn delay={120} className={visualFirst ? 'lg:order-1' : ''}>
          {visual}
        </BlurIn>
      </div>
    </section>
  )
}

const panel = 'bg-surface rounded-[24px] shadow-[0_30px_60px_-30px_rgba(11,42,33,0.25)]'

function SettledVisual() {
  const [ref, inView] = useInView<HTMLDivElement>()
  const times: [string, string, boolean][] = [['Sent', '11:28:04', false], ['Settled on Arc', '11:28:05', false], ['Collected', '11:28:09', true]]
  return (
    <div ref={ref} className="relative overflow-hidden rounded-[24px] bg-[#CFC8BE] h-[420px] sm:h-[480px]">
      <img
        src="/images/card-designer.jpg"
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover"
        style={{ objectPosition: '66% 40%' }}
      />
      <div className="absolute inset-x-4 bottom-4 sm:inset-x-8 sm:bottom-8 rounded-[20px] bg-surface px-5 py-5 sm:px-6 shadow-[0_30px_60px_-24px_rgba(11,42,33,0.35)]">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[17px] font-semibold text-ink">Packaging design</span>
          <span className="dot text-[24px] sm:text-[26px] text-ink">+850.00</span>
        </div>
        <ol className="mt-4 grid grid-cols-3 gap-2">
          {times.map(([k, v, last]) => (
            <li key={k}>
              <p className={['serial text-[10px]', last ? 'text-serial' : 'text-ink/80'].join(' ')}>{k}</p>
              <p className="mt-1 text-[14px] sm:text-[15px] font-semibold text-ink tabular">{v}</p>
            </li>
          ))}
        </ol>
        <div className="mt-4 h-1 rounded-full bg-ink/10 overflow-hidden">
          <div
            className="h-full rounded-full bg-paid motion-safe:transition-[width] motion-safe:duration-1000 motion-safe:ease-out"
            style={{ width: inView ? '100%' : '0%' }}
          />
        </div>
      </div>
    </div>
  )
}

function FeesVisual() {
  return (
    <div className={`${panel} p-6 sm:p-10`}>
      <p className="serial text-[12px] text-ink/80">On a $1,000 invoice</p>
      <Ledger />
      <p className="mt-5 text-[13px] text-ink/80">
        Sources:{' '}
        <a href="https://www.fool.com/money/research/average-credit-card-processing-fees-costs-america/" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-serial">Motley Fool Money</a>
        {' · '}
        <a href="https://finance.yahoo.com/news/stripe-charges-1-5-stablecoin-145737023.html" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-serial">Cryptonews via Yahoo Finance</a>
      </p>
    </div>
  )
}

function MiddleVisual() {
  const side = 'rounded-[20px] border border-paper/25 bg-paper/10 px-5 py-5 text-center whitespace-nowrap sm:min-w-[140px]'
  const arrow = 'self-center text-[26px] text-paper/85 rotate-90 sm:rotate-0'
  return (
    <ol aria-label="Where a payment goes" className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 sm:gap-4">
      <li className={side}><p className="serial text-[10px] text-paper/80">Your client</p><p className="mt-2 text-[18px] font-semibold">Any wallet</p></li>
      <li aria-hidden="true" className={arrow}>→</li>
      <li className="rounded-[20px] bg-paper text-ink px-5 py-5 text-center whitespace-nowrap">
        <p className="serial text-[10px] text-serial">This invoice</p>
        <p className="mt-2 font-mono text-[17px] font-semibold">0x4C21…9a0E</p>
        <p className="mt-1 text-[13px] text-ink/80">pays only you</p>
      </li>
      <li aria-hidden="true" className={arrow}>→</li>
      <li className={side}><p className="serial text-[10px] text-paper/80">You</p><p className="mt-2 text-[18px] font-semibold">Your wallet</p></li>
    </ol>
  )
}

function RecoveryVisual() {
  const rows: [string, string, string][] = [
    ['Arc', 'expected', 'ok'],
    ['Ethereum', '50.00 sent by mistake', 'stray'],
    ['Base', 'same address', 'same'],
  ]
  return (
    <div className={`${panel} p-6 sm:p-9 flex flex-col gap-3`}>
      <p className="serial text-[12px] text-ink/80">One address, every chain</p>
      {rows.map(([chain, status, kind]) => (
        <div
          key={chain}
          className={[
            'flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-[14px] px-4 py-3.5',
            kind === 'stray' ? 'bg-[#FDF2F0] border border-serial/25' : 'bg-paper',
          ].join(' ')}
        >
          <span className="text-[17px] font-semibold text-ink w-[84px]">{chain}</span>
          <span className="font-mono text-[13px] text-ink">0x4C21…9a0E</span>
          <span className={['text-[14px] font-semibold', kind === 'ok' ? 'text-paid' : kind === 'stray' ? 'text-serial' : 'text-ink/80 font-normal'].join(' ')}>{status}</span>
        </div>
      ))}
      <span aria-hidden="true" className="mt-2 self-start rounded-full bg-ink px-5 py-3 text-[15px] font-semibold text-paper">Recover to my wallet</span>
    </div>
  )
}

function VaultVisual() {
  return (
    <div className="relative overflow-hidden rounded-[24px] bg-[#BFD6E6] h-[380px] sm:h-[480px]">
      <img
        src="/images/vault-sky.jpg"
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute left-1/2 top-1/2 w-[min(360px,calc(100%-32px))] -translate-x-1/2 -translate-y-1/2 rounded-[22px] bg-surface/95 p-6 shadow-[0_30px_60px_-24px_rgba(11,42,33,0.4)]">
        <div className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-ink">
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke="#FFFFFF" strokeWidth="2" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="#FFFFFF" strokeWidth="2" />
            </svg>
          </span>
          <div>
            <p className="text-[18px] font-semibold text-ink">Quantum-safe vault</p>
            <p className="mt-0.5 text-[13px] text-ink/80">SLH-DSA · FIPS 205 · two keys</p>
          </div>
        </div>
        <p className="dot mt-5 text-[40px] sm:text-[44px] leading-none text-ink">12,480.00</p>
        <p className="serial mt-2 text-[11px] text-ink/80">USDC · protected</p>
      </div>
    </div>
  )
}

function CodeVisual() {
  return (
    <div className="rounded-[24px] bg-ink text-paper p-6 sm:p-8 shadow-[0_30px_60px_-30px_rgba(11,42,33,0.5)]">
      <p className="serial text-[11px] text-paper/80">One contract call</p>
      <pre className="mt-4 overflow-x-auto font-mono text-[12px] sm:text-[14px] leading-[1.75]" aria-label="createRequest call">
        <code>
          {'factory.createRequest(\n'}
          {CREATE_REQUEST_ARGS.map((a) => (
            <span key={a.param}>
              {'  '}
              <span className={/['\d]/.test(a.value[0]) || a.value.startsWith('parse') ? 'text-[#9FD8B5]' : ''}>{a.value}</span>
              {','}
              {a.value !== a.param && <span className="text-paper/80">{`  // ${a.param}`}</span>}
              {'\n'}
            </span>
          ))}
          {')'}
        </code>
      </pre>
      <p className="mt-4 text-[14px] text-[#FFD2CC]">→ payment link ready · no API key</p>
    </div>
  )
}

function ValueProps() {
  return (
    <>
      <Story
        tone="white"
        labelId="vp-paid"
        title={<>Paid <span className={TWIST}>means</span> paid.</>}
        lead={'No payout schedule, no 2–7 business days. On Arc a payment settles in about a second, at an address only you can collect from.'}
        cta={{ text: 'See how it works', href: '#/docs/lifecycle' }}
        visual={<SettledVisual />}
      />
      <Story
        id="fees"
        labelId="vp-fees"
        title={<>Keep <span className={TWIST}>the 1.5%</span>.</>}
        lead="On a $1,000 invoice, cards take $23.60 and processors take $15. You pay about two cents."
        cta={{ text: 'Do the maths', href: '#/docs/fees' }}
        visual={<FeesVisual />}
        visualFirst
      />
      <Story
        tone="ink"
        labelId="vp-middle"
        title={<>Nobody <span className={TWIST}>in the middle</span>.</>}
        lead="Every invoice gets its own address that only pays you. Even if we disappeared tomorrow, your links would keep working."
        cta={{ text: 'Read the code', href: 'https://github.com/Sakibimam/ArcSlot' }}
        visual={<MiddleVisual />}
      />
      <Story
        labelId="vp-recovery"
        title={<>Wrong network? <span className={TWIST}>Still yours</span>.</>}
        lead="Your invoice has the same address on every chain, so a payment sent to the wrong one can be recovered."
        cta={{ text: 'Learn about recovery', href: '#/docs/recovery' }}
        visual={<RecoveryVisual />}
        visualFirst
      />
      <Story
        tone="white"
        labelId="vp-vault"
        title={<>Locked with <span className={TWIST}>tomorrow&apos;s maths</span>.</>}
        lead="An optional vault that only opens with a post-quantum signature, checked on-chain by Arc. A stolen wallet key alone can't touch it."
        cta={{ text: 'Set up a vault', href: '#/app' }}
        visual={<VaultVisual />}
      />
      <Story
        id="agents"
        labelId="vp-software"
        title={<>Let your software <span className={TWIST}>get paid</span>.</>}
        lead="Any app or AI agent can create and pay invoices with one contract call. No API key, no sign-up."
        cta={{ text: 'View the code', href: '#/docs/api' }}
        visual={<CodeVisual />}
        visualFirst
      />
    </>
  )
}

function FreePlan() {
  return (
    <section aria-labelledby="vp-plan" className="bg-surface border-t border-ink/10">
      <BlurIn className="mx-auto max-w-[1200px] px-4 sm:px-8 py-20 lg:py-28 flex flex-col items-center text-center">
        <h2 id="vp-plan" className="heading-tight leading-[1]" style={{ fontSize: 'clamp(40px,5vw,64px)' }}>
          One plan. <span className={TWIST}>Free</span>.
        </h2>
        <p className="mt-5 text-[18px] sm:text-[21px] text-ink/80">You pay the network, never us.</p>
        <div className="mt-10 w-full max-w-[460px] rounded-[28px] border border-ink/10 bg-paper p-7 sm:p-10 text-left">
          <p className="flex items-baseline gap-2.5">
            <span className="heading-tight text-[64px] leading-none">$0</span>
            <span className="text-[18px] text-ink/80">/ month, forever</span>
          </p>
          <ul className="mt-6 space-y-3 text-[17px] text-ink">
            {['Unlimited payment links', "Paid from Arc or another chain via Circle's CCTP", 'No ArcSlot fee, ever', '~$0.02 network fee per payment'].map((t) => (
              <li key={t} className="flex gap-3"><span aria-hidden="true" className="text-paid">✓</span>{t}</li>
            ))}
          </ul>
          <a href="#/app" className="mt-8 flex h-14 items-center justify-center rounded-full bg-ink text-[17px] font-semibold text-paper transition-all hover:-translate-y-px hover:bg-ink/90 hover:shadow-md">
            Create a payment link
          </a>
        </div>
      </BlurIn>
    </section>
  )
}

function TrustLine() {
  return (
    <section aria-label="Built on" className="border-t border-ink/10">
      <p className="mx-auto max-w-[1200px] px-4 sm:px-8 py-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 serial text-[12px] sm:text-[13px] text-ink/80 text-center">
        <span>Built on Circle USDC + CCTP</span><span aria-hidden="true">·</span>
        <span>Running on Arc</span><span aria-hidden="true">·</span>
        <span>Every line of code public</span>
      </p>
    </section>
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

        <ValueProps />
        <FreePlan />

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

        <TrustLine />
      </main>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="border-t border-ink/20">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-8 py-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 serial text-[11px] text-ink/80">
          <span>ArcSlot · Non-custodial USDC payments on Arc</span>
          <div className="flex items-center gap-5">
            <a href="#/docs" className="underline underline-offset-2 hover:text-serial">
              Docs
            </a>
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
