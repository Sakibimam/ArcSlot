import { describe, it, expect, vi } from 'vitest'
import { executeRecovery, probeRecovery, type ChainIO } from './recovery-exec'

const FACTORY = '0xCEc73Fb0a1B24C2Bd44126c7E9CAD93126A41151'
const VAULT_FACTORY = '0x85154fE5e5F5d2e9d4f11ef3159EB5c451b1eB97'
const SLOT = '0x00000000000000000000000000000000000000a1'
const WALLET = '0x1111111111111111111111111111111111111111'
const VAULT = '0x00000000000000000000000000000000000000b2'
const USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'
const REF = `0x${'77'.repeat(32)}`
const DIGEST = `0x${'cd'.repeat(32)}`
const OWNER_SIG: `0x${string}` = `0x${'0b'.repeat(65)}`

function fakeIO(code: Record<string, boolean> = {}, predicted: string = SLOT) {
  type Write = { functionName: string; address: string; args?: readonly unknown[] }
  const writes: Write[] = []
  const wait = vi.fn((_hash: `0x${string}`) => Promise.resolve())
  const signMessage = vi.fn((_digest: `0x${string}`) => Promise.resolve(OWNER_SIG))
  const io: ChainIO = {
    getCode: (a: string) => Promise.resolve(code[a.toLowerCase()] ? '0x60' : undefined),
    read: (r: { functionName: string }) => {
      if (r.functionName === 'balanceOf') return Promise.resolve(50_000n)
      if (r.functionName === 'withdrawDigest') return Promise.resolve(DIGEST)
      if (r.functionName === 'predict') return Promise.resolve(predicted)
      return Promise.reject(new Error(`unexpected read ${r.functionName}`))
    },
    write: (w: Write) => { writes.push(w); return Promise.resolve(`0xhash${writes.length}` as `0x${string}`) },
    wait,
    signMessage,
  }
  return { io, writes, wait, signMessage }
}

const base = { chainId: 11155111, usdc: USDC, factory: FACTORY, vaultFactory: VAULT_FACTORY, slot: SLOT, payRef: REF, wallet: WALLET }

describe('probeRecovery', () => {
  it('reports what already exists on the foreign chain', async () => {
    const { io } = fakeIO({ [FACTORY.toLowerCase()]: true, [VAULT.toLowerCase()]: true })
    expect(await probeRecovery(io, { factory: FACTORY, slot: SLOT, vault: VAULT, wallet: WALLET, merchant: WALLET, payRef: REF }))
      .toEqual({ factoryThere: true, slotThere: false, vaultThere: true, creatorMatches: true })
  })

  it('flags a wallet that did not create the request', async () => {
    const { io } = fakeIO({ [FACTORY.toLowerCase()]: true }, '0x00000000000000000000000000000000000000c3')
    expect(await probeRecovery(io, { factory: FACTORY, slot: SLOT, wallet: WALLET, merchant: WALLET, payRef: REF }))
      .toMatchObject({ creatorMatches: false })
  })
})

describe('executeRecovery', () => {
  it('wallet merchant: deploys the slot with no fee, then collects', async () => {
    const f = fakeIO()
    const io = f.io
    const res = await executeRecovery(io, { ...base, merchant: WALLET, steps: ['createSlot', 'collect'] })
    expect(f.writes.map((w) => w.functionName)).toEqual(['createSlot', 'sweep'])
    expect(f.writes[0]).toMatchObject({ address: FACTORY, args: [WALLET, REF, 0, '0x0000000000000000000000000000000000000000', 50_000n] })
    expect(f.writes[1]).toMatchObject({ address: SLOT })
    expect(f.wait).toHaveBeenCalledTimes(2)
    expect(res.recovered).toBe(50_000n)
  })

  it('vault merchant: recreates the vault, collects into it, withdraws to the owner with the wallet signature only', async () => {
    const f = fakeIO()
    const io = f.io
    const vault = { address: VAULT, owner: WALLET, pqKey: `0x${'ab'.repeat(32)}`, twoKey: true, recoveryDelay: '604800', salt: `0x${'12'.repeat(32)}` }
    await executeRecovery(io, { ...base, merchant: VAULT, vault, steps: ['createVault', 'createSlot', 'collect', 'withdraw'] })
    expect(f.writes.map((w) => w.functionName)).toEqual(['createVault', 'createSlot', 'sweep', 'withdraw'])
    expect(f.writes[0]).toMatchObject({ address: VAULT_FACTORY, args: [WALLET, vault.pqKey, true, 604_800n, vault.salt] })
    expect(f.signMessage).toHaveBeenCalledWith(DIGEST)
    const w = f.writes[3]
    expect(w.address).toBe(VAULT)
    expect(w.args?.[0]).toBe(WALLET)
    expect(w.args?.[1]).toBe(50_000n)
    expect(w.args?.[4]).toBe('0x') // no PQ signature off Arc
    expect(w.args?.[5]).toBe(`0x${'0b'.repeat(65)}`)
  })

  it('reports each step as it goes', async () => {
    const f = fakeIO()
    const io = f.io
    const seen: string[] = []
    await executeRecovery(io, { ...base, merchant: WALLET, steps: ['createSlot', 'collect'] }, (s) => seen.push(s))
    expect(seen).toEqual(['createSlot', 'collect'])
  })

  it('refuses to deploy a slot at a different address than the one paid', async () => {
    const f = fakeIO({}, '0x00000000000000000000000000000000000000c3')
    await expect(executeRecovery(f.io, { ...base, merchant: WALLET, steps: ['createSlot', 'collect'] })).rejects.toThrow(/created/i)
    expect(f.writes).toEqual([])
  })

  it('refuses to withdraw without vault details', async () => {
    await expect(executeRecovery(fakeIO().io, { ...base, merchant: VAULT, steps: ['withdraw'] })).rejects.toThrow(/vault/i)
  })
})
