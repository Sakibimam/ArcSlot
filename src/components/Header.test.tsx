import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { connectkitModule } from '@/test/wagmi-mock'

vi.mock('connectkit', () => connectkitModule)

import { Header } from './Header'

const phone = (coarse: boolean) => {
  window.matchMedia = ((q: string) => ({ matches: coarse && q === '(pointer: coarse)', media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
}

afterEach(() => { delete (window as { ethereum?: unknown }).ethereum })

describe('Header wallet button', () => {
  it('on a phone with no wallet in the browser, Connect opens a list of wallet apps instead of an empty picker', () => {
    phone(true)
    render(<Header />)
    fireEvent.click(screen.getByRole('button', { name: /connect wallet/i }))
    const dialog = screen.getByRole('dialog', { name: /open arcslot in your wallet/i })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open in metamask/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('on a phone inside a wallet app, uses the normal connect button', () => {
    phone(true)
    ;(window as unknown as { ethereum: unknown }).ethereum = { request: vi.fn() }
    render(<Header />)
    fireEvent.click(screen.getByRole('button', { name: /connect wallet/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('on a desktop without an extension, keeps the normal connect button', () => {
    phone(false)
    render(<Header />)
    fireEvent.click(screen.getByRole('button', { name: /connect wallet/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
