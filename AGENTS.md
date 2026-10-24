# Arc Slot

> Built with [Arc Studio](https://studio.arc.io)

A deposit-address system for Arc. `SlotFactory` deploys EIP-1167 minimal proxies (one per merchant+reference pair) with deterministic, predictable addresses. Each `Slot` receives USDC and can be swept by anyone — the sweeper is reimbursed for gas plus a flat tip, a protocol fee (optional) goes to `feeRecipient`, and the remainder goes to the merchant. A blacklist-quarantine path handles Circle USDC compliance.

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS, wagmi v2, viem v2, ConnectKit, qrcode.react
- Contracts: Solidity 0.8.28 + Foundry (OpenZeppelin 5.x). Sources in `contracts/`, unit tests in `contracts/test/Slot.t.sol`.
- Chain: Arc mainnet (5042) + Arc Testnet (5042002). USDC = `0x3600000000000000000000000000000000000000` (6 decimals) — also the native gas token.

## Key Contracts

| Contract | Role |
|---|---|
| `contracts/Slot.sol` | EIP-1167 implementation — one shared bytecode, cloned per deposit address |
| `contracts/SlotFactory.sol` | Deploys clones deterministically; owns `usdc`, `tip`, `minSweep` config |

### Constructor args

```
Slot            — no constructor args (implementation only)
SlotFactory(
  address _implementation,   // deployed Slot address
  address _usdc,             // 0x3600000000000000000000000000000000000000
  uint256 _tip,              // flat caller bonus in 6-dec USDC units  e.g. 2000 = 0.002 USDC
  uint256 _minSweep          // minimum gross before sweep pays out    e.g. 100000 = 0.1 USDC
)
```

## Deployments

| Network | Contract | Address |
|---|---|---|
| Arc Testnet | `Slot` (implementation) | `0x5825d935aa33a6bc0213d43c1c15c887fec8a990` |
| Arc Testnet | `SlotFactory` | `0x34163d378498caca5cfedd06995f5cee02a14a45` |

`Slot` is the EIP-1167 clone template — do not call it directly. All deposit addresses are created through `SlotFactory`.

## Key Files

- `src/App.tsx` — main app shell, chain toggle, routing
- `src/components/NewSlot.tsx` — create-slot form with live `predict()` preview
- `src/components/SlotCard.tsx` — per-slot card: balance, status, sweep button, receipt
- `src/components/QrModal.tsx` — QR code + copy for a deposit address
- `src/lib/abis.ts` — Slot + SlotFactory ABIs (trimmed from Foundry artifacts)
- `src/lib/chains.ts` — chain config, explorer URLs, factory address registry

## Factory Addresses

Edit `src/lib/chains.ts` → `FACTORY_ADDRESSES` after deploying.

## To Run

```bash
bun install
bun run dev
```

## To Build Contracts

```bash
forge build
forge test
```
