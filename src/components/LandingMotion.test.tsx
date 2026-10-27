import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
import { LandingPage, HERO_RECEIPTS } from './LandingPage'

// Screen + motion preference for a test: desktop means the (min-width: 1024px) query matches.
const setEnv = ({ reduced = false, desktop = false }: { reduced?: boolean; desktop?: boolean }) => {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: (q.includes('reduce') && reduced) || (q.includes('min-width: 1024px') && desktop),
    media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }))
}
const setReducedMotion = (reduced: boolean) => setEnv({ reduced })

// Every IntersectionObserver the page creates (ledger, blur-ins, photo cards).
let observers: ((entries: { isIntersecting: boolean }[]) => void)[] = []
beforeEach(() => {
  vi.useFakeTimers()
  observers = []
  window.IntersectionObserver = class {
    constructor(cb: (e: { isIntersecting: boolean }[]) => void) { observers.push(cb) }
    observe() {}
    disconnect() {}
    unobserve() {}
  } as unknown as typeof IntersectionObserver
})
afterEach(() => {
  vi.useRealTimers()
  // @ts-expect-error test cleanup
  delete window.matchMedia
  // @ts-expect-error test cleanup
  delete window.IntersectionObserver
})

describe('landing motion', () => {
  for (const desktop of [false, true]) {
    it(`the hero frame keeps printing new receipts, each with the next serial (${desktop ? 'desktop morph' : 'phone'})`, () => {
      setEnv({ desktop })
      render(<LandingPage />)
      expect(screen.getByText(HERO_RECEIPTS[0].item)).toBeInTheDocument()
      expect(screen.getByText('No. AS 0042')).toBeInTheDocument()
      act(() => { vi.advanceTimersByTime(6_000) })
      expect(screen.queryByText(HERO_RECEIPTS[0].item)).not.toBeInTheDocument()
      expect(screen.getByText(HERO_RECEIPTS[1].item)).toBeInTheDocument()
      expect(screen.getByText('No. AS 0043')).toBeInTheDocument()
    })
  }

  it('every receipt adds up: you get the amount minus the 0.02 network fee', () => {
    for (const r of HERO_RECEIPTS) expect(Math.round((r.amount - 0.02) * 100)).toBe(Math.round(r.net * 100))
  })

  it('with reduced motion the hero receipt stays put', () => {
    setEnv({ reduced: true, desktop: true })
    render(<LandingPage />)
    act(() => { vi.advanceTimersByTime(20_000) })
    expect(screen.getByText(HERO_RECEIPTS[0].item)).toBeInTheDocument()
    expect(screen.getByText('No. AS 0042')).toBeInTheDocument()
  })

  it('fee bars start empty and draw in when the ledger scrolls into view', () => {
    setReducedMotion(false)
    render(<LandingPage />)
    const bars = () => [...document.querySelectorAll<HTMLElement>('[data-part="fee-bar"]')]
    expect(bars().map((b) => b.style.width)).toEqual(['0%', '0%', '0%'])
    act(() => { for (const cb of observers) cb([{ isIntersecting: true }]) })
    expect(bars().map((b) => b.style.width)).toEqual(['100%', '64%', '0.09%'])
  })

  it('sections blur into view on scroll, all the way down the page', () => {
    setReducedMotion(false)
    const { container } = render(<LandingPage />)
    const hidden = () => [...container.querySelectorAll<HTMLElement>('[data-reveal]')].filter((el) => el.style.opacity === '0')
    const all = container.querySelectorAll('[data-reveal]')
    // Headings in every section after the hero reveal, not just the first few.
    for (const id of ['fees', 'how-it-works', 'agents']) expect(container.querySelector(`#${id} [data-reveal]`)).not.toBeNull()
    expect(hidden().length).toBe(all.length)
    act(() => { for (const cb of observers) cb([{ isIntersecting: true }]) })
    expect(hidden()).toEqual([])
  })

  it('with reduced motion nothing is hidden waiting to reveal', () => {
    setReducedMotion(true)
    const { container } = render(<LandingPage />)
    const hidden = [...container.querySelectorAll<HTMLElement>('[data-reveal]')].filter((el) => el.style.opacity === '0')
    expect(hidden).toEqual([])
  })

  it('without IntersectionObserver (old browsers) the bars are simply full', () => {
    setReducedMotion(false)
    // @ts-expect-error simulate a browser without it
    delete window.IntersectionObserver
    render(<LandingPage />)
    const widths = [...document.querySelectorAll<HTMLElement>('[data-part="fee-bar"]')].map((b) => b.style.width)
    expect(widths).toEqual(['100%', '64%', '0.09%'])
  })

  it('the rosettes turn slowly, only under motion-safe', () => {
    setReducedMotion(false)
    const { container } = render(<LandingPage />)
    const turning = container.querySelectorAll('g.motion-safe\\:animate-rosette')
    expect(turning.length).toBeGreaterThan(0)
  })

  it('desktop with motion: one pinned morph stage, no static hero, one h1', () => {
    setEnv({ desktop: true })
    const { container } = render(<LandingPage />)
    expect(container.querySelectorAll('[data-part="morph-stage"]')).toHaveLength(1)
    expect(container.querySelector('[data-part="static-hero"]')).toBeNull()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    // the cards live inside the stage, so they are not repeated further down
    expect(screen.getAllByText('DESIGNER')).toHaveLength(1)
    expect(screen.getAllByText('CONSULTANT')).toHaveLength(1)
  })

  for (const [name, env] of [['phone', { desktop: false }], ['reduced motion on desktop', { desktop: true, reduced: true }]] as const) {
    it(`${name}: the static hero only, one h1, photo cards once`, () => {
      setEnv(env)
      const { container } = render(<LandingPage />)
      expect(container.querySelector('[data-part="morph-stage"]')).toBeNull()
      expect(container.querySelectorAll('[data-part="static-hero"]')).toHaveLength(1)
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
      expect(screen.getAllByText('DESIGNER')).toHaveLength(1)
      expect(screen.getAllByText('CONSULTANT')).toHaveLength(1)
    })
  }

  it('nothing above the pinned stage creates a scroll container (that would break position: sticky)', () => {
    setEnv({ desktop: true })
    const { container } = render(<LandingPage />)
    let el = container.querySelector('[data-part="morph-stage"]')!.parentElement
    while (el) {
      expect(el.className).not.toMatch(/overflow-(x-|y-)?(hidden|auto|scroll)\b/)
      el = el.parentElement
    }
  })

  for (const desktop of [false, true]) {
    it(`no photographer credit lines on the page (${desktop ? 'desktop' : 'phone'}); they live in public/images/CREDITS.md`, () => {
      setEnv({ desktop })
      render(<LandingPage />)
      expect(screen.queryByText(/unsplash|zulfugar|gariev/i)).not.toBeInTheDocument()
    })
  }

  it('each device loads only its own hero photo', () => {
    setEnv({ desktop: true })
    const { container, unmount } = render(<LandingPage />)
    const srcs = () => [...container.querySelectorAll('img, source')].map((e) => e.getAttribute('src') ?? e.getAttribute('srcset'))
    expect(srcs()).toContain('/images/hero-sky.jpg')
    expect(srcs()).not.toContain('/images/hero-sky-mobile.jpg')
    unmount()
    setEnv({ desktop: false })
    const phone = render(<LandingPage />)
    const phoneSrcs = [...phone.container.querySelectorAll('img, source')].map((e) => e.getAttribute('src') ?? e.getAttribute('srcset'))
    expect(phoneSrcs).toContain('/images/hero-sky-mobile.jpg')
    expect(phoneSrcs).not.toContain('/images/hero-sky.jpg')
  })

  describe('scroll morph runs at display refresh rate', () => {
    const scrollTo = (y: number) => {
      Object.defineProperty(window, 'scrollY', { value: y, configurable: true })
      window.dispatchEvent(new Event('scroll'))
      act(() => { vi.advanceTimersByTime(20) })
    }

    it('no layout reads on scroll frames (geometry is cached on resize)', () => {
      setEnv({ desktop: true })
      render(<LandingPage />)
      const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
      const top = vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get')
      for (const y of [50, 300, 900, 1400]) scrollTo(y)
      expect(rect).not.toHaveBeenCalled()
      expect(height).not.toHaveBeenCalled()
      expect(top).not.toHaveBeenCalled()
      vi.restoreAllMocks()
    })

    it('only compositor-friendly properties change: no blur filter, no CSS variables on big subtrees', () => {
      setEnv({ desktop: true })
      const { container } = render(<LandingPage />)
      const stage = container.querySelector<HTMLElement>('[data-part="morph-stage"]')!
      Object.defineProperty(stage, 'offsetHeight', { value: 2600, configurable: true })
      act(() => { window.dispatchEvent(new Event('resize')) })
      scrollTo(200)
      const text = container.querySelector<HTMLElement>('[data-part="hero-text"]')!
      expect(text.style.filter).toBe('')
      expect(text.style.transform).toMatch(/translate3d\(0px, -?[\d.]+px, 0px\)/)
      expect(text.style.opacity).not.toBe('1')
      const cards = container.querySelector<HTMLElement>('[data-part="morph-cards"]')!
      expect(cards.style.getPropertyValue('--slide')).toBe('')
      expect(container.querySelector<HTMLElement>('[data-part="side-left"]')!.style.transform).toMatch(/translate3d/)
      expect(container.querySelector<HTMLElement>('[data-part="side-right"]')!.style.transform).toMatch(/translate3d/)
    })

    it('the pinned stretch is short enough that the wheel never scrolls through dead space', () => {
      setEnv({ desktop: true })
      const { container } = render(<LandingPage />)
      const h = parseFloat(container.querySelector<HTMLElement>('[data-part="morph-stage"]')!.style.height)
      expect(h).toBeLessThanOrEqual(230)
    })

    it('a soft light veil sits behind the headline, inside the photo layer (so it leaves with the photo)', () => {
      setEnv({ desktop: true })
      const { container } = render(<LandingPage />)
      const veil = container.querySelector<HTMLElement>('[data-part="morph-stage"] [data-part="hero-veil"]')!
      expect(veil).not.toBeNull()
      expect(veil.style.background).toMatch(/linear-gradient/)
      expect(veil.closest('.will-change-transform')).not.toBeNull()
    })

    it('the big photo sits on its own layer, so the receipt animations never repaint it', () => {
      setEnv({ desktop: true })
      const { container } = render(<LandingPage />)
      const img = container.querySelector<HTMLImageElement>('[data-part="morph-stage"] img[src="/images/hero-sky.jpg"]')!
      expect(img.className).toMatch(/will-change-transform/)
      expect(img.getAttribute('decoding')).toBe('sync')
    })
  })
})
