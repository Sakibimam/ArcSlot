import { useEffect, useRef, useState, type ReactNode } from 'react'
import { LogoMark } from '@/components/Logo'
import { heroGeometry, morphState, FRAME_UI, type HeroGeometry, type Rect } from '@/lib/morph'

// ── Receipts shown in the hero frame (items only: the people in our photos are stock models) ──

export const HERO_RECEIPTS = [
  { item: 'Brand strategy', amount: 1200, net: 1199.98 },
  { item: 'Logo design', amount: 1000, net: 999.98 },
  { item: 'Translation', amount: 240, net: 239.98 },
  { item: 'Website retainer', amount: 2500, net: 2499.98 },
]
const RECEIPT_MS = 5_500
const usd = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ── Hooks ─────────────────────────────────────────────────────────────────────

function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && (window.matchMedia?.(query)?.matches ?? false),
  )
  useEffect(() => {
    const mq = window.matchMedia?.(query)
    if (!mq?.addEventListener) return
    const onChange = () => setMatches(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return matches
}

export function useReducedMotion(): boolean {
  return useMedia('(prefers-reduced-motion: reduce)')
}

/** The pinned scroll morph runs only on desktop-width screens with motion allowed. */
export function useMorphMode(): boolean {
  const desktop = useMedia('(min-width: 1024px)')
  const reduced = useReducedMotion()
  return desktop && !reduced && typeof requestAnimationFrame !== 'undefined'
}

function useHeroReceipt() {
  const reduced = useReducedMotion()
  const [n, setN] = useState(0)
  useEffect(() => {
    if (reduced) return
    const t = setInterval(() => setN((i) => i + 1), RECEIPT_MS)
    return () => clearInterval(t)
  }, [reduced])
  return { n, r: HERO_RECEIPTS[n % HERO_RECEIPTS.length], serial: `No. AS ${String(42 + n).padStart(4, '0')}` }
}

// ── The payment inside the white frame ───────────────────────────────────────
// Sized in container units (cqw) so it scales with the frame: big on the desktop hero,
// small on a phone card, and it shrinks naturally as the frame becomes the middle card.

function FrameUI() {
  const { n, r, serial } = useHeroReceipt()
  return (
    <div data-part="hero-frame" className="absolute inset-0 [container-type:inline-size]">
      {/* Below both faces (FRAME_UI): the amount, then the invoice row at the bottom. */}
      <div key={`amount-${n}`} className="absolute inset-x-0 flex justify-center motion-safe:animate-stamp-in" style={{ top: `${FRAME_UI.amountTop * 100}%` }}>
        <span className="flex items-center gap-[2.4cqw] rounded-[4.3cqw] bg-white/95 px-[4.8cqw] py-[2.1cqw]">
          <span className="dot leading-none text-ink text-[12cqw]">{usd(r.net)}</span>
          <span className="rounded-full bg-ink px-[3.4cqw] py-[1.6cqw] text-[3.4cqw] font-semibold text-white">USDC</span>
        </span>
      </div>
      <div
        key={`row-${n}`}
        style={{ bottom: `${FRAME_UI.rowBottom * 100}%` }}
        className="absolute left-[3.3cqw] right-[3.3cqw] flex items-center gap-[3.3cqw] rounded-[4.8cqw] bg-white px-[4.3cqw] py-[3.8cqw] shadow-[0_20px_40px_-18px_rgba(11,42,33,0.35)] motion-safe:animate-slide-up"
      >
        <span className="flex size-[10cqw] shrink-0 items-center justify-center rounded-full bg-ink">
          <LogoMark className="size-[5.7cqw]" ink="#FFFFFF" paper="#0B2A21" />
        </span>
        <div className="min-w-0 grow">
          <p className="truncate text-[4cqw] font-semibold text-ink">Invoice <span>{serial}</span></p>
          <p className="truncate text-[3.3cqw] text-ink/80"><span>{r.item}</span> · fee ~0.02</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[4cqw] font-semibold text-ink">+{usd(r.amount)}</p>
          <p className="dot text-[2.9cqw] tracking-[0.2em] text-serial">*PAID*</p>
        </div>
      </div>
    </div>
  )
}

// ── Shared pieces ─────────────────────────────────────────────────────────────

function Headline({ size }: { size: 'stage' | 'static' }) {
  const lead = size === 'stage' ? 'min(128px, 8.9vw)' : 'clamp(56px, 13vw, 112px)'
  const turn = size === 'stage' ? 'min(140px, 9.7vw)' : 'clamp(62px, 14.2vw, 124px)'
  return (
    <h1 className="text-ink" style={{ fontWeight: 500, lineHeight: 0.9, letterSpacing: '-0.045em' }}>
      <span data-part="headline-lead" className="block" style={{ fontSize: lead }}>Cents,</span>{' '}
      <span
        data-part="headline-turn"
        className="font-serif italic block"
        style={{ fontSize: turn, fontWeight: 400, letterSpacing: '-0.02em' }}
      >
        not <s style={{ textDecorationColor: '#B3261E', textDecorationThickness: '0.05em' }}>percent</s>.
      </span>
    </h1>
  )
}

const ctaClass =
  'inline-flex items-center h-14 px-8 rounded-full text-[17px] font-semibold text-white bg-ink hover:bg-[#164537] transition-all hover:-translate-y-px hover:shadow-md active:translate-y-0'

function Nav() {
  return (
    <nav className="flex items-center justify-between" aria-label="Site">
      <a href="#/" className="inline-flex items-center gap-2.5 text-ink">
        <LogoMark className="size-9" paper="#DCE8F0" />
        <span className="engraved text-[19px] tracking-[0.06em]" style={{ fontStretch: '125%' }}>ArcSlot</span>
      </a>
      <div className="flex items-center gap-2 sm:gap-4">
        <a href="#/docs" className="inline-flex items-center h-11 px-3 rounded-full text-[15px] font-semibold text-ink hover:bg-ink/[0.07] transition-colors">
          Docs
        </a>
        <a href="#/app" className="inline-flex items-center h-11 px-6 rounded-full text-[15px] font-semibold text-white bg-ink hover:bg-[#164537] transition-colors">
          Open app
        </a>
      </div>
    </nav>
  )
}

function LiveStatus({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center gap-2 serial text-[11px] text-ink/80">
      <span className="relative flex size-2" aria-hidden="true">
        <span className="absolute inline-flex size-full rounded-full bg-paid opacity-60 motion-safe:animate-ping" />
        <span className="relative inline-flex size-2 rounded-full bg-paid" />
      </span>
      {text}
    </span>
  )
}

/** A side photo card with its floating ArcSlot row (designer / consultant). */
export function RoleCard({ src, role, position, children }: { src: string; role: string; position: string; children: ReactNode }) {
  return (
    <div className="relative h-full w-full overflow-hidden rounded-[22px] bg-[#4B5651] [container-type:inline-size]">
      <img src={src} alt="" aria-hidden="true" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" style={{ objectPosition: position }} />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0)_45%,rgba(0,0,0,.5)_100%)]" />
      <span className="absolute left-4 top-4 rounded-full bg-white/90 px-3 py-1.5 serial text-[11px] font-medium text-ink">{role}</span>
      {children}
    </div>
  )
}

export function DesignerRow() {
  return (
    <div className="absolute bottom-[4cqw] left-[4cqw] right-[4cqw] flex items-center gap-[4cqw] rounded-[4.7cqw] bg-white px-[4.7cqw] py-[4cqw] shadow-[0_12px_30px_-14px_rgba(0,0,0,0.5)]">
      <span className="flex size-[10.7cqw] shrink-0 items-center justify-center rounded-full bg-ink"><LogoMark className="size-[5.3cqw]" ink="#FFFFFF" paper="#0B2A21" /></span>
      <div className="min-w-0 grow"><p className="truncate text-[4.7cqw] font-semibold leading-tight text-ink">Packaging design</p><p className="mt-0.5 truncate text-[3.7cqw] text-ink/80">From Ethereum · today, 09:02</p></div>
      <div className="shrink-0 text-right"><p className="dot text-[5.3cqw] text-ink">+850.00</p><p className="dot mt-0.5 text-[3.3cqw] tracking-[0.2em] text-serial">*PAID*</p></div>
    </div>
  )
}

export function ConsultantRow() {
  return (
    <div className="absolute bottom-[4cqw] left-[4cqw] right-[4cqw] flex items-center gap-[4cqw] rounded-[4.7cqw] bg-white px-[4.7cqw] py-[4cqw] shadow-[0_12px_30px_-14px_rgba(0,0,0,0.5)]">
      <span className="flex size-[10.7cqw] shrink-0 items-center justify-center rounded-full bg-ink"><LogoMark className="size-[5.3cqw]" ink="#FFFFFF" paper="#0B2A21" /></span>
      <div className="min-w-0 grow"><p className="truncate text-[4.7cqw] font-semibold leading-tight text-ink">Strategy session</p><p className="mt-0.5 truncate text-[3.7cqw] text-ink/80">Waiting · link sent 10:40</p></div>
      <div className="shrink-0 text-right"><p className="dot text-[5.3cqw] text-ink">300.00</p><p className="serial mt-0.5 text-[3.3cqw] text-[#8A5300]">PENDING</p></div>
    </div>
  )
}

const at = (r: Rect) => ({ left: r.x, top: r.y, width: r.w, height: r.h })
const STAGE_MIN_H = 640

// ── Desktop: the pinned scroll morph ─────────────────────────────────────────

function SkyStage({ networkStatus }: { networkStatus: string }) {
  const size = () => ({ w: window.innerWidth, h: Math.max(window.innerHeight, STAGE_MIN_H) })
  const [g, setG] = useState<HeroGeometry>(() => { const s = size(); return heroGeometry(s.w, s.h) })
  const outer = useRef<HTMLElement>(null)
  const layer = useRef<HTMLDivElement>(null)
  const text = useRef<HTMLDivElement>(null)
  const outline = useRef<HTMLDivElement>(null)
  const cards = useRef<HTMLDivElement>(null)
  const geo = useRef(g)

  const left = useRef<HTMLDivElement>(null)
  const right = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let raf = 0
    // The stage's page offset and scroll range, measured on resize only: scroll frames never read
    // layout, so each frame is just style writes to compositor-friendly properties.
    let top = 0
    let range = 0
    const measure = () => {
      const el = outer.current
      if (!el) return
      let y = 0
      for (let n: HTMLElement | null = el; n; n = n.offsetParent as HTMLElement | null) y += n.offsetTop
      top = y
      range = el.offsetHeight - geo.current.h
    }
    let last = ''
    const apply = () => {
      raf = 0
      if (!layer.current || !text.current || !outline.current || !cards.current || !left.current || !right.current) return
      const s = morphState(range > 0 ? (window.scrollY - top) / range : 0, geo.current)
      const key = s.clip + s.transform + s.cards
      if (key === last) return // pinned past the end (or before the start): nothing changes
      last = key
      layer.current.style.clipPath = s.clip
      layer.current.style.transform = s.transform
      text.current.style.opacity = String(s.textOpacity)
      text.current.style.transform = `translate3d(0px, ${s.textLift}px, 0px)`
      text.current.style.visibility = s.textOpacity === 0 ? 'hidden' : 'visible'
      outline.current.style.opacity = String(s.outline)
      cards.current.style.opacity = String(s.cards)
      cards.current.style.visibility = s.cards === 0 ? 'hidden' : 'visible'
      left.current.style.transform = `translate3d(${-s.slide}px, 0px, 0px)`
      right.current.style.transform = `translate3d(${s.slide}px, 0px, 0px)`
    }
    const schedule = () => { if (!raf) raf = requestAnimationFrame(apply) }
    const onResize = () => {
      const s = size()
      geo.current = heroGeometry(s.w, s.h)
      setG(geo.current)
      measure()
      last = ''
      schedule()
    }
    measure()
    apply()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', onResize)
    // Fonts and images above the fold can shift the stage after first paint.
    window.addEventListener('load', onResize)
    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('load', onResize)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <section ref={outer} data-part="morph-stage" className="relative" style={{ height: '230vh' }}>
      <div className="sticky top-0 overflow-hidden bg-surface" style={{ height: g.h }}>

        {/* Section heading + side cards, revealed as the photo settles into the middle */}
        <div ref={cards} data-part="morph-cards" className="absolute inset-0 will-change-[opacity]" style={{ opacity: 0, visibility: 'hidden' }}>
          <div className="absolute inset-x-0 text-center px-6" style={{ top: Math.max(96, g.card.y - 210) }}>
            <p className="serial text-[12px] text-serial">Series 5042 · Issued on Arc</p>
            <h2 className="heading-tight mx-auto mt-4 text-ink" style={{ fontSize: 'clamp(36px, 4.4vw, 64px)', lineHeight: 1 }}>
              Get paid by anyone, <span className="font-serif italic font-normal">anywhere.</span>
            </h2>
            <p className="mx-auto mt-4 max-w-[52ch] text-[17px] leading-[1.45] text-ink/80">
              Every invoice gets its own address that can only pay you. You keep all of it, minus about two cents.
            </p>
          </div>
          <div ref={left} data-part="side-left" className="absolute will-change-transform" style={{ ...at(g.left), transform: 'translate3d(-80px, 0px, 0px)' }}>
            <RoleCard src="/images/card-designer.jpg" role="DESIGNER" position="66% 40%"><DesignerRow /></RoleCard>
          </div>
          <div ref={right} data-part="side-right" className="absolute will-change-transform" style={{ ...at(g.right), transform: 'translate3d(80px, 0px, 0px)' }}>
            <RoleCard src="/images/card-consultant.jpg" role="CONSULTANT" position="30% 35%"><ConsultantRow /></RoleCard>
          </div>
        </div>

        {/* The photo layer: clipped to the frame, then moved/scaled into the middle-card slot */}
        <div
          ref={layer}
          className="absolute inset-0 will-change-transform"
          style={{ transformOrigin: `${g.frame.x}px ${g.frame.y}px` }}
        >
          <img
            src="/images/hero-sky.jpg"
            alt=""
            width={2400}
            height={1598}
            fetchPriority="high"
            decoding="sync"
            className="pointer-events-none absolute max-w-none select-none will-change-transform"
            style={at(g.img)}
          />
          {/* A soft light veil behind the headline: the deep sky alone gives the small text ~4:1. */}
          <div
            data-part="hero-veil"
            className="pointer-events-none absolute inset-0"
            style={{ background: 'linear-gradient(90deg, rgba(246,247,242,0.5) 0%, rgba(246,247,242,0.4) 28%, rgba(246,247,242,0) 46%)' }}
          />
          <div ref={outline} className="absolute rounded-[30px] border-2 border-white/95" style={at(g.frame)} />
          <div className="absolute" style={at(g.frame)}><FrameUI /></div>
        </div>

        <div className="absolute inset-x-0 top-0 z-10 px-24 pt-7"><Nav /></div>

        {/* Headline column on the open sky */}
        <div ref={text} data-part="hero-text" className="absolute z-10 will-change-[opacity,transform]" style={{ left: 96, top: Math.max(150, g.h * 0.24), width: Math.min(640, g.frame.x - 120) }}>
          <Headline size="stage" />
          <p className="mt-8 text-[21px] leading-[1.45] text-ink">One link. Any wallet. USDC in seconds.</p>
          <a href="#/app" className={`mt-8 ${ctaClass}`}>Create a payment link</a>
          <div className="mt-8"><LiveStatus text={networkStatus} /></div>
        </div>
      </div>
    </section>
  )
}

// ── Phones, tablets and reduced motion: a static hero ────────────────────────

function StaticHero({ networkStatus }: { networkStatus: string }) {
  return (
    <section data-part="static-hero" className="bg-paper">
      <div className="mx-auto max-w-[1200px] px-5 pt-6 sm:px-8"><Nav /></div>
      <div className="mx-auto grid max-w-[1200px] grid-cols-1 items-center gap-10 px-5 pb-12 pt-10 sm:px-8 lg:grid-cols-[1.1fr_1fr] lg:gap-16 lg:pb-20 lg:pt-16">
        <div>
          <Headline size="static" />
          <p className="mt-6 text-[18px] leading-[1.45] text-ink sm:text-[21px]">One link. Any wallet. USDC in seconds.</p>
          <a href="#/app" className={`mt-8 ${ctaClass}`}>Create a payment link</a>
          <div className="mt-6"><LiveStatus text={networkStatus} /></div>
        </div>
        <div className="relative mx-auto aspect-[4/5] w-full max-w-[520px] overflow-hidden rounded-[24px] bg-[#BFD6E6]">
          <img
            src="/images/hero-sky-mobile.jpg"
            alt=""
            width={800}
            height={1200}
            fetchPriority="high"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
            style={{ objectPosition: '50% 20%' }}
          />
          {/* The frame around both of them, with the payment below their faces */}
          <div className="absolute left-[17%] right-[17.5%] top-[26%] h-[70%]">
            <div className="absolute inset-0 rounded-[22px] border-2 border-white/95" />
            <FrameUI />
          </div>
        </div>
      </div>
    </section>
  )
}

export function SkyHero({ morph, networkStatus }: { morph: boolean; networkStatus: string }) {
  return morph ? <SkyStage networkStatus={networkStatus} /> : <StaticHero networkStatus={networkStatus} />
}
