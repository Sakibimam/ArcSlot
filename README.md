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

### Key design decisions

- **Permissionless sweep** — anyone can sweep any funded slot; the caller receives a gas reimbursement (USDC) plus a flat tip so they are always net-positive.
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
```

## Deployments

| Network | Contract | Address |
|---|---|---|
| Arc Testnet | `Slot` (implementation) | [`0x5825d935aa33a6bc0213d43c1c15c887fec8a990`](https://explorer.testnet.arc.io/address/0x5825d935aa33a6bc0213d43c1c15c887fec8a990) |
| Arc Testnet | `SlotFactory` | [`0x34163d378498caca5cfedd06995f5cee02a14a45`](https://explorer.testnet.arc.io/address/0x34163d378498caca5cfedd06995f5cee02a14a45) |

The `SlotFactory` testnet deployment uses `tip = 2000` (0.002 USDC) and `minSweep = 100000` (0.1 USDC).

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
forge build          # compile
forge test           # run all 48 unit + fuzz tests
forge test -vv       # verbose output
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
  test/Slot.t.sol           48 Foundry unit + fuzz tests
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
