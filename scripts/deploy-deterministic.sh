#!/usr/bin/env bash
# Deploy Slot, SlotFactory, SlotVault, VaultFactory at the SAME addresses on any
# chain via the standard CREATE2 deployer. Idempotent: skips what already exists.
#
# Uses explicit gas limits because Foundry's estimates undershoot on chains
# with newer state-creation pricing (seen live on Ethereum Sepolia: ~1,600 gas
# per byte of code). You only pay for gas actually used.
#
#   RPC=https://... PRIVATE_KEY=0x... [GAS_PRICE=25gwei PRIORITY=1gwei] bash scripts/deploy-deterministic.sh
# On Arc pass GAS_PRICE (e.g. 25gwei): the 16M limit is reserved upfront at that price.
set -euo pipefail
: "${RPC:?set RPC}" "${PRIVATE_KEY:?set PRIVATE_KEY}"
CAST="${CAST:-cast}"; FORGE="${FORGE:-forge}"
D=0x4e59b44847b379578588920cA78FbF26c0B4956C
TIP=2000; MIN_SWEEP=100000
PRICE_FLAGS=()
[ -n "${GAS_PRICE:-}" ] && PRICE_FLAGS+=(--gas-price "$GAS_PRICE")
[ -n "${PRIORITY:-}" ] && PRICE_FLAGS+=(--priority-gas-price "$PRIORITY")
has_code() { for _ in 1 2 3 4 5 6 7 8 9 10; do [ "$($CAST code "$1" --rpc-url "$RPC")" != "0x" ] && return 0; sleep 3; done; return 1; }
[ "$($CAST code $D --rpc-url "$RPC")" != "0x" ] || { echo "CREATE2 deployer missing on this chain"; exit 1; }

addr_of() { $CAST create2 --deployer $D --salt "$($CAST keccak "arc-slot.v5.$1")" --init-code "$2" | tail -1 | awk '{print $NF}'; }
deploy() {
  local name=$1 init=$2 salt addr
  salt=$($CAST keccak "arc-slot.v5.$name"); addr=$(addr_of "$name" "$init")
  if [ "$($CAST code "$addr" --rpc-url "$RPC")" != "0x" ]; then echo "$name $addr (exists)"; echo "$addr"; return; fi
  $CAST send $D "$($CAST concat-hex "$salt" "$init")" --gas-limit 16000000 ${PRICE_FLAGS[@]+"${PRICE_FLAGS[@]}"} --private-key "$PRIVATE_KEY" --rpc-url "$RPC" --json \
    | jq -r --arg n "$name" --arg a "$addr" '"\($n) \($a) status=\(.status) gasUsed=\(.gasUsed)"' >&2
  has_code "$addr" || { echo "deploy failed: $name" >&2; exit 1; }
}

$FORGE build >/dev/null
SLOT_INIT=$($FORGE inspect Slot bytecode)
SLOT_IMPL=$(addr_of Slot "$SLOT_INIT"); deploy Slot "$SLOT_INIT"
FACTORY_INIT=$($CAST concat-hex "$($FORGE inspect SlotFactory bytecode)" "$($CAST abi-encode 'f(address,uint256,uint256)' "$SLOT_IMPL" $TIP $MIN_SWEEP)")
deploy SlotFactory "$FACTORY_INIT"
VAULT_INIT=$($FORGE inspect SlotVault bytecode)
VAULT_IMPL=$(addr_of SlotVault "$VAULT_INIT"); deploy SlotVault "$VAULT_INIT"
deploy VaultFactory "$($CAST concat-hex "$($FORGE inspect VaultFactory bytecode)" "$($CAST abi-encode 'f(address)' "$VAULT_IMPL")")"

echo "chainId      $($CAST chain-id --rpc-url "$RPC")"
echo "SlotFactory  $(addr_of SlotFactory "$FACTORY_INIT")  usdc=$($CAST call "$(addr_of SlotFactory "$FACTORY_INIT")" 'usdc()(address)' --rpc-url "$RPC")"
