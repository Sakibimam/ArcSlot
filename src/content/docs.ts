// ArcSlot documentation, rendered at #/docs/<id>.
// Inline text supports `code`, **bold** and [label](href). Internal links use #/docs/<id>.
// Contract addresses come from src/lib/chains.ts so they can't drift; docs.test.ts
// also checks the README carries the same ones. Bump DOCS_UPDATED when you edit.

import {
  ARC_TESTNET_ID,
  FACTORY_ADDRESSES,
  SLOT_VAULT_IMPL,
  TESTNET_FAUCET_URL,
  USDC_ADDRESS,
  VAULT_FACTORY_ADDRESSES,
} from '@/lib/chains'

export const DOCS_UPDATED = '2026-10-27'
export const DOCS_VERSION = 'v8'
/** Slot implementation (EIP-1167 template). Not read by the app, so it lives here. */
export const SLOT_IMPL = '0x136F85f4cb8e3758Fc421c2220FBeebb294D8DE2'

const FACTORY = FACTORY_ADDRESSES[ARC_TESTNET_ID]
const VAULT_FACTORY = VAULT_FACTORY_ADDRESSES[ARC_TESTNET_ID]
const EXPLORER = 'https://explorer.testnet.arc.io/address/'
const REPO = 'https://github.com/Sakibimam/ArcSlot'

export type Block =
  | { type: 'p'; text: string }
  | { type: 'h3'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'steps'; items: { title: string; text: string }[] }
  | { type: 'code'; lang: string; code: string }
  | { type: 'table'; head: string[]; rows: string[][] }
  | { type: 'note'; tone: 'info' | 'warn'; text: string }
  | { type: 'flow'; label: string; nodes: { title: string; sub: string }[] }

export const DOCS_GROUPS = ['Get started', 'How it works', 'Reference'] as const
export type DocsGroup = (typeof DOCS_GROUPS)[number]

export interface DocSection {
  id: string
  title: string
  group: DocsGroup
  /** One line under the title, and the sidebar tooltip. */
  summary: string
  blocks: Block[]
}

export const DOCS: DocSection[] = [
  // ── Get started ─────────────────────────────────────────────────────────────
  {
    id: 'overview',
    title: 'What is ArcSlot',
    group: 'Get started',
    summary: 'Payment links for USDC on Arc. You keep the payment, minus about two cents.',
    blocks: [
      { type: 'p', text: 'ArcSlot turns a USDC invoice into a link. Each link points at its own deposit address, a small contract called a Slot, that can only ever pay you. Your customer pays from any wallet or exchange, or from another chain, and you collect the full amount minus a network fee of a cent or two.' },
      { type: 'list', items: [
        '**Non-custodial.** Funds sit in a contract that pays a fixed address. Nobody, including us, can redirect them.',
        '**No account, no backend.** The app is a static site. Everything it shows is read from the chain.',
        '**Any wallet.** Payers can pay with a connected wallet, send manually to the address or QR, or pay from Base, Ethereum, Arbitrum, OP Mainnet, Polygon or Avalanche through Circle CCTP.',
        '**Tamper-proof links.** The amount and description are stored on-chain, so nobody can edit them in a link.',
      ] },
      { type: 'note', tone: 'info', text: `ArcSlot ${DOCS_VERSION} is live on Arc testnet. Get free test USDC at the [Circle faucet](${TESTNET_FAUCET_URL}). Arc mainnet is not deployed yet.` },
      { type: 'p', text: 'New here? Start with [Get paid](#/docs/merchants), or see [Architecture](#/docs/architecture) for how the pieces fit.' },
    ],
  },
  {
    id: 'merchants',
    title: 'Get paid',
    group: 'Get started',
    summary: 'Create a payment link, share it, collect the money.',
    blocks: [
      { type: 'steps', items: [
        { title: 'Connect a wallet', text: 'Open the [app](#/app) and connect any EVM wallet on Arc testnet. Payouts go to this wallet unless you choose a different address or a quantum-safe vault.' },
        { title: 'Create a request', text: 'Enter the amount in USDC and what it is for (up to 80 bytes). Optionally let it expire after 1, 7 or 30 days. One transaction deploys the Slot and stores the request on-chain.' },
        { title: 'Share the link', text: 'Copy the link or show the QR code. The link carries only the Slot address, so it can be sent anywhere.' },
        { title: 'Watch it arrive', text: 'The request card shows live progress, such as `0.40 of 1.00 USDC received`, and flips to paid the moment the money lands.' },
        { title: 'Collect', text: 'Press **Collect** to move the USDC to your wallet in one transaction. If you don\'t, a collector may deliver it for you for a small capped reward. See [Fees and collectors](#/docs/fees).' },
      ] },
      { type: 'h3', text: 'Advanced options' },
      { type: 'list', items: [
        '**Max collector reward** (default 0.05 USDC): the most a stranger may keep for delivering your payment. Above it, collection waits until gas drops.',
        '**Platform fee** (0–10%): for marketplaces that take a cut. The fee goes to a fixed fee wallet at collection.',
        '**Payout to a vault:** route payouts to your [quantum-safe vault](#/docs/vault).',
      ] },
      { type: 'note', tone: 'info', text: 'Your requests load from the chain, so they appear on any device where you connect the same wallet.' },
    ],
  },
  {
    id: 'payers',
    title: 'Pay a link',
    group: 'Get started',
    summary: 'What your customer sees, and the three ways to pay.',
    blocks: [
      { type: 'p', text: 'The payment page reads the amount, description and payee from the contract, not from the link. It shows **Verified request** only when the payee (or the owner of the payee\'s vault) created the request; otherwise it warns.' },
      { type: 'table', head: ['Method', 'Needs', 'Best for'], rows: [
        ['**Pay with wallet**', 'A wallet on Arc with USDC', 'One click, about a second to confirm'],
        ['**Send manually**', 'Any wallet or exchange that withdraws USDC on Arc', 'Paying from an exchange balance'],
        ['**Another chain**', 'USDC plus gas on Base, Ethereum, Arbitrum, OP Mainnet, Polygon or Avalanche', 'Customers without funds on Arc. See [Pay from another chain](#/docs/cross-chain)'],
      ] },
      { type: 'p', text: 'The page confirms live when the payment lands. Expired requests stop accepting payment on the page.' },
      { type: 'note', tone: 'warn', text: 'Sending manually on the wrong network (for example Ethereum instead of Arc) does not lose the money: the merchant can recover it. See [Wrong-network recovery](#/docs/recovery).' },
    ],
  },

  // ── How it works ────────────────────────────────────────────────────────────
  {
    id: 'architecture',
    title: 'Architecture',
    group: 'How it works',
    summary: 'A static web app, four contracts, and Circle CCTP. No servers in the payment path.',
    blocks: [
      { type: 'flow', label: 'Path of a payment', nodes: [
        { title: 'Payer', sub: 'Any wallet, exchange, or another chain via CCTP' },
        { title: 'Slot', sub: 'One contract per request, holds the USDC' },
        { title: 'Collect', sub: 'Merchant or any collector calls sweep()' },
        { title: 'Merchant', sub: 'Wallet or quantum-safe vault' },
      ] },
      { type: 'h3', text: 'Components' },
      { type: 'table', head: ['Layer', 'What it is', 'Runs where'], rows: [
        ['Web app', 'React 18 + Vite static site. wagmi/viem for chain reads and writes, ConnectKit for wallets', 'Vercel (any static host works)'],
        ['`SlotFactory`', 'Deploys one Slot per request at a predictable address, stores requests on-chain, keeps the collector leaderboard', 'Arc (and other chains for recovery)'],
        ['`Slot`', 'EIP-1167 clone that receives USDC and pays it out on `sweep()`', 'One per request'],
        ['`VaultFactory` / `SlotVault`', 'Optional payout vault that releases funds only with a post-quantum signature', 'Arc'],
        ['`ChainConfig`', 'Looks up each chain\'s USDC at runtime, so every contract has the same address on every chain', 'Library'],
        ['Circle App Kit', 'CCTP v2 burn on the source chain; the Forwarding Service mints into the Slot on Arc', 'Payer\'s browser + Circle'],
        ['Collector bot', 'Optional script that delivers paid requests for the reward', 'Anyone\'s machine'],
      ] },
      { type: 'h3', text: 'Design choices' },
      { type: 'list', items: [
        '**No backend.** Links are hash routes (`#/pay/<chainId>/<slot>`), and all state lives on-chain. The site can be served from any static host and still works if we disappear.',
        '**One address per request.** A Slot address commits to its creator, merchant and payment reference, so payments never mix and every payment is attributable.',
        '**Permissionless delivery.** Anyone can collect a paid Slot. The payout destination is fixed at creation, so the only choice a collector has is whether to do it.',
        '**Same address everywhere.** All contracts are deployed with CREATE2 using chain-agnostic init code, so a Slot\'s address exists on every chain. That is what makes [recovery](#/docs/recovery) possible.',
        '**USDC only.** Contracts use the 6-decimal ERC-20 interface exclusively and never read `msg.value`.',
      ] },
      { type: 'p', text: `Source: [${REPO.replace('https://', '')}](${REPO}).` },
    ],
  },
  {
    id: 'lifecycle',
    title: 'Life of a payment',
    group: 'How it works',
    summary: 'From createRequest to the merchant\'s wallet, step by step.',
    blocks: [
      { type: 'steps', items: [
        { title: 'Create', text: '`SlotFactory.createRequest` deploys a Slot clone at `predict(creator, merchant, payRef)` and records the amount, label (≤ 80 bytes) and optional expiry, attributed to the creator.' },
        { title: 'Pay', text: 'USDC is transferred to the Slot address. Payments can arrive in parts; the app sums them against the requested amount.' },
        { title: 'Collect', text: 'Anyone calls `sweep()` once the balance reaches `minSweep` (0.1 USDC on Arc). The Slot checks Circle\'s blocklist, splits any platform fee, refunds the collector\'s gas plus a tip, and sends the rest to the merchant.' },
        { title: 'Record', text: 'The Slot adds the amount to `totalCollected`, so the request still reads as paid after collection, on any device. Collections by non-merchants are counted on the public leaderboard.' },
      ] },
      { type: 'h3', text: 'Inside sweep()' },
      { type: 'code', lang: 'text', code: `gross  = USDC balance − held fees          (must be ≥ minSweep on Arc)
check  merchant on Circle's blocklist      (blocked → freeze, pay nobody)
fee    = gross × feeBps / 10 000           (held if the fee wallet is blocked)
reward = gas used × min(gasprice, basefee) + tip     (only for non-merchants)
         must be ≤ maxReimbursement and ≤ 10% of gross, else GasTooHigh
net    = gross − fee − reward              → merchant` },
      { type: 'note', tone: 'info', text: 'The merchant collecting their own Slot takes no reward and skips both caps, so a gas spike can never lock funds.' },
    ],
  },
  {
    id: 'fees',
    title: 'Fees and collectors',
    group: 'How it works',
    summary: 'Who pays what, and why anyone delivers your money for you.',
    blocks: [
      { type: 'table', head: ['Cost', 'Who pays', 'Typical'], rows: [
        ['Paying on Arc', 'Payer (network gas, in USDC)', 'Under a cent'],
        ['Collecting yourself', 'Merchant (network gas)', 'About half a cent (measured 0.0059 USDC)'],
        ['Collected by someone else', 'Taken from the payment: gas refund + 0.002 USDC tip', 'About a cent (measured 0.0087 USDC); never more than your cap or 10%'],
        ['Paying from another chain', 'Payer: source-chain gas + Circle\'s relayer fee', 'Shown before they confirm'],
        ['Platform fee', 'Optional, set by the creator', '0–10%'],
      ] },
      { type: 'h3', text: 'Collect-to-earn' },
      { type: 'p', text: 'Anyone can collect a paid request and earn its gas refund plus a 0.002 USDC tip. Gas is refunded at `min(tx.gasprice, block.basefee)`, so a collector can\'t inflate what you pay with a high priority fee. The reward is capped twice: by the Slot\'s `maxReimbursement` and by 10% of the payment. Above either cap, `sweep()` reverts until gas falls.' },
      { type: 'p', text: 'Collections are recorded on-chain and shown on the [collector leaderboard](#/collect). To run a collector yourself, see [Run a collector](#/docs/collector).' },
    ],
  },
  {
    id: 'cross-chain',
    title: 'Pay from another chain',
    group: 'How it works',
    summary: 'Circle CCTP and the Forwarding Service deliver USDC straight into the Slot.',
    blocks: [
      { type: 'p', text: 'On the payment page, **Another chain** lets the payer pay from Base, Ethereum, Arbitrum, OP Mainnet, Polygon or Avalanche (Base, Ethereum and Arbitrum Sepolia on testnet). Circle\'s App Kit burns USDC on the source chain over CCTP v2, and Circle\'s Forwarding Service mints it directly into the Slot on Arc. The payer needs no Arc wallet and no Arc gas.' },
      { type: 'steps', items: [
        { title: 'Quote', text: 'The app asks App Kit for a quote with `feePayment: \'source\'` (receive-exact): the Slot gets exactly the requested amount, and the payer sees the total and fee first. Quotes older than a minute are refreshed before paying.' },
        { title: 'Approve and burn', text: 'The payer\'s wallet approves and burns USDC on the source chain. The page shows "on its way" once the burn confirms.' },
        { title: 'Attest and mint', text: 'Circle attests the burn and the Forwarding Service mints into the Slot. The page watches the Slot\'s balance on Arc and confirms when it lands.' },
      ] },
      { type: 'note', tone: 'info', text: 'A payment that stops part-way resumes with App Kit\'s `retryBridge`; it is never re-sent from scratch.' },
      { type: 'h3', text: 'If it fails' },
      { type: 'list', items: [
        '**Not enough gas:** the payer needs the source chain\'s gas token (ETH, POL or AVAX).',
        '**Not enough USDC:** the error names the exact total needed, fee included.',
        '**Couldn\'t reach Circle:** usually an ad blocker or browser shields blocking Circle\'s API.',
        '**Quote expired:** review the new total and confirm again.',
      ] },
    ],
  },
  {
    id: 'recovery',
    title: 'Wrong-network recovery',
    group: 'How it works',
    summary: 'USDC sent to a Slot address on the wrong chain can be recovered.',
    blocks: [
      { type: 'p', text: 'Because every contract has the same address on every chain, a Slot\'s address also exists on Ethereum, Base and the rest. If a payer sends USDC there by mistake, it is not lost.' },
      { type: 'steps', items: [
        { title: 'Detect', text: 'Each request card checks its address on the other supported chains and shows, for example, "0.05 USDC was sent on Ethereum Sepolia by mistake".' },
        { title: 'Recover', text: '**Recover to my wallet** deploys the Slot on that chain with `SlotFactory.recoverSlot` (and the vault, for vault payouts) and collects it to you.' },
      ] },
      { type: 'list', items: [
        'Off Arc a Slot is recovery-only: no platform fee, no minimum, and no gas refund, so whoever deploys it first can\'t skim.',
        'Anyone may call `recoverSlot`, so recovery doesn\'t depend on the creator\'s key.',
        'You pay gas in that chain\'s native token.',
      ] },
    ],
  },
  {
    id: 'vault',
    title: 'Quantum-safe vault',
    group: 'How it works',
    summary: 'An optional payout vault that needs a post-quantum signature to release funds.',
    blocks: [
      { type: 'p', text: 'A `SlotVault` releases funds only with an SLH-DSA-SHA2-128s signature (FIPS 205), verified by Arc\'s post-quantum precompile at `0x1800…0004`, plus the owner wallet\'s signature in two-key mode. A stolen wallet key alone can\'t move the money.' },
      { type: 'list', items: [
        'The post-quantum key is generated in your browser, stored encrypted (PBKDF2 + AES-GCM), and backed up to a file that is checked on restore.',
        'Withdrawals are signed messages anyone can submit. The signer fixes the relayer fee; nonce, chain ID and vault address prevent replay.',
        'Lost key: the owner wallet can start a recovery that completes after 7 days. The post-quantum key can cancel it in the meantime.',
        'The vault address commits to the owner, key and settings, so nobody can pre-deploy "your" vault with their own key.',
        'A withdrawal costs about 460k gas (around one cent); signing takes about a second.',
      ] },
      { type: 'note', tone: 'warn', text: 'Keep the backup file. Without the post-quantum key, only the 7-day recovery can move funds.' },
    ],
  },
  {
    id: 'compliance',
    title: 'USDC compliance',
    group: 'How it works',
    summary: 'How Slots respect Circle\'s blocklist without letting anyone redirect funds.',
    blocks: [
      { type: 'list', items: [
        'The factory refuses to create a Slot that pays a blocklisted merchant or fee wallet.',
        'Before paying out, a Slot checks the merchant against Circle\'s blocklist. If the merchant is blocked, or the check fails, the Slot freezes: the funds stay put and nobody can redirect them. A later successful collection clears the freeze.',
        'A blocklisted fee wallet doesn\'t block the merchant. Its share is held in `heldFees` and paid out later with `releaseHeldFees()`.',
        'Non-USDC tokens sent to a Slot can only be rescued to the merchant (`rescueToken`).',
      ] },
    ],
  },

  // ── Reference ───────────────────────────────────────────────────────────────
  {
    id: 'contracts',
    title: 'Contracts and addresses',
    group: 'Reference',
    summary: `Deployed addresses for ${DOCS_VERSION}. Identical on every chain.`,
    blocks: [
      { type: 'p', text: 'All contracts are deployed through the standard CREATE2 deployer `0x4e59b44847b379578588920cA78FbF26c0B4956C`, so they have the same address on every chain. Live on Arc testnet and Ethereum Sepolia.' },
      { type: 'table', head: ['Contract', 'Address'], rows: [
        ['`SlotFactory`', `[\`${FACTORY}\`](${EXPLORER}${FACTORY})`],
        ['`Slot` (implementation)', `[\`${SLOT_IMPL}\`](${EXPLORER}${SLOT_IMPL})`],
        ['`VaultFactory`', `[\`${VAULT_FACTORY}\`](${EXPLORER}${VAULT_FACTORY})`],
        ['`SlotVault` (implementation)', `[\`${SLOT_VAULT_IMPL}\`](${EXPLORER}${SLOT_VAULT_IMPL})`],
        ['USDC on Arc', `\`${USDC_ADDRESS}\` (6 decimals; also the gas token)`],
      ] },
      { type: 'table', head: ['Network', 'Chain ID', 'RPC', 'Explorer'], rows: [
        ['Arc testnet', '`5042002`', '`https://rpc.testnet.arc.io`', '[explorer.testnet.arc.io](https://explorer.testnet.arc.io)'],
        ['Arc mainnet', '`5042`', '`https://rpc.mainnet.arc.io`', 'Not deployed yet'],
      ] },
      { type: 'p', text: 'Factory settings on Arc: `tip` = 2000 (0.002 USDC), `minSweep` = 100000 (0.1 USDC). Earlier factories are superseded; see `DEPLOYMENTS.md` in the repo.' },
    ],
  },
  {
    id: 'api',
    title: 'Contract API',
    group: 'Reference',
    summary: 'The functions integrators call.',
    blocks: [
      { type: 'h3', text: 'SlotFactory' },
      { type: 'code', lang: 'solidity', code: `function createRequest(
    address merchant, bytes32 payRef, uint16 feeBps, address feeRecipient,
    uint256 maxReimbursement, uint256 amount, string label, uint64 expiresAt
) returns (address slot);

function createSlot(address merchant, bytes32 payRef, uint16 feeBps,
    address feeRecipient, uint256 maxReimbursement) returns (address slot);

function predict(address creator, address merchant, bytes32 payRef) view returns (address);
function requestOf(address slot) view returns (Request memory);
function requestsOf(address creator, uint256 offset, uint256 limit) view returns (address[] memory);
function slotsPage(uint256 offset, uint256 limit) view returns (address[] memory);
function sweepMany(address[] slots);                       // try/catch per slot
function recoverSlot(address creator, address merchant, bytes32 payRef); // off Arc only` },
      { type: 'h3', text: 'Slot' },
      { type: 'code', lang: 'solidity', code: `function sweep();                    // collect; reward goes to msg.sender
function sweepFor(address rewardTo); // rewardTo must be msg.sender (or the factory's caller)
function balance() view returns (uint256);
function totalCollected() view returns (uint256);
function releaseHeldFees();
function rescueToken(address token); // non-USDC only, always to the merchant` },
      { type: 'h3', text: 'Errors worth handling' },
      { type: 'table', head: ['Error', 'Meaning'], rows: [
        ['`BelowMinSweep`', 'Balance is under `minSweep` (0.1 USDC on Arc)'],
        ['`GasTooHigh`', 'Reward would exceed `maxReimbursement` or 10% of the payment; retry later or collect as the merchant'],
        ['`NothingToSweep`', 'The Slot is empty'],
        ['`ReferenceAlreadyUsed`', 'This creator already used `payRef` for this merchant'],
        ['`BlacklistedPayout`', 'Merchant or fee wallet is on Circle\'s blocklist'],
        ['`FeeBpsTooHigh`', 'Fee above 1000 bps (10%)'],
      ] },
      { type: 'p', text: 'Generated ABIs live in `src/lib/abis.ts` (`bun run abis`).' },
    ],
  },
  {
    id: 'links',
    title: 'Payment links',
    group: 'Reference',
    summary: 'The link format and app routes.',
    blocks: [
      { type: 'code', lang: 'text', code: `https://arc-slot-three.vercel.app/#/pay/<chainId>/<slot>

#/            landing page
#/app         merchant dashboard
#/pay/...     payment page
#/collect     collector leaderboard
#/docs        these docs` },
      { type: 'p', text: 'Links are hash routes, so they work on any static host without server rewrites. The page reads the amount, label, payee and expiry from `SlotFactory.requestOf(slot)`; anything else in the link is ignored for verified requests. An unknown chain or malformed address shows "This payment link is not valid".' },
      { type: 'p', text: 'To build a link yourself, call `predict` with your address, the merchant and a fresh 32-byte `payRef`, create the request, then share `#/pay/5042002/<slot>`.' },
    ],
  },
  {
    id: 'collector',
    title: 'Run a collector',
    group: 'Reference',
    summary: 'Earn the tip by delivering paid requests.',
    blocks: [
      { type: 'p', text: 'The collector bot pages through every Slot with `SlotFactory.slotsPage` (plain view calls; Arc\'s RPC rejects large log ranges), simulates `sweepFor(itself)`, and collects when the reward beats its priority fee.' },
      { type: 'code', lang: 'bash', code: `git clone ${REPO} && cd ArcSlot && bun install
echo 'COLLECTOR_PRIVATE_KEY=0x…' >> .env   # a dedicated wallet with a little USDC for gas
bun run collect          # loop
bun run collect --once   # single pass
NETWORK=mainnet bun run collect` },
      { type: 'note', tone: 'warn', text: 'Use a fresh wallet holding only gas money. Never put a key with real savings in a bot.' },
    ],
  },
  {
    id: 'develop',
    title: 'Run it locally',
    group: 'Reference',
    summary: 'Build the app and contracts from source.',
    blocks: [
      { type: 'p', text: 'Needs [Bun](https://bun.sh) 1.x, [Foundry](https://getfoundry.sh) and Node 20+. Arc fork tests need [Arc Foundry](https://docs.arc.io/arc/tutorials/install-arc-foundry.md) (`arc-forge`), because stock Foundry can\'t run Arc\'s native-coin precompile.' },
      { type: 'code', lang: 'bash', code: `bun install
bun run dev              # http://localhost:5173
bun run build            # production build → dist/
bun run abis             # regenerate ABIs after a contract change` },
      { type: 'h3', text: 'Project layout' },
      { type: 'code', lang: 'text', code: `contracts/            Slot, SlotFactory, SlotVault, VaultFactory, ChainConfig
  test/               unit + fuzz tests (mock USDC, mock PQ precompile)
  test-integration/   Arc fork tests (arc-forge)
  test-stress/        1,000-actor invariant suite
scripts/              deploy, collector bot, browser E2E
src/components/       pages and UI
src/lib/              chain config, request logic, cross-chain, recovery, vault keys
src/content/docs.ts   this documentation` },
      { type: 'p', text: 'The frontend needs no environment variables: it reads chain state over public RPC. Deploy contracts to any chain with `RPC=… bun run deploy:deterministic` (idempotent; reads `PRIVATE_KEY` from `.env`).' },
    ],
  },
  {
    id: 'testing',
    title: 'Testing',
    group: 'Reference',
    summary: 'Unit, fork, stress and live end-to-end tests.',
    blocks: [
      { type: 'table', head: ['Command', 'What it covers'], rows: [
        ['`bun run contracts:test`', '169 Foundry unit + fuzz tests'],
        ['`bun run contracts:test:fork`', '21 fork tests on Arc mainnet state: real USDC, blocklist, PQ precompile with real SLH-DSA signatures, and a two-chain recovery test'],
        ['`bun run contracts:test:stress`', '1,000-actor invariant suite and a 20,000-action simulation'],
        ['`bun run test`', '300+ Vitest unit and component tests'],
        ['`bun run test:all`', 'All of the above (except stress) plus typecheck and build'],
        ['`bun run test:e2e:ui`', 'Live testnet: create, pay and collect through the real UI'],
        ['`bun run test:e2e:crosschain`', 'Live: pay a Slot from Ethereum Sepolia via CCTP'],
        ['`bun run test:e2e:recovery`', 'Live: recover USDC sent on Sepolia by mistake'],
      ] },
      { type: 'p', text: 'GitHub Actions runs the unit and frontend suites on every push to `main`.' },
    ],
  },
  {
    id: 'security',
    title: 'Security and audits',
    group: 'Reference',
    summary: 'What has been reviewed, and what hasn\'t yet.',
    blocks: [
      { type: 'list', items: [
        'Two security audits run in Arc Studio (`AUDIT.md`, `AUDIT-v6.md`) and an independent white-hat review (`SECURITY-REVIEW.md`). Every finding is fixed or documented.',
        'Contracts use OpenZeppelin 5 (Clones, ReentrancyGuard, SafeERC20), checks-effects-interactions, and no `selfdestruct`.',
        'The site ships with a strict Content-Security-Policy, `X-Frame-Options: DENY` and no third-party scripts beyond wallet connectors.',
      ] },
      { type: 'note', tone: 'warn', text: 'There is no third-party audit yet. ArcSlot is on testnet; don\'t use it for real funds until it is audited and deployed to mainnet.' },
      { type: 'p', text: `Found a problem? Open an issue at [${REPO.replace('https://', '')}](${REPO}/issues).` },
    ],
  },
]

export function docById(id: string | undefined): DocSection {
  return DOCS.find((d) => d.id === id) ?? DOCS[0]
}
