import { describe, it, expect } from 'vitest'
import { explainSwitchError, hasBrowserWallet, isPhone, isPhantom, walletAppLinks } from './wallet-help'

const err = (code: number | undefined, message: string) => Object.assign(new Error(message), { code })
const arcTestnet = { network: 'Arc Testnet', chainId: 5042002, testnet: true }

describe('isPhantom', () => {
  it('spots Phantom by its EIP-6963 id or name', () => {
    expect(isPhantom({ id: 'app.phantom', name: 'Phantom' })).toBe(true)
    expect(isPhantom({ id: 'injected', name: 'Phantom' })).toBe(true)
    expect(isPhantom({ id: 'io.metamask', name: 'MetaMask' })).toBe(false)
    expect(isPhantom(undefined)).toBe(false)
  })
})

describe('explainSwitchError', () => {
  it('Phantom on testnet: points at Testnet Mode, the usual cause', () => {
    const msg = explainSwitchError(err(4902, 'Unrecognized chain ID'), { ...arcTestnet, phantom: true })
    expect(msg).toMatch(/Phantom/)
    expect(msg).toMatch(/Settings → Developer Settings → Testnet Mode/)
    expect(msg).toMatch(/Arc Testnet/)
  })
  it('a cancelled switch is just that', () => {
    expect(explainSwitchError(err(4001, 'User rejected the request.'), { ...arcTestnet, phantom: true })).toBe('You cancelled the network switch.')
    expect(explainSwitchError(err(undefined, 'User rejected the request.'), { ...arcTestnet, phantom: false })).toBe('You cancelled the network switch.')
  })
  it('a wallet that does not know the network gets the details to add it', () => {
    const msg = explainSwitchError(err(4902, 'Unrecognized chain ID "0x4cef52"'), { ...arcTestnet, phantom: false })
    expect(msg).toMatch(/doesn.t know Arc Testnet/)
    expect(msg).toMatch(/5042002/)
    expect(msg).toMatch(/https:\/\/rpc\.testnet\.arc\.io/)
  })
  it('a request already open in the wallet', () => {
    expect(explainSwitchError(err(-32002, 'Request already pending'), { ...arcTestnet, phantom: false })).toMatch(/open your wallet/i)
  })
  it('mainnet uses the mainnet details', () => {
    const msg = explainSwitchError(err(4902, 'Unrecognized chain'), { network: 'Arc', chainId: 5042, testnet: false, phantom: false })
    expect(msg).toMatch(/5042\b/)
    expect(msg).toMatch(/rpc\.mainnet\.arc\.io/)
  })
})

describe('walletAppLinks', () => {
  it('opens the exact page inside the wallet app browser', () => {
    const url = 'https://arc-slot-three.vercel.app/#/pay/5042002/0xabc?amount=1.5'
    const [phantom, metamask] = walletAppLinks(url)
    expect(phantom).toEqual({
      name: 'Phantom',
      href: `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent('https://arc-slot-three.vercel.app')}`,
    })
    expect(metamask).toEqual({ name: 'MetaMask', href: 'https://metamask.app.link/dapp/arc-slot-three.vercel.app/#/pay/5042002/0xabc?amount=1.5' })
  })
})

describe('walletAppLinks (phones)', () => {
  it('covers the four big mobile wallets, each reopening the exact page', () => {
    const url = 'https://arc-slot-three.vercel.app/#/app'
    const links = walletAppLinks(url)
    expect(links.map((l) => l.name)).toEqual(['Phantom', 'MetaMask', 'Coinbase Wallet', 'Trust Wallet'])
    expect(links[2].href).toBe(`https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(url)}`)
    expect(links[3].href).toBe(`https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(url)}`)
  })
})

describe('hasBrowserWallet / isPhone', () => {
  it('sees an injected wallet only when window.ethereum exists', () => {
    expect(hasBrowserWallet({} as Window)).toBe(false)
    expect(hasBrowserWallet({ ethereum: {} } as unknown as Window)).toBe(true)
    // src/tracing.ts always defines window.ethereum (as undefined until a wallet sets it)
    const traced = {} as Window
    Object.defineProperty(traced, 'ethereum', { get: () => undefined, configurable: true })
    expect(hasBrowserWallet(traced)).toBe(false)
  })
  it('treats a touch-first screen as a phone', () => {
    const win = (coarse: boolean) => ({ matchMedia: (q: string) => ({ matches: coarse && q === '(pointer: coarse)' }) }) as unknown as Window
    expect(isPhone(win(true))).toBe(true)
    expect(isPhone(win(false))).toBe(false)
    expect(isPhone({} as Window)).toBe(false)
  })
})
