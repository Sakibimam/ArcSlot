import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { wagmiState, wagmiModule, connectkitModule, resetWagmi } from '@/test/wagmi-mock'

vi.mock('wagmi', () => wagmiModule)
vi.mock('connectkit', () => connectkitModule)
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { PayPage } from './PayPage'
import { SLOT_VAULT_IMPL } from '@/lib/chains'
import { minimalProxyCode } from '@/lib/slot-logic'

const SLOT = '0x10C2D81E0197F64Bd3e4c460a516eaDB0C348b7F'
const MERCHANT = '0x6192176de4b9f8Ac224521d13fc3979F7275E63b'
const ME = '0x1111111111111111111111111111111111111111'
const USDC = '0x3600000000000000000000000000000000000000'

type ChainRequest = { exists: boolean; creator: string; merchant: string; amount: bigint; createdAt: bigint; expiresAt: bigint; label: string }
function slotReads({ balance = 0n, merchant = MERCHANT, isError = false, collected = 0n, request = undefined as ChainRequest | undefined, isSlot = true, legacySlot = false } = {}) {
  wagmiState.readContracts = {
    isLoading: false, isError,
    data: isError ? undefined : [{ result: merchant }, { result: balance }, { result: collected }, { result: request }, { result: isSlot }, { result: legacySlot }],
  }
}
/** Make MERCHANT a genuine SlotVault clone on-chain. */
const merchantIsRealVault = () => { wagmiState.bytecode[MERCHANT.toLowerCase()] = minimalProxyCode(SLOT_VAULT_IMPL) }
const chainRequest = (over: Partial<ChainRequest> = {}): ChainRequest => ({
  exists: true, creator: MERCHANT, merchant: MERCHANT, amount: 2_000_000n, createdAt: 1n, expiresAt: 0n, label: 'Real label', ...over,
})
const props = { chainId: 5042002 as const, slot: SLOT, amount: 1_500_000n, label: 'Invoice #42' }

beforeEach(() => {
  resetWagmi()
  slotReads()
})

describe('PayPage', () => {
  it('shows what is being paid, to whom, and on which network', () => {
    render(<PayPage {...props} />)
    expect(screen.getByText('Invoice #42')).toBeInTheDocument()
    expect(screen.getByTestId('pay-amount')).toHaveTextContent('1.50 USDC')
    expect(screen.getByText(/0x6192…E63b/)).toBeInTheDocument()
    expect(screen.getAllByText(/arc testnet/i).length).toBeGreaterThan(0)
  })

  it('asks to connect a wallet before paying', () => {
    render(<PayPage {...props} />)
    expect(screen.getByRole('button', { name: /connect wallet/i })).toBeInTheDocument()
  })

  it('when Phantom refuses the switch, says why and offers the other ways to pay', async () => {
    slotReads()
    wagmiState.account = { address: ME, chainId: 11155111, connector: { id: 'app.phantom', name: 'Phantom' } }
    wagmiState.switchChainAsync = vi.fn(() => Promise.reject(Object.assign(new Error('Unrecognized chain ID'), { code: 4902 })))
    render(<PayPage {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /switch to arc testnet/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Testnet Mode/)
    fireEvent.click(screen.getByRole('button', { name: /pay from another chain/i }))
    expect(screen.getByRole('tab', { name: /another chain/i })).toHaveAttribute('aria-selected', 'true')
  })

  it('on a phone browser with no wallet, offers to open the link inside Phantom or MetaMask', () => {
    slotReads()
    delete (window as { ethereum?: unknown }).ethereum // no injected wallet
    render(<PayPage {...props} />)
    const phantom = screen.getByRole('link', { name: /open in phantom/i })
    expect(phantom.getAttribute('href')).toMatch(/^https:\/\/phantom\.app\/ul\/browse\//)
    expect(decodeURIComponent(phantom.getAttribute('href')!)).toContain(window.location.href)
    expect(screen.getByRole('link', { name: /open in metamask/i }).getAttribute('href')).toMatch(/^https:\/\/metamask\.app\.link\/dapp\//)
  })

  it('with a wallet already in the browser, no app links are shown', () => {
    slotReads()
    ;(window as unknown as { ethereum: unknown }).ethereum = { request: vi.fn() }
    render(<PayPage {...props} />)
    expect(screen.queryByRole('link', { name: /open in phantom/i })).not.toBeInTheDocument()
    delete (window as { ethereum?: unknown }).ethereum
  })

  it('offers a network switch when the wallet is elsewhere', () => {
    wagmiState.account = { address: ME, chainId: 5042 }
    render(<PayPage {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /switch to arc testnet/i }))
    expect(wagmiState.switchChainAsync).toHaveBeenCalledWith({ chainId: 5042002 })
  })

  it('pays the exact amount with a USDC transfer to the slot', () => {
    wagmiState.account = { address: ME, chainId: 5042002 }
    wagmiState.readByFn = { balanceOf: 5_000_000n }
    render(<PayPage {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /pay 1\.50 usdc/i }))
    expect(wagmiState.writeContract).toHaveBeenCalledWith(expect.objectContaining({
      address: USDC, functionName: 'transfer', args: [SLOT, 1_500_000n], chainId: 5042002,
    }))
  })

  it('lets the payer enter an amount when the link has none', () => {
    wagmiState.account = { address: ME, chainId: 5042002 }
    wagmiState.readByFn = { balanceOf: 5_000_000n }
    render(<PayPage {...props} amount={undefined} />)
    fireEvent.change(screen.getByLabelText(/amount to pay/i), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: /pay 2\.00 usdc/i }))
    expect(wagmiState.writeContract).toHaveBeenCalledWith(expect.objectContaining({ args: [SLOT, 2_000_000n] }))
  })

  it('warns about insufficient balance and links the faucet on testnet', () => {
    wagmiState.account = { address: ME, chainId: 5042002 }
    wagmiState.readByFn = { balanceOf: 200_000n }
    render(<PayPage {...props} />)
    expect(screen.getByText(/not enough usdc/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /pay 1\.50 usdc/i })).toBeDisabled()
    expect(screen.getByRole('link', { name: /get test usdc/i })).toHaveAttribute('href', 'https://faucet.circle.com')
  })

  it('shows the manual option with the deposit address', () => {
    render(<PayPage {...props} />)
    fireEvent.click(screen.getByRole('tab', { name: /send manually/i }))
    expect(screen.getByText(SLOT)).toBeInTheDocument()
    expect(screen.getByText(/send usdc on arc testnet \(native or token\)/i)).toBeInTheDocument()
  })

  it('confirms once the slot holds the requested amount', () => {
    slotReads({ balance: 1_500_000n })
    render(<PayPage {...props} />)
    expect(screen.getByText(/payment received/i)).toBeInTheDocument()
  })

  it('confirms after the payer’s own transfer succeeds', () => {
    wagmiState.account = { address: ME, chainId: 5042002 }
    wagmiState.readByFn = { balanceOf: 5_000_000n }
    wagmiState.write = { data: '0xbeef', isPending: false, error: null }
    wagmiState.waitReceipt = { data: {}, isLoading: false, isSuccess: true }
    render(<PayPage {...props} />)
    expect(screen.getByText(/payment sent/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /view transaction/i })).toHaveAttribute('href', expect.stringContaining('/tx/0xbeef'))
  })

  it('drops a coin into the slot on the Pay button while the payment confirms', () => {
    wagmiState.account = { address: ME, chainId: 5042002 }
    wagmiState.readByFn = { balanceOf: 5_000_000n }
    wagmiState.write = { data: '0xbeef', isPending: false, error: null }
    wagmiState.waitReceipt = { data: undefined, isLoading: true, isSuccess: false }
    render(<PayPage {...props} />)
    const btn = screen.getByRole('button', { name: /sending/i })
    expect(btn).toBeDisabled()
    expect(btn.querySelector('svg[aria-label="Sending payment"]')).not.toBeNull()
  })

  it('lands the coin, green, when the payment is sent or received', () => {
    wagmiState.account = { address: ME, chainId: 5042002 }
    wagmiState.readByFn = { balanceOf: 5_000_000n }
    wagmiState.write = { data: '0xbeef', isPending: false, error: null }
    wagmiState.waitReceipt = { data: {}, isLoading: false, isSuccess: true }
    const { unmount } = render(<PayPage {...props} />)
    expect(screen.getByRole('img', { name: /^paid$/i })).toBeInTheDocument()
    unmount()
    resetWagmi()
    slotReads({ balance: 1_500_000n })
    render(<PayPage {...props} />)
    expect(screen.getByText(/payment received/i)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /^paid$/i })).toBeInTheDocument()
  })

  it('rejects a link that does not point at a payment slot', () => {
    // The address answers no merchant(): not a slot at all.
    slotReads({ merchant: null as unknown as string })
    render(<PayPage {...props} />)
    expect(screen.getByText(/this payment link is not valid/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pay/i })).not.toBeInTheDocument()
  })

  // Bug seen live: when the Arc RPC couldn't be reached (rate limit, ad blocker,
  // flaky network), a perfectly valid link was reported as "not valid".
  it('says Arc cannot be reached, not that the link is invalid, when the RPC fails', () => {
    slotReads({ isError: true })
    render(<PayPage {...props} />)
    expect(screen.getByText(/can.t reach arc/i)).toBeInTheDocument()
    expect(screen.queryByText(/not valid/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^pay/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(wagmiState.refetch).toHaveBeenCalled()
  })

  // White-hat PoC (contracts/test/WhiteHat.t.sol): any contract can answer
  // merchant() with a famous payee and keep the money. Only factory slots pass.
  it('rejects a look-alike contract the factory did not deploy', () => {
    slotReads({ isSlot: false })
    render(<PayPage {...props} />)
    expect(screen.getByText(/this payment link is not valid/i)).toBeInTheDocument()
    expect(screen.queryByText(/fixed in the contract/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pay/i })).not.toBeInTheDocument()
  })
})

describe('PayPage — vault badge', () => {
  it('shows that the payee is a quantum-safe vault', () => {
    merchantIsRealVault()
    wagmiState.readByFn = { pqKey: `0x${'ab'.repeat(32)}` }
    render(<PayPage {...props} />)
    expect(screen.getByText(/pays into a quantum-safe vault/i)).toBeInTheDocument()
  })

  it('shows no badge for a plain wallet', () => {
    wagmiState.readByFn = { pqKey: undefined }
    render(<PayPage {...props} />)
    expect(screen.queryByText(/quantum-safe vault/i)).not.toBeInTheDocument()
  })
})

describe('PayPage — on-chain request', () => {
  it('trusts the chain over an edited link', () => {
    slotReads({ request: chainRequest() })
    render(<PayPage {...props} />)
    expect(screen.getByRole('heading', { name: 'Real label' })).toBeInTheDocument()
    expect(screen.getByTestId('pay-amount')).toHaveTextContent('2.00 USDC')
    expect(screen.queryByText('Invoice #42')).not.toBeInTheDocument()
  })

  it('says when the payee wallet itself created the request (v8: no verified claim)', () => {
    slotReads({ request: chainRequest() })
    render(<PayPage {...props} />)
    expect(screen.getByText(/created by the payee.s own wallet/i)).toBeInTheDocument()
    expect(screen.queryByText(/verified/i)).not.toBeInTheDocument()
  })

  it('verifies a request created by the owner of the payee vault', () => {
    const OWNER = '0x2222222222222222222222222222222222222222'
    slotReads({ request: chainRequest({ creator: OWNER }) })
    merchantIsRealVault()
    wagmiState.readByFn = { pqKey: `0x${'ab'.repeat(32)}`, owner: OWNER }
    render(<PayPage {...props} />)
    expect(screen.getByText(/created by the payee.s own wallet/i)).toBeInTheDocument()
  })

  // White-hat PoC: a contract that merely answers pqKey()/owner() is not a vault.
  it('does not trust a fake vault that only answers pqKey() and owner()', () => {
    const OWNER = '0x2222222222222222222222222222222222222222'
    slotReads({ request: chainRequest({ creator: OWNER }) })
    wagmiState.bytecode[MERCHANT.toLowerCase()] = '0x6080604052'
    wagmiState.readByFn = { pqKey: `0x${'ab'.repeat(32)}`, owner: OWNER }
    render(<PayPage {...props} />)
    expect(screen.queryByText(/quantum-safe vault/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/created by the payee.s own wallet/i)).not.toBeInTheDocument()
    expect(screen.getByText(/created by someone other than the payee/i)).toBeInTheDocument()
  })

  it('warns when someone other than the payee created the request', () => {
    slotReads({ request: chainRequest({ creator: '0x3333333333333333333333333333333333333333' }) })
    render(<PayPage {...props} />)
    expect(screen.getByText(/created by someone other than the payee/i)).toBeInTheDocument()
  })

  it('works from a short link with no amount in it', () => {
    wagmiState.account = { address: ME, chainId: 5042002 }
    wagmiState.readByFn = { balanceOf: 5_000_000n }
    slotReads({ request: chainRequest() })
    render(<PayPage chainId={5042002} slot={SLOT} amount={undefined} label={undefined} />)
    fireEvent.click(screen.getByRole('button', { name: /pay 2\.00 usdc/i }))
    expect(wagmiState.writeContract).toHaveBeenCalledWith(expect.objectContaining({ args: [SLOT, 2_000_000n] }))
  })

  it('refuses payment after the request expires', () => {
    slotReads({ request: chainRequest({ expiresAt: 1_000n }) })
    render(<PayPage {...props} />)
    expect(screen.getByText(/this request expired/i)).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /pay with wallet/i })).not.toBeInTheDocument()
  })

  it('still shows paid after the merchant collected the money', () => {
    slotReads({ balance: 0n, collected: 2_000_000n, request: chainRequest() })
    render(<PayPage {...props} />)
    expect(screen.getByText(/payment received/i)).toBeInTheDocument()
  })
})

// ─── Pay from another chain ────────────────────────────────────────────────

vi.mock('@/lib/crosschain-pay', () => ({
  quoteCrossChainPayment: vi.fn(),
  sendCrossChainPayment: vi.fn(),
  retryCrossChainPayment: vi.fn(),
}))
import { quoteCrossChainPayment, sendCrossChainPayment, retryCrossChainPayment } from '@/lib/crosschain-pay'

describe('PayPage — pay from another chain', () => {
  const quote = { summary: { receives: 1_500_000n, fee: 159_019n, debit: 1_659_019n }, quote: '0xsigned' }
  beforeEach(() => {
    vi.mocked(quoteCrossChainPayment).mockReset().mockResolvedValue(quote)
    vi.mocked(sendCrossChainPayment).mockReset()
    vi.mocked(retryCrossChainPayment).mockReset()
    wagmiState.account = { ...wagmiState.account, address: ME, chainId: 5042002 }
  })

  function openTab() {
    render(<PayPage {...props} />)
    fireEvent.click(screen.getByRole('tab', { name: /another chain/i }))
  }

  it('offers the testnet source chains', () => {
    openTab()
    const options = screen.getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual(['Base Sepolia', 'Ethereum Sepolia', 'Arbitrum Sepolia'])
  })

  it('switches to the source chain and shows an exact quote', async () => {
    openTab()
    fireEvent.click(screen.getByRole('button', { name: /review payment/i }))
    expect(await screen.findByText(/merchant receives exactly 1\.50 usdc/i)).toBeInTheDocument()
    expect(wagmiState.switchChainAsync).toHaveBeenCalledWith({ chainId: 84532 })
    expect(vi.mocked(quoteCrossChainPayment).mock.calls[0][0]).toMatchObject({ source: 'Base_Sepolia', slot: SLOT, amount: 1_500_000n, arcChainId: 5042002 })
    expect(screen.getByTestId('xc-debit')).toHaveTextContent('1.659019 USDC')
    expect(screen.getByTestId('xc-fee')).toHaveTextContent('0.159019 USDC')
  })

  it('pays with the signed quote and confirms', async () => {
    vi.mocked(sendCrossChainPayment).mockResolvedValue({ state: 'success', steps: [] } as never)
    openTab()
    fireEvent.click(screen.getByRole('button', { name: /review payment/i }))
    fireEvent.click(await screen.findByRole('button', { name: /pay 1\.659019 usdc from base sepolia/i }))
    expect(await screen.findByText(/on its way/i)).toBeInTheDocument()
    expect(vi.mocked(sendCrossChainPayment).mock.calls[0][0]).toMatchObject({ source: 'Base_Sepolia', slot: SLOT, amount: 1_500_000n, quote: '0xsigned' })
  })

  it('offers a retry that resumes a stopped payment', async () => {
    const failed = { state: 'error', steps: [{ name: 'approve', state: 'success' }, { name: 'burn', state: 'error' }] }
    vi.mocked(sendCrossChainPayment).mockResolvedValue(failed as never)
    vi.mocked(retryCrossChainPayment).mockResolvedValue({ state: 'success', steps: [] } as never)
    openTab()
    fireEvent.click(screen.getByRole('button', { name: /review payment/i }))
    fireEvent.click(await screen.findByRole('button', { name: /pay 1\.659019 usdc/i }))
    expect(await screen.findByText(/stopped at the burn step/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /resume payment/i }))
    expect(await screen.findByText(/on its way/i)).toBeInTheDocument()
    expect(vi.mocked(retryCrossChainPayment).mock.calls[0][0]).toBe(failed)
  })

  it('says exactly why a payment failed: no gas on the source chain', async () => {
    vi.mocked(sendCrossChainPayment).mockRejectedValue(Object.assign(new Error('gas'), { name: 'BALANCE_INSUFFICIENT_GAS' }))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    openTab()
    fireEvent.click(screen.getByRole('button', { name: /review payment/i }))
    fireEvent.click(await screen.findByRole('button', { name: /pay 1\.659019 usdc/i }))
    expect(await screen.findByText(/not enough ETH on Base Sepolia to pay gas/i)).toBeInTheDocument()
    expect(screen.queryByText(/payment failed before anything was sent/i)).not.toBeInTheDocument()
    expect(log).toHaveBeenCalled() // the raw error is kept for debugging
    log.mockRestore()
  })

  it('says when Circle could not be reached (ad blocker / Brave Shields)', async () => {
    vi.mocked(sendCrossChainPayment).mockRejectedValue(new TypeError('Failed to fetch'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    openTab()
    fireEvent.click(screen.getByRole('button', { name: /review payment/i }))
    fireEvent.click(await screen.findByRole('button', { name: /pay 1\.659019 usdc/i }))
    expect(await screen.findByText(/couldn.t reach circle/i)).toBeInTheDocument()
  })

  it('refreshes a quote older than a minute before sending, and pays with the fresh one', async () => {
    const t0 = 1_800_000_000_000
    const now = vi.spyOn(Date, 'now').mockReturnValue(t0)
    vi.mocked(quoteCrossChainPayment).mockResolvedValueOnce(quote).mockResolvedValueOnce({ ...quote, quote: '0xfresh' })
    vi.mocked(sendCrossChainPayment).mockResolvedValue({ state: 'success', steps: [] } as never)
    openTab()
    fireEvent.click(screen.getByRole('button', { name: /review payment/i }))
    const pay = await screen.findByRole('button', { name: /pay 1\.659019 usdc/i })
    now.mockReturnValue(t0 + 61_000)
    fireEvent.click(pay)
    expect(await screen.findByText(/on its way/i)).toBeInTheDocument()
    expect(vi.mocked(quoteCrossChainPayment)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(sendCrossChainPayment).mock.calls[0][0]).toMatchObject({ quote: '0xfresh' })
    now.mockRestore()
  })

  it('a fresh quote is used as-is (no extra round trip)', async () => {
    vi.mocked(sendCrossChainPayment).mockResolvedValue({ state: 'success', steps: [] } as never)
    openTab()
    fireEvent.click(screen.getByRole('button', { name: /review payment/i }))
    fireEvent.click(await screen.findByRole('button', { name: /pay 1\.659019 usdc/i }))
    expect(await screen.findByText(/on its way/i)).toBeInTheDocument()
    expect(vi.mocked(quoteCrossChainPayment)).toHaveBeenCalledTimes(1)
  })

  it('explains a failed quote', async () => {
    vi.mocked(quoteCrossChainPayment).mockRejectedValue(new Error('route unsupported'))
    openTab()
    fireEvent.click(screen.getByRole('button', { name: /review payment/i }))
    expect(await screen.findByText(/couldn.t get a quote/i)).toBeInTheDocument()
  })
})

describe('PayPage — cross-chain payment confirmed by the burn', () => {
  beforeEach(() => {
    vi.mocked(quoteCrossChainPayment).mockReset().mockResolvedValue({ summary: { receives: 1_500_000n, fee: 159_019n, debit: 1_659_019n }, quote: '0xsigned' })
    wagmiState.account = { ...wagmiState.account, address: ME, chainId: 5042002 }
  })

  /** Found live: bridge() can keep waiting on the Arc mint through a wallet that is on the source chain. */
  it('shows the payment on its way once the burn confirms, even if the SDK call never returns', async () => {
    vi.mocked(sendCrossChainPayment).mockReset().mockImplementation((r: { onStep?: (s: 'approve' | 'burn') => void }) => {
      r.onStep?.('approve')
      r.onStep?.('burn')
      return new Promise(() => {}) as never // never settles
    })
    render(<PayPage {...props} />)
    fireEvent.click(screen.getByRole('tab', { name: /another chain/i }))
    fireEvent.click(screen.getByRole('button', { name: /review payment/i }))
    fireEvent.click(await screen.findByRole('button', { name: /pay 1\.659019 usdc/i }))
    expect(await screen.findByText(/on its way/i)).toBeInTheDocument()
  })

  it('does not claim success before the burn', async () => {
    vi.mocked(sendCrossChainPayment).mockReset().mockImplementation((r: { onStep?: (s: 'approve') => void }) => {
      r.onStep?.('approve')
      return new Promise(() => {}) as never
    })
    render(<PayPage {...props} />)
    fireEvent.click(screen.getByRole('tab', { name: /another chain/i }))
    fireEvent.click(screen.getByRole('button', { name: /review payment/i }))
    fireEvent.click(await screen.findByRole('button', { name: /pay 1\.659019 usdc/i }))
    expect(await screen.findByText(/sending from your chain|approving usdc/i)).toBeInTheDocument()
    expect(screen.queryByText(/on its way/i)).not.toBeInTheDocument()
  })
})

// v8 (audit M-6, L-3, info): honest trust signals, clean labels, older slots.
describe('PayPage — v8 hardening', () => {
  it('shows the payee as fixed in the contract, without calling it verified', () => {
    render(<PayPage {...props} />)
    expect(screen.getByText(/fixed in the contract/i)).toBeInTheDocument()
    expect(screen.queryByText(/verified on-chain/i)).not.toBeInTheDocument()
  })

  it('strips bidi overrides and invisible characters from the label', () => {
    slotReads({ request: chainRequest({ label: 'Invoice\u202E 42\u200B\u2066x' }) })
    render(<PayPage {...props} />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Invoice 42x$/)
  })

  it('reminds the payer the description is written by the request creator', () => {
    slotReads({ request: chainRequest() })
    render(<PayPage {...props} />)
    expect(screen.getByText(/written by whoever created this request/i)).toBeInTheDocument()
  })

  it('still accepts a slot from an earlier factory version, and says so', () => {
    slotReads({ isSlot: false, legacySlot: true })
    render(<PayPage {...props} />)
    expect(screen.queryByText(/this payment link is not valid/i)).not.toBeInTheDocument()
    expect(screen.getByText(/earlier version/i)).toBeInTheDocument()
  })

  it('manual payment explains native USDC works and mistakes are recoverable', () => {
    render(<PayPage {...props} />)
    fireEvent.click(screen.getByRole('tab', { name: /send manually/i }))
    expect(screen.getByText(/native or token/i)).toBeInTheDocument()
    expect(screen.queryByText(/can.t be recovered/i)).not.toBeInTheDocument()
  })
})
