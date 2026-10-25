// Hash-based routes so links work on any static host (Vercel, Arc Studio
// preview) without server rewrites.
//   #/                                  merchant dashboard
//   #/pay/<chainId>/<slot>?amount=&for= sender payment page

import { getAddress, isAddress } from 'viem'
import { isSupportedChain, type SupportedChainId } from './chains'
import { formatUsdc6, parseUsdc6 } from './slot-logic'

const MAX_LABEL = 80

export type Route =
  | { page: 'merchant' }
  | { page: 'collectors' }
  | { page: 'invalid-pay' }
  | { page: 'pay'; chainId: SupportedChainId; slot: string; amount: bigint | undefined; label: string | undefined }

export function buildPayHash(p: { chainId: number; slot: string; amount?: bigint; label?: string }): string {
  const q = new URLSearchParams()
  if (p.amount !== undefined && p.amount > 0n) q.set('amount', formatUsdc6(p.amount).replace(/\.?0+$/, ''))
  if (p.label) q.set('for', p.label.slice(0, MAX_LABEL))
  const qs = q.toString()
  return `#/pay/${p.chainId}/${p.slot}${qs ? `?${qs}` : ''}`
}

export function parseRoute(hash: string): Route {
  if (hash === '#/collect') return { page: 'collectors' }
  const m = /^#\/pay\/(\d+)\/([^/?]+)(?:\?(.*))?$/.exec(hash)
  if (!m) return { page: 'merchant' }
  const chainId = Number(m[1])
  if (!isSupportedChain(chainId) || !isAddress(m[2])) return { page: 'invalid-pay' }
  const q = new URLSearchParams(m[3] ?? '')
  const rawAmount = q.get('amount')
  const amount = rawAmount ? (parseUsdc6(rawAmount) ?? undefined) : undefined
  const label = q.get('for')?.trim().slice(0, MAX_LABEL) || undefined
  return { page: 'pay', chainId, slot: getAddress(m[2]), amount: amount && amount > 0n ? amount : undefined, label }
}

export function payUrl(base: string, p: Parameters<typeof buildPayHash>[0]): string {
  return `${base.replace(/\/+$/, '')}/${buildPayHash(p)}`
}
