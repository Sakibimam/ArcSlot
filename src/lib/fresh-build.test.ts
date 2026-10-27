import { describe, it, expect, vi } from 'vitest'
import { newerBuildAvailable, reloadOnceFor } from './fresh-build'

const html = (bundle: string) => `<!doctype html><html><head><script type="module" crossorigin src="/assets/${bundle}"></script></head></html>`
const doc = (bundle?: string) => ({ scripts: bundle ? [{ src: `https://arc-slot-three.vercel.app/assets/${bundle}` }] : [] }) as unknown as Document

describe('newerBuildAvailable', () => {
  it('is true when the server now serves a different bundle than the one running', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(new Response(html('index-NEW.js'))))
    expect(await newerBuildAvailable(fetchFn, doc('index-OLD.js'))).toBe(true)
    expect(fetchFn).toHaveBeenCalledWith(expect.stringMatching(/^\/\?/), { cache: 'no-store' })
  })
  it('is false when the running bundle is current', async () => {
    expect(await newerBuildAvailable(() => Promise.resolve(new Response(html('index-SAME.js'))), doc('index-SAME.js'))).toBe(false)
  })
  it('is false in development (no hashed bundle) and when the check itself fails', async () => {
    expect(await newerBuildAvailable(() => Promise.resolve(new Response(html('index-X.js'))), doc())).toBe(false)
    expect(await newerBuildAvailable(() => Promise.reject(new TypeError('offline')), doc('index-OLD.js'))).toBe(false)
  })
})

describe('reloadOnceFor', () => {
  it('reloads at most once per link per session, so a real bad link can never loop', () => {
    const store = new Map<string, string>()
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) }
    const reload = vi.fn()
    expect(reloadOnceFor('#/pay/5042/0xabc', storage, reload)).toBe(true)
    expect(reloadOnceFor('#/pay/5042/0xabc', storage, reload)).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
