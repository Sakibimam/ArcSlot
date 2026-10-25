# Arc Slot

A deposit-address system built on [Arc](https://arc.io) — the blockchain where USDC is the native gas token.

Built with [Arc Studio](https://studio.arc.io)


**Live app (Arc testnet):** https://arc-slot-three.vercel.app

## What it does

Arc Slot lets you generate unique, deterministic USDC deposit addresses for merchants. Each address is a minimal proxy clone deployed by `SlotFactory`. Anyone can call `sweep()` on a funded slot — the caller is reimbursed for gas in USDC, an optional protocol fee goes to `feeRecipient`, and the remainder lands with the merchant. A blacklist-quarantine path handles Circle USDC compliance edge cases automatically.

## Tech stack

- **Frontend:** React 18, Vite 6, TypeScript, Tailwind CSS v3
- **Onchain:** wagmi v2, viem v2, ConnectKit
- **Contracts:** Solidity 0.8.28, Foundry, OpenZeppelin 5.x (EIP-1167 Clones, ReentrancyGuard, SafeERC20)
- **Chain:** Arc mainnet (5042) + Arc Testnet (5042002)
- **Token:** USDC at `0x3600000000000000000000000000000000000000` (6 decimals — also the native gas token on Arc)

## Contracts

| Contract | Role |
|---|---|
| `contracts/Slot.sol` | EIP-1167 clone implementation — one shared bytecode, one clone per deposit address |
| `contracts/SlotFactory.sol` | Deploys and tracks clones deterministically via `Clones.cloneDeterministic` |

### How it works for people

- **Merchant:** connect a wallet → enter an amount and what it's for → get a payment link + QR. Funds go to the connected wallet by default (no separate merchant address needed). Each request card shows live progress (`0.40 of 1.00 USDC received`) and a **Collect** button that moves the USDC to the wallet in one transaction.
- **Payer:** open the link → see the amount, what it's for, and the payee address read from the contract (not from the link) → **Pay with wallet** in one click, or **Send manually** to the address/QR from any exchange or wallet. The page confirms live when the payment lands. On testnet it links to the Circle faucet.
- Links are hash routes (`/#/pay/<chainId>/<slot>?amount=&for=`) so they work on any static host.

### On-chain requests

`SlotFactory.createRequest` stores each request's amount, description (≤ 80 bytes) and optional expiry on-chain, attributed to whoever created it. Payment links carry only the slot address, so nobody can edit the amount or description in a link.

- The payer page reads everything from the chain and shows **Verified request** only when the payee (or the owner of the payee's vault) created it; otherwise it warns.
- Expired requests stop accepting payments on the payer page.
- Each Slot records `totalCollected`, so a request still reads as paid after the merchant collects, and as collected on any device.
- The factory indexes requests by creator (`requestsOf`), so the dashboard loads from the chain on any device.

### Pay from another chain

The payment page has an **Another chain** tab. The payer picks Base, Ethereum, Arbitrum, OP Mainnet, Polygon or Avalanche (Base / Ethereum / Arbitrum Sepolia on testnet). Circle's App Kit burns USDC there over CCTP and the **Forwarding Service mints it straight into the Slot on Arc**, so the payer needs no Arc wallet and no Arc gas.

- **Receive-exact:** `feePayment: 'source'` means the Slot gets exactly the requested amount; the payer sees the total and the fee before confirming.
- The fee depends on the route. Paying *into Arc* testnet quoted about 0.16 USDC; minting on Ethereum L1 costs far more.
- Progress is shown per step (approve, burn, attestation, mint); a payment that stops mid-way is resumed with `retryBridge`, never re-sent.
- The payer sees "on its way" as soon as the burn confirms. Found live: `bridge()` can keep waiting on the Arc mint through a wallet that is still on the source chain, so the UI doesn't depend on that promise; the page watches the Slot's balance on Arc instead.
- Verified live: Ethereum Sepolia → Arc testnet Slot delivered exactly the requested 0.20 USDC.

### Quantum-safe vault

Merchants can route payouts into a `SlotVault` that only releases funds with a **post-quantum SLH-DSA-SHA2-128s signature** (FIPS 205), verified by Arc's PQ precompile at `0x1800…0004`, plus the owner wallet's signature in two-key mode. A stolen wallet key alone can't move funds.

- The key is generated in the browser, stored encrypted (PBKDF2 + AES-GCM), and backed up to a file that is checked on restore.
- Withdrawals are signed messages anyone can submit; the signer fixes the relayer fee. Nonce, chain ID and vault address prevent replay.
- Lost key: the owner wallet can start a recovery that completes after 7 days; the quantum-safe key can cancel it in the meantime.
- The vault address commits to the owner, key and settings, so nobody can pre-deploy "your" vault with their own key.
- Payers see "Pays into a quantum-safe vault" on the payment page, read from the contract.
- A withdrawal costs about 460k gas (~$0.01); signing takes about 1 second.

### Key design decisions

- **Permissionless sweep** — anyone can sweep any funded slot; the caller receives a gas reimbursement (USDC) plus a flat tip so they are always net-positive.
- **Per-slot reimbursement cap** — each slot stores `maxReimbursement` (default 0.05 USDC). Arc gas can swing ~1000x (20 → 20,000 gwei); if gas + tip exceeds the cap, a stranger's `sweep()` reverts `GasTooHigh` instead of eating the payment.
- **Base-fee pricing** — gas is reimbursed at `min(tx.gasprice, block.basefee)`, so a sweeper's priority tip can't inflate what the merchant pays (found live on testnet, where tooling sent a 575 gwei tip). The flat tip covers a normal priority fee.
- **Merchant can always sweep** — the merchant sweeping their own slot takes no reimbursement and bypasses the cap, so funds can never be locked by a gas spike (verified live on testnet at ~530 gwei).
- **Calibrated gas overhead** — Arc USDC transfers run through the native-coin precompile (~40k gas each), so the unmeasured overhead is `55k + 42k × transfers`, calibrated on an Arc mainnet fork and asserted to cover real cost within +15%.
- **No `msg.value`** — all amounts use the USDC ERC-20 interface exclusively. Arc's native balance and ERC-20 balance represent the same pool but differ by 1e12; the contracts only ever touch the 6-decimal ERC-20 view.
- **Fail-closed blacklist check** — before sweeping, `Slot` probes `isBlacklisted(address)` on the USDC contract via staticcall. A probe failure quarantines the slot rather than proceeding, preventing accidental transfers to blacklisted addresses.
- **Quarantine resolution** — the merchant can call `resolveQuarantine(newMerchant, newFeeRecipient, newFeeBps)` to replace either payout address and re-enable sweeping.
- **No selfdestruct, nothing payable** — both contracts reject native-value calls; no path exists to drain a slot's USDC via the native balance.

### Constructor args

```
Slot            — no constructor args (EIP-1167 implementation template)

SlotFactory(
  address _implementation,   // deployed Slot address
  address _usdc,             // 0x3600000000000000000000000000000000000000
  uint256 _tip,              // flat caller bonus in 6-decimal USDC (e.g. 2000 = 0.002 USDC)
  uint256 _minSweep          // minimum gross balance before sweep pays out (e.g. 100000 = 0.1 USDC)
)

SlotFactory.createSlot(merchant, payRef, feeBps, feeRecipient, maxReimbursement)
  // maxReimbursement must be >= tip (else MaxReimbursementBelowTip)
```

## Deployments

| Network | Contract | Address |
|---|---|---|
| Arc Testnet | `Slot` (implementation) | [`0x69D8F7E5Dcd38103bcbC4322868c265dAe387f2f`](https://explorer.testnet.arc.io/address/0x69D8F7E5Dcd38103bcbC4322868c265dAe387f2f) |
| Arc Testnet | `SlotFactory` | [`0x05104Dfe747f820097A8A6C46f7c282Ef9c6d7F9`](https://explorer.testnet.arc.io/address/0x05104Dfe747f820097A8A6C46f7c282Ef9c6d7F9) |
| Arc Testnet | `SlotVault` (implementation) | [`0xcFbEeC4d13cC8158834D6c42e9a7516CE0e174E7`](https://explorer.testnet.arc.io/address/0xcFbEeC4d13cC8158834D6c42e9a7516CE0e174E7) |
| Arc Testnet | `VaultFactory` | [`0x31057DE0e8E7Dba29C34A2Ac0ED1ddfd5A74C986`](https://explorer.testnet.arc.io/address/0x31057DE0e8E7Dba29C34A2Ac0ED1ddfd5A74C986) |
| Arc Mainnet | — | not yet deployed |

Both use `tip = 2000` (0.002 USDC) and `minSweep = 100000` (0.1 USDC). Deploy with `contracts/script/DeploySlot.s.sol`.

Live testnet end-to-end run (create → pay 0.15 USDC → stranger sweep): [sweep tx](https://explorer.testnet.arc.io/tx/0x636ab3e055171daf3cf49e0741b0975dec7c4841f9f593a1ff850242abd03436) — merchant +0.144646 USDC, sweeper reimbursed 0.005354 USDC vs 0.002388 USDC real gas.

> Earlier testnet factories `0x387eA5…474c` (no on-chain requests) and `0x34163d…4a45` predate newer features; `0x34163d…4a45` predates the reimbursement cap and base-fee pricing — do not use it.

## Development

### Prerequisites

- [Bun](https://bun.sh) >= 1.0
- [Foundry](https://getfoundry.sh) (forge, cast)
- Node 20+ (for type-checking)

### Install

```bash
bun install
```

### Run

```bash
bun run dev
```

Opens at `http://localhost:5173`. Connect a wallet on Arc Testnet to use the app. Use the **Get test USDC** button in Arc Studio's sidebar to fund a test wallet.

### Build

```bash
bun run build        # Vite production build → dist/
```

### Contracts

```bash
bun run contracts:test        # 103 Foundry unit + fuzz tests (mock USDC, mock PQ verifier)
bun run contracts:test:fork   # 15 tests on an Arc mainnet fork (real USDC, blocklist, PQ precompile with real SLH-DSA signatures; uses --ffi)
bun run test                  # 148 Vitest unit + component integration tests
bun run test:all              # everything above + typecheck + build
bun run abis                  # regenerate src/lib/abis.ts from Foundry artifacts
```

Fork tests need [Arc Foundry](https://docs.arc.io/arc/tutorials/install-arc-foundry.md) (`arc-forge`): stock Foundry can't execute Arc's native-coin precompile that USDC transfers go through.

Browser end-to-end on Arc testnet — drives the real UI with two wallets (merchant creates a link → payer pays → merchant collects). Needs the dev server on :5179:

```bash
PAYER_PRIVATE_KEY=0x... bun run test:e2e:ui
PAYER_PRIVATE_KEY=0x... node scripts/e2e-ui-vault.mjs     # quantum-safe vault journey
MERCHANT_PRIVATE_KEY=0x... bun run test:e2e:crosschain  # pay a Slot from Ethereum Sepolia (payer needs Sepolia ETH + USDC)
VAULT_FACTORY=0x31057DE0e8E7Dba29C34A2Ac0ED1ddfd5A74C986 node scripts/e2e-vault.mjs  # contract-level, live testnet
```

Live end-to-end check against a deployed factory (signs with `PRIVATE_KEY` from `.env`):

```bash
RPC=https://rpc.testnet.arc.io FACTORY=0x387eA56c76Ea72320b32C540eCf1cb74AA95474c \
  MERCHANT=<another address> bash scripts/e2e-live.sh
```

## Environment variables

None required to run the frontend — the app reads chain state via public RPC endpoints.

For self-deploying contracts (optional):

| Variable | Purpose |
|---|---|
| `CIRCLE_API_KEY` | Circle Developer API key (only needed for self-deploy via Circle SCP) |
| `CIRCLE_ENTITY_SECRET` | Circle entity secret (only needed for self-deploy via Circle SCP) |

Never commit `.env`. It is listed in `.gitignore`.

## Project structure

```
contracts/
  Slot.sol                  EIP-1167 implementation
  SlotFactory.sol           Clone factory
  test/Slot.t.sol           Foundry unit + fuzz tests
  test-integration/         Arc mainnet fork integration tests
  script/DeploySlot.s.sol   Deploy implementation + factory
  contract-metadata/        Deployment metadata (addresses, ABIs)
src/
  App.tsx                   App shell — chain toggle, tab navigation
  components/
    Header.tsx              Header with chain toggle + ConnectKit button
    NewSlot.tsx             Create-slot form with live predict() preview
    SlotCard.tsx            Per-slot card: balance, status, QR, sweep, receipt
    SlotsList.tsx           Slot list + empty state
    QrModal.tsx             QR code modal for deposit address
  lib/
    abis.ts                 Slot + SlotFactory ABIs
    chains.ts               Chain config, explorer URLs, factory address registry
    share.ts                getShareBase() helper for shareable links
```
