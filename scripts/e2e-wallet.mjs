/* oxlint-disable typescript/no-unsafe-argument, typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-member-access, typescript/no-unsafe-return -- untyped Node test harness */
// Test-only EIP-1193 wallet shim for Playwright: injects window.ethereum into a
// page and signs in Node with a TESTNET key (keys never reach the page).
import { createPublicClient, createWalletClient, http, numberToHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arcTestnet } from 'viem/chains'

const RPC = 'https://rpc.testnet.arc.io'
export const publicClient = createPublicClient({ chain: arcTestnet, transport: http(RPC) })
export const hexKey = (k) => (k.startsWith('0x') ? k : `0x${k}`)

export async function walletPage(browser, key, name) {
  const account = privateKeyToAccount(hexKey(key))
  const wallet = createWalletClient({ account, chain: arcTestnet, transport: http(RPC) })
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log(`[${name}] pageerror`, e.message))
  await page.exposeFunction('__walletRpc', async (method, params) => {
    switch (method) {
      case 'eth_requestAccounts':
      case 'eth_accounts': return [account.address]
      case 'eth_chainId': return numberToHex(arcTestnet.id)
      case 'net_version': return String(arcTestnet.id)
      case 'wallet_switchEthereumChain':
        if (Number(params[0].chainId) !== arcTestnet.id) throw new Error('e2e wallet is testnet-only')
        return null
      case 'wallet_requestPermissions':
      case 'wallet_getPermissions': return [{ parentCapability: 'eth_accounts' }]
      case 'personal_sign':
        return account.signMessage({ message: { raw: params[0] } })
      case 'eth_sendTransaction': {
        const tx = params[0]
        const hash = await wallet.sendTransaction({
          to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : 0n,
          maxPriorityFeePerGas: 1_000_000_000n,
        })
        console.log(`[${name}] sent ${hash}`)
        return hash
      }
      default: return publicClient.request({ method, params })
    }
  })
  await page.addInitScript(() => {
    const listeners = {}
    window.ethereum = {
      isMetaMask: true,
      request: ({ method, params }) => window.__walletRpc(method, params ?? []),
      on: (e, f) => { (listeners[e] ??= []).push(f) },
      removeListener: (e, f) => { listeners[e] = (listeners[e] ?? []).filter((x) => x !== f) },
    }
  })
  return { page, address: account.address }
}

export async function connect(page) {
  await page.getByRole('button', { name: /connect wallet/i }).first().click()
  const option = page.getByRole('button', { name: /metamask|browser wallet|injected/i }).first()
  await option.click()
  await page.waitForTimeout(1500)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /^connect wallet$/i }).first().waitFor({ state: 'hidden', timeout: 20_000 })
}

