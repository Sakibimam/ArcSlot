// A tab left open across a deploy keeps running the old app: following a new link only changes
// the hash, so nothing reloads. Before telling a payer their link is invalid, check whether the
// server now serves a newer build, and if so reload once (never twice for the same link).

const BUNDLE = /\/assets\/(index-[\w-]+\.js)/

export async function newerBuildAvailable(
  fetchFn: (url: string, init: RequestInit) => Promise<Response> = fetch,
  doc: Document = document,
): Promise<boolean> {
  const running = [...doc.scripts].map((s) => BUNDLE.exec(s.src)?.[1]).find(Boolean)
  if (!running) return false // development server: no hashed bundle
  try {
    const html = await (await fetchFn(`/?build-check=${Date.now()}`, { cache: 'no-store' })).text()
    const served = BUNDLE.exec(html)?.[1]
    return !!served && served !== running
  } catch {
    return false
  }
}

export function reloadOnceFor(
  key: string,
  storage: Pick<Storage, 'getItem' | 'setItem'> = sessionStorage,
  reload: () => void = () => window.location.reload(),
): boolean {
  const flag = `arcslot:reloaded:${key}`
  try {
    if (storage.getItem(flag)) return false
    storage.setItem(flag, '1')
  } catch {
    return false // storage blocked: never risk a reload loop
  }
  reload()
  return true
}
