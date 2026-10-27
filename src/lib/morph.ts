// Geometry for the landing hero's scroll morph: the full-screen sky photo closes in on the
// frame around the two friends, then that framed rectangle glides into the middle-card slot.

export interface Rect { x: number; y: number; w: number; h: number }
export interface HeroGeometry {
  w: number
  h: number
  img: Rect
  frame: Rect
  card: Rect
  left: Rect
  right: Rect
}

/** hero-sky.jpg is 2400×1601 (images.test checks it). */
export const IMG_RATIO = 2400 / 1601
/** Where the frame sits on the photo (fractions of the image): around both faces, 3:4. */
export const FRAME_ON_IMAGE = { x: 1060 / 2400, y: 400 / 1601, w: 700 / 2400, h: 933 / 1601 }
/** Both faces (with hats' brims), measured on the photo. The payment UI must stay below them. */
export const FACES_ON_IMAGE = [
  { x: 1400 / 2400, y: 450 / 1601, w: 250 / 2400, h: 310 / 1601 },
  { x: 1100 / 2400, y: 760 / 1601, w: 230 / 2400, h: 250 / 1601 },
]
/** Payment UI inside the frame, as fractions of its height: the amount tile's top, the invoice row's bottom gap. */
export const FRAME_UI = { amountTop: 0.69, rowBottom: 0.03 }
/** The photo is drawn ~14% wider than the stage so the subjects sit right of centre. */
const IMG_SCALE = 1.14
/** Vertical focus of the photo (like object-position y): lifts the photo so the whole frame fits. */
const IMG_FOCUS_Y = 0.38
const GAP = 24
const SIDE = 0.86

export function heroGeometry(w: number, h: number): HeroGeometry {
  const imgW = Math.max(w * IMG_SCALE, h * IMG_RATIO)
  const imgH = imgW / IMG_RATIO
  const img = { x: 0, y: (h - imgH) * IMG_FOCUS_Y, w: imgW, h: imgH }
  const frame = {
    x: img.x + FRAME_ON_IMAGE.x * imgW,
    y: img.y + FRAME_ON_IMAGE.y * imgH,
    w: FRAME_ON_IMAGE.w * imgW,
    h: FRAME_ON_IMAGE.h * imgH,
  }
  // End state: the frame becomes the middle card — same shape, centred, resting near the bottom
  // with room above for the section heading, and narrow enough for a side card each side.
  const aspect = frame.w / frame.h
  // Leave ~300px above the row for the nav and the section heading.
  const cardH = Math.min(h * 0.6, 500, h * 0.94 - 300, (w / (1 + 2 * SIDE) - 2 * GAP) / aspect)
  const cardW = cardH * aspect
  const card = { x: (w - cardW) / 2, y: h - h * 0.06 - cardH, w: cardW, h: cardH }
  const sideW = cardW * SIDE
  const sideH = cardH * SIDE
  const left = { x: card.x - GAP - sideW, y: card.y + cardH - sideH, w: sideW, h: sideH }
  const right = { x: card.x + cardW + GAP, y: left.y, w: sideW, h: sideH }
  return { w, h, img, frame, card, left, right }
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const ease = (t: number) => 1 - Math.pow(1 - t, 3)
const px = (v: number) => `${Math.round(v * 100) / 100}px`

export interface MorphState {
  /** clip-path for the photo layer */
  clip: string
  /** transform for the photo layer (transform-origin: the frame's top-left) */
  transform: string
  /** headline / subline / button */
  textOpacity: number
  /** the headline drifts up as it fades (px, a transform — no blur filter, which repaints every frame) */
  textLift: number
  /** the frame's white outline */
  outline: number
  /** side cards + section heading */
  cards: number
  /** how far the side cards still have to slide in (px) */
  slide: number
}

/**
 * p = scroll progress through the pinned stage.
 *   0 → 0.4  the photo closes in on the frame (text fades out by 0.3)
 *   0.4 → 0.75  the framed photo moves and scales into the middle-card slot
 *   0.55 → 0.85  side cards and the section heading come in
 */
export function morphState(rawP: number, g: HeroGeometry): MorphState {
  const p = clamp01(rawP)
  const t1 = ease(clamp01(p / 0.4))
  const t2 = ease(clamp01((p - 0.4) / 0.35))
  const t3 = ease(clamp01((p - 0.55) / 0.3))
  const { frame, card } = g
  const top = frame.y * t1
  const right = (g.w - frame.x - frame.w) * t1
  const bottom = (g.h - frame.y - frame.h) * t1
  const left = frame.x * t1
  const radius = 28 * t1
  const scale = 1 + (card.w / frame.w - 1) * t2
  const dx = (card.x - frame.x) * t2
  const dy = (card.y - frame.y) * t2
  const text = 1 - clamp01(p / 0.3)
  return {
    clip: `inset(${px(top)} ${px(right)} ${px(bottom)} ${px(left)} round ${px(radius)})`,
    transform: `translate(${px(dx)}, ${px(dy)}) scale(${Math.round(scale * 10000) / 10000})`,
    textOpacity: Math.round(text * 1000) / 1000,
    textLift: Math.round((text - 1) * 40 * 10) / 10 || 0,
    outline: Math.round((1 - t2) * 1000) / 1000,
    cards: Math.round(t3 * 1000) / 1000,
    slide: Math.round((1 - t3) * 80 * 10) / 10,
  }
}
