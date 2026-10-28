/* oxlint-disable typescript/no-unsafe-argument, typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-member-access, typescript/no-unsafe-return -- untyped Node test harness */
// Test-only EIP-1193 wallet shim for Playwright: injects window.ethereum into a
// page and signs in Node with a TESTNET key (keys never reach the page).
import { createPublicClient, createWalletClient, http, numberToHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arcTestnet, baseSepolia, sepolia } from 'viem/chains'

const RPC = 'https://rpc.testnet.arc.io'
export const publicClient = createPublicClient({ chain: arcTestnet, transport: http(RPC) })
export const hexKey = (k) => (k.startsWith('0x') ? k : `0x${k}`)

// Testnets the shim can sign on. Arc testnet is the default chain.
const CHAINS = {
  [arcTestnet.id]: { chain: arcTestnet, rpc: RPC },
  [sepolia.id]: { chain: sepolia, rpc: 'https://ethereum-sepolia-rpc.publicnode.com' },
  [baseSepolia.id]: { chain: baseSepolia, rpc: 'https://sepolia.base.org' },
}

// contextOptions: extra Playwright context options (e.g. a viewport or recordVideo for demo recordings).
// opts.chains replaces the testnet-only chain list; only scripts/demo-mainnet.mjs passes it (explicit opt-in).
export async function walletPage(browser, key, name, contextOptions = {}, opts = {}) {
  const account = privateKeyToAccount(hexKey(key))
  const chains = opts.chains ?? CHAINS
  let current = opts.initialChain ?? arcTestnet.id
  if (!chains[current]) throw new Error(`start chain ${current} is not in the allowed list`)
  const sent = []
  const clients = (id) => {
    const { chain, rpc } = chains[id]
    return {
      wallet: createWalletClient({ account, chain, transport: http(rpc) }),
      pub: createPublicClient({ chain, transport: http(rpc) }),
    }
  }
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, ...contextOptions })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log(`[${name}] pageerror`, e.message))
  await page.exposeFunction('__walletRpc', async (method, params) => {
    switch (method) {
      case 'eth_requestAccounts':
      case 'eth_accounts': return [account.address]
      case 'eth_chainId': return numberToHex(current)
      case 'net_version': return String(current)
      case 'wallet_switchEthereumChain': {
        const id = Number(params[0].chainId)
        if (!chains[id]) throw Object.assign(new Error(`e2e wallet does not support chain ${id}`), { code: 4902 })
        if (id !== current) {
          current = id
          await page.evaluate((hex) => window.__walletEmit('chainChanged', hex), numberToHex(id))
          console.log(`[${name}] switched to chain ${id}`)
        }
        return null
      }
      case 'wallet_requestPermissions':
      case 'wallet_getPermissions': return [{ parentCapability: 'eth_accounts' }]
      case 'personal_sign':
        return account.signMessage({ message: { raw: params[0] } })
      case 'eth_signTypedData_v4': {
        const typed = typeof params[1] === 'string' ? JSON.parse(params[1]) : params[1]
        const { EIP712Domain: _omit, ...types } = typed.types
        return account.signTypedData({ domain: typed.domain, types, primaryType: typed.primaryType, message: typed.message })
      }
      case 'eth_sendTransaction': {
        const tx = params[0]
        const { wallet } = clients(current)
        const hash = await wallet.sendTransaction({
          to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : 0n,
          ...(tx.gas ? { gas: BigInt(tx.gas) } : {}),
        })
        console.log(`[${name}] sent ${hash} on ${current}`)
        sent.push({ hash, chainId: current, to: tx.to })
        return hash
      }
      default: return clients(current).pub.request({ method, params })
    }
  })
  // open the app on the same network the test wallet starts on
  await page.addInitScript((id) => { try { localStorage.setItem('arcslot:network', String(id)) } catch { /* ignore */ } }, current)
  await page.addInitScript(() => {
    const listeners = {}
    window.__walletEmit = (e, v) => (listeners[e] ?? []).forEach((f) => f(v))
    window.ethereum = {
      isMetaMask: true,
      request: ({ method, params }) => window.__walletRpc(method, params ?? []),
      on: (e, f) => { (listeners[e] ??= []).push(f) },
      removeListener: (e, f) => { listeners[e] = (listeners[e] ?? []).filter((x) => x !== f) },
    }
  })
  return { page, ctx, address: account.address, sent }
}

export async function connect(page) {
  await page.getByRole('button', { name: /connect wallet/i }).first().click()
  const option = page.getByRole('button', { name: /metamask|browser wallet|injected/i }).first()
  await option.click()
  await page.waitForTimeout(1500)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /^connect wallet$/i }).first().waitFor({ state: 'hidden', timeout: 20_000 })
}

