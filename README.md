# Arc Slot

A deposit-address system built on [Arc](https://arc.io) — the blockchain where USDC is the native gas token.

Built with [Arc Studio](https://studio.arc.io)

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
| Arc Testnet | `Slot` (implementation) | [`0xdefA7372c2376A7F79609355a97FC97369316Da7`](https://explorer.testnet.arc.io/address/0xdefA7372c2376A7F79609355a97FC97369316Da7) |
| Arc Testnet | `SlotFactory` | [`0x387eA56c76Ea72320b32C540eCf1cb74AA95474c`](https://explorer.testnet.arc.io/address/0x387eA56c76Ea72320b32C540eCf1cb74AA95474c) |
| Arc Mainnet | — | not yet deployed |

Both use `tip = 2000` (0.002 USDC) and `minSweep = 100000` (0.1 USDC). Deploy with `contracts/script/DeploySlot.s.sol`.

Live testnet end-to-end run (create → pay 0.15 USDC → stranger sweep): [sweep tx](https://explorer.testnet.arc.io/tx/0x636ab3e055171daf3cf49e0741b0975dec7c4841f9f593a1ff850242abd03436) — merchant +0.144646 USDC, sweeper reimbursed 0.005354 USDC vs 0.002388 USDC real gas.

> Earlier testnet factory `0x34163d…4a45` predates the reimbursement cap and base-fee pricing — do not use it.

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
bun run contracts:test        # 59 Foundry unit + fuzz tests (mock USDC)
bun run contracts:test:fork   # 9 integration tests on an Arc mainnet fork (real USDC + blocklist)
bun run test                  # 71 Vitest unit + component integration tests
bun run test:all              # everything above + typecheck + build
bun run abis                  # regenerate src/lib/abis.ts from Foundry artifacts
```

Fork tests need [Arc Foundry](https://docs.arc.io/arc/tutorials/install-arc-foundry.md) (`arc-forge`): stock Foundry can't execute Arc's native-coin precompile that USDC transfers go through.

Browser end-to-end on Arc testnet — drives the real UI with two wallets (merchant creates a link → payer pays → merchant collects). Needs the dev server on :5179:

```bash
PAYER_PRIVATE_KEY=0x... bun run test:e2e:ui
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
