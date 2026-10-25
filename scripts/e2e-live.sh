#!/usr/bin/env bash
# Live end-to-end check against a deployed SlotFactory:
#   predict -> createSlot -> pay -> stranger sweep -> assert receipt + balances.
# Signs with PRIVATE_KEY from .env (the sweeper). The merchant is a separate
# address so the sweep exercises the stranger-reimbursement path.
#
#   RPC=https://rpc.testnet.arc.io FACTORY=0x... MERCHANT=0x... [AMOUNT=150000] bash scripts/e2e-live.sh
set -euo pipefail
: "${RPC:?set RPC}" "${FACTORY:?set FACTORY}" "${MERCHANT:?set MERCHANT}"
AMOUNT="${AMOUNT:-150000}"   # 0.15 USDC (6-dec)
CAST="${CAST:-arc-cast}"
USDC=0x3600000000000000000000000000000000000000
PK="0x$(grep '^PRIVATE_KEY=' .env | cut -d= -f2- | sed 's/^0x//')"
ME=$($CAST wallet address --private-key "$PK")
REF=$($CAST keccak "e2e-$(date +%s)")
bal() { $CAST call $USDC 'balanceOf(address)(uint256)' "$1" --rpc-url "$RPC" | awk '{print $1}'; }
send() { $CAST send --rpc-url "$RPC" --private-key "$PK" --json "$@"; }
fail() { echo "FAIL: $*" >&2; exit 1; }

echo "chain     $($CAST chain-id --rpc-url "$RPC")"
echo "sweeper   $ME"
echo "merchant  $MERCHANT"
[ "$(echo "$ME" | tr A-F a-f)" != "$(echo "$MERCHANT" | tr A-F a-f)" ] || fail "merchant must differ from sweeper"

PRED=$($CAST call "$FACTORY" 'predict(address,address,bytes32)(address)' "$ME" "$MERCHANT" "$REF" --rpc-url "$RPC")
echo "predicted $PRED"

TX1=$(send "$FACTORY" 'createSlot(address,bytes32,uint16,address,uint256)' "$MERCHANT" "$REF" 0 0x0000000000000000000000000000000000000000 50000 | jq -r .transactionHash)
echo "create    $TX1"
[ "$($CAST call "$FACTORY" 'isSlot(address)(bool)' "$PRED" --rpc-url "$RPC")" = "true" ] || fail "no slot deployed at predicted $PRED"
SLOT=$PRED

TX2=$(send $USDC 'transfer(address,uint256)' "$SLOT" "$AMOUNT" | jq -r .transactionHash)
echo "pay       $TX2"
[ "$(bal "$SLOT")" = "$AMOUNT" ] || fail "slot balance $(bal "$SLOT") != $AMOUNT"

M0=$(bal "$MERCHANT")
# A rational sweeper pays a normal priority fee; TIP covers it.
OUT=$(send "$SLOT" 'sweep()' --priority-gas-price "${PRIORITY:-1gwei}")
TX3=$(echo "$OUT" | jq -r .transactionHash)
GAS=$(echo "$OUT" | jq -r .gasUsed | xargs printf '%d')
PRICE=$(echo "$OUT" | jq -r .effectiveGasPrice | xargs printf '%d')
echo "sweep     $TX3  (gas $GAS @ $PRICE wei)"

[ "$(bal "$SLOT")" = "0" ] || fail "slot not drained"
NET=$(( $(bal "$MERCHANT") - M0 ))
REIMB=$(( AMOUNT - NET ))
COST6=$(( GAS * PRICE / 1000000000000 ))
echo "merchant  +$NET"
echo "sweeper   reimbursed $REIMB vs gas cost $COST6 (6-dec USDC)"
[ "$REIMB" -le 50000 ] || fail "reimbursement over cap"
[ "$REIMB" -gt "$COST6" ] || fail "sweeper not net positive"
echo "PASS  slot=$SLOT"
