#!/usr/bin/env bash
set -uo pipefail

BASE_SMART_METER="${SMART_METER_URL:-http://localhost:3001}"
BASE_PRICING="${PRICING_URL:-http://localhost:3002}"
BASE_MATCHING="${MATCHING_URL:-http://localhost:3003}"
BASE_BILLING="${BILLING_URL:-http://localhost:3004}"

if command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN="python3"
elif command -v python >/dev/null 2>&1; then
  PYTHON_BIN="python"
else
  echo "ERROR: python3 or python is required for JSON checks."
  exit 1
fi

RUN_ID="${DEMO_RUN_ID:-$(date +%Y%m%d%H%M%S)-$RANDOM}"
SELLER_ID="HH-SELLER-${RUN_ID}"
BUYER_ID="HH-BUYER-${RUN_ID}"
IDEM_SELLER_ID="HH-IDEM-SELLER-${RUN_ID}"
IDEM_BUYER_ID="HH-IDEM-BUYER-${RUN_ID}"
CORRELATION_ID="demo-${RUN_ID}"

# The tokens the stack was started with: from the environment when set there,
# otherwise from infrastructure/.env (created by `pnpm env:init`). They are
# sent with requests and never printed.
ENV_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/infrastructure/.env"
env_file_value() {
  [ -f "$ENV_FILE" ] || return 0
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1 | tr -d '\r'
}
OPERATOR_TOKEN="${OPERATOR_API_TOKEN:-$(env_file_value OPERATOR_API_TOKEN)}"
INTERNAL_TOKEN="${INTERNAL_API_TOKEN:-$(env_file_value INTERNAL_API_TOKEN)}"
if [ -z "$OPERATOR_TOKEN" ] || [ -z "$INTERNAL_TOKEN" ]; then
  echo "ERROR: OPERATOR_API_TOKEN and INTERNAL_API_TOKEN are neither set nor in $ENV_FILE."
  echo "Run 'pnpm env:init' before starting the stack."
  exit 1
fi

PASS_COUNT=0
FAIL_COUNT=0

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  echo "PASS: $1"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  echo "FAIL: $1"
}

request() {
  local method="$1"
  local url="$2"
  local body="${3:-}"
  if [ -n "$body" ]; then
    curl -fsS -X "$method" "$url" \
      -H "Content-Type: application/json" \
      -H "x-correlation-id: $CORRELATION_ID" \
      -d "$body"
  else
    curl -fsS -X "$method" "$url" \
      -H "x-correlation-id: $CORRELATION_ID"
  fi
}

# request_as TOKEN METHOD URL [BODY] - like request, with a bearer token
request_as() {
  local token="$1"
  shift
  local method="$1"
  local url="$2"
  local body="${3:-}"
  if [ -n "$body" ]; then
    curl -fsS -X "$method" "$url" \
      -H "Content-Type: application/json" \
      -H "x-correlation-id: $CORRELATION_ID" \
      -H "Authorization: Bearer $token" \
      -d "$body"
  else
    curl -fsS -X "$method" "$url" \
      -H "x-correlation-id: $CORRELATION_ID" \
      -H "Authorization: Bearer $token"
  fi
}

# status_of [TOKEN|-] METHOD URL [BODY] - prints only the HTTP status code
status_of() {
  local token="$1"
  shift
  local method="$1"
  local url="$2"
  local body="${3:-}"
  local auth=()
  if [ "$token" != "-" ]; then auth=(-H "Authorization: Bearer $token"); fi
  if [ -n "$body" ]; then
    curl -sS -o /dev/null -w '%{http_code}' -X "$method" "$url" "${auth[@]}" \
      -H "Content-Type: application/json" -d "$body"
  else
    curl -sS -o /dev/null -w '%{http_code}' -X "$method" "$url" "${auth[@]}"
  fi
}

json_value() {
  "$PYTHON_BIN" -c 'import json, sys; data=json.load(sys.stdin); print(data.get(sys.argv[1], ""))' "$1"
}

json_filter_match() {
  SELLER="$SELLER_ID" BUYER="$BUYER_ID" "$PYTHON_BIN" -c '
import json, os, sys
data = json.load(sys.stdin)
for item in data.get("items", []):
    if item.get("sellerHouseholdId") == os.environ["SELLER"] and item.get("buyerHouseholdId") == os.environ["BUYER"]:
        print(json.dumps(item))
        sys.exit(0)
sys.exit(1)
'
}

json_has_ledger_entry() {
  local expected_type="$1"
  "$PYTHON_BIN" -c '
import json, sys
entries = json.load(sys.stdin)["items"]
expected = sys.argv[1]
sys.exit(0 if any(entry.get("entryType") == expected for entry in entries) else 1)
' "$expected_type"
}

echo "Solar Grid End-to-End Demo"
echo "Run ID: $RUN_ID"
echo "Smart Meter: $BASE_SMART_METER"
echo "Pricing:     $BASE_PRICING"
echo "Matching:    $BASE_MATCHING"
echo "Billing:     $BASE_BILLING"
echo

echo "1. Readiness checks"
for pair in \
  "smart-meter|$BASE_SMART_METER/health/ready" \
  "pricing|$BASE_PRICING/health/ready" \
  "trade-matching|$BASE_MATCHING/health/ready" \
  "billing-ledger|$BASE_BILLING/health/ready"; do
  name="${pair%%|*}"
  url="${pair#*|}"
  if response="$(request GET "$url" 2>/dev/null)" && [ "$(printf '%s' "$response" | json_value status)" = "ready" ]; then
    pass "$name ready"
  else
    fail "$name ready"
  fi
done
echo

echo "2. Current price"
if price_response="$(request GET "$BASE_PRICING/prices/current" 2>/dev/null)"; then
  price="$(printf '%s' "$price_response" | json_value pricePerKwh)"
  currency="$(printf '%s' "$price_response" | json_value currency)"
  echo "Current price: $price $currency/kWh"
  pass "current price available"
else
  fail "current price available"
fi
echo

echo "3. Seller reading"
seller_body="{\"householdId\":\"$SELLER_ID\",\"productionKwh\":10,\"consumptionKwh\":3,\"timestamp\":\"2026-05-27T10:00:00.000Z\"}"
if seller_response="$(request POST "$BASE_SMART_METER/readings" "$seller_body" 2>/dev/null)"; then
  seller_status="$(printf '%s' "$seller_response" | json_value status)"
  seller_surplus="$(printf '%s' "$seller_response" | json_value surplusKwh)"
  echo "Seller: $SELLER_ID status=$seller_status surplusKwh=$seller_surplus"
  [ "$seller_status" = "SURPLUS" ] && pass "seller surplus reading" || fail "seller surplus reading"
else
  fail "seller surplus reading"
fi
echo

echo "4. Buyer reading"
buyer_body="{\"householdId\":\"$BUYER_ID\",\"productionKwh\":1,\"consumptionKwh\":5,\"timestamp\":\"2026-05-27T10:01:00.000Z\"}"
if buyer_response="$(request POST "$BASE_SMART_METER/readings" "$buyer_body" 2>/dev/null)"; then
  buyer_status="$(printf '%s' "$buyer_response" | json_value status)"
  buyer_demand="$(printf '%s' "$buyer_response" | json_value demandKwh)"
  echo "Buyer: $BUYER_ID status=$buyer_status demandKwh=$buyer_demand"
  [ "$buyer_status" = "DEMAND" ] && pass "buyer demand reading" || fail "buyer demand reading"
else
  fail "buyer demand reading"
fi
echo

echo "5. Waiting for match"
MATCH_JSON=""
for _ in $(seq 1 20); do
  matches_response="$(request GET "$BASE_MATCHING/matches?correlationId=$CORRELATION_ID" 2>/dev/null || true)"
  if [ -n "$matches_response" ] && MATCH_JSON="$(printf '%s' "$matches_response" | json_filter_match 2>/dev/null)"; then
    break
  fi
  sleep 1
done

if [ -n "$MATCH_JSON" ]; then
  trade_id="$(printf '%s' "$MATCH_JSON" | json_value tradeId)"
  match_status="$(printf '%s' "$MATCH_JSON" | json_value status)"
  energy_kwh="$(printf '%s' "$MATCH_JSON" | json_value energyKwh)"
  echo "Match: tradeId=$trade_id status=$match_status energyKwh=$energy_kwh"
  [ "$match_status" = "COMPLETED" ] && pass "completed match created" || fail "completed match created"
else
  fail "completed match created"
fi
echo

echo "6. Balances"
if seller_balance_response="$(request GET "$BASE_BILLING/balances/$SELLER_ID" 2>/dev/null)"; then
  seller_balance="$(printf '%s' "$seller_balance_response" | json_value balance)"
  echo "Seller balance: $seller_balance"
  BALANCE="$seller_balance" "$PYTHON_BIN" -c 'import os, sys; sys.exit(0 if float(os.environ["BALANCE"]) > 0 else 1)' \
    && pass "seller balance positive" || fail "seller balance positive"
else
  fail "seller balance positive"
fi

if buyer_balance_response="$(request GET "$BASE_BILLING/balances/$BUYER_ID" 2>/dev/null)"; then
  buyer_balance="$(printf '%s' "$buyer_balance_response" | json_value balance)"
  echo "Buyer balance: $buyer_balance"
  BALANCE="$buyer_balance" "$PYTHON_BIN" -c 'import os, sys; sys.exit(0 if float(os.environ["BALANCE"]) < 0 else 1)' \
    && pass "buyer balance negative" || fail "buyer balance negative"
else
  fail "buyer balance negative"
fi
echo

echo "7. Ledger entries"
if seller_ledger="$(request GET "$BASE_BILLING/ledger/$SELLER_ID" 2>/dev/null)" && printf '%s' "$seller_ledger" | json_has_ledger_entry CREDIT; then
  pass "seller CREDIT ledger entry visible"
else
  fail "seller CREDIT ledger entry visible"
fi

if buyer_ledger="$(request GET "$BASE_BILLING/ledger/$BUYER_ID" 2>/dev/null)" && printf '%s' "$buyer_ledger" | json_has_ledger_entry DEBIT; then
  pass "buyer DEBIT ledger entry visible"
else
  fail "buyer DEBIT ledger entry visible"
fi
echo

echo "8. Billing idempotency"
idem_key="demo-idem-${RUN_ID}"
idem_trade_id="TRD-DEMO-${RUN_ID}"
# Money and energy cross this boundary as decimal strings, not JSON numbers.
idem_body="{\"tradeId\":\"$idem_trade_id\",\"sellerHouseholdId\":\"$IDEM_SELLER_ID\",\"buyerHouseholdId\":\"$IDEM_BUYER_ID\",\"energyKwh\":\"2.000\",\"pricePerKwh\":\"4.0000\",\"totalAmount\":\"8.00\",\"currency\":\"TRY\",\"idempotencyKey\":\"$idem_key\",\"correlationId\":\"$CORRELATION_ID\",\"completedAt\":\"2026-05-27T10:20:00.000Z\"}"
first_idem="$(request_as "$INTERNAL_TOKEN" POST "$BASE_BILLING/trades" "$idem_body" 2>/dev/null || true)"
second_idem="$(request_as "$INTERNAL_TOKEN" POST "$BASE_BILLING/trades" "$idem_body" 2>/dev/null || true)"
duplicate="$(printf '%s' "$second_idem" | json_value duplicate 2>/dev/null || true)"
echo "Duplicate response: $duplicate"
[ "$duplicate" = "True" ] || [ "$duplicate" = "true" ] && pass "duplicate idempotency check" || fail "duplicate idempotency check"
echo

echo "9. Decimal contract"
balance_raw="$(request GET "$BASE_BILLING/balances/$SELLER_ID" 2>/dev/null | "$PYTHON_BIN" -c 'import json,sys; print(json.load(sys.stdin)["balance"])')"
price_raw="$(request GET "$BASE_PRICING/prices/current" 2>/dev/null | "$PYTHON_BIN" -c 'import json,sys; print(json.load(sys.stdin)["pricePerKwh"])')"
echo "Balance as returned: $balance_raw | price as returned: $price_raw"
if printf '%s' "$balance_raw" | grep -qE '^-?[0-9]+\.[0-9]{2}$' && printf '%s' "$price_raw" | grep -qE '^[0-9]+\.[0-9]{4}$'; then
  pass "money and price returned as fixed-scale decimal strings"
else
  fail "money and price returned as fixed-scale decimal strings"
fi
echo

echo "10. Security and API contract"
check_status() {
  local label="$1" expected="$2" actual="$3"
  echo "$label -> $actual (expected $expected)"
  [ "$actual" = "$expected" ] && pass "$label" || fail "$label"
}

check_status "matching run without a token is refused" 401 \
  "$(status_of - POST "$BASE_MATCHING/matching/run")"
check_status "matching run with the service token is forbidden" 403 \
  "$(status_of "$INTERNAL_TOKEN" POST "$BASE_MATCHING/matching/run")"
check_status "matching run with the operator token is allowed" 200 \
  "$(status_of "$OPERATOR_TOKEN" POST "$BASE_MATCHING/matching/run")"
check_status "recording a trade without a token is refused" 401 \
  "$(status_of - POST "$BASE_BILLING/trades" "$idem_body")"
check_status "an oversized page is rejected" 400 \
  "$(status_of - GET "$BASE_MATCHING/matches?limit=100000")"

conflict_body="${idem_body/\"energyKwh\":\"2.000\"/\"energyKwh\":\"3.000\"}"
conflict_body="${conflict_body/\"totalAmount\":\"8.00\"/\"totalAmount\":\"12.00\"}"
check_status "the same idempotency key with a different payload is a conflict" 409 \
  "$(status_of "$INTERNAL_TOKEN" POST "$BASE_BILLING/trades" "$conflict_body")"

error_body="$(curl -sS -X POST "$BASE_MATCHING/matching/run" -H "x-correlation-id: $CORRELATION_ID")"
if ERROR_BODY="$error_body" CID="$CORRELATION_ID" "$PYTHON_BIN" -c '
import json, os, sys
body = json.loads(os.environ["ERROR_BODY"])
ok = body.get("code") == "UNAUTHENTICATED" and body.get("correlationId") == os.environ["CID"] and "stack" not in body
sys.exit(0 if ok else 1)
'; then
  pass "error responses carry a code and the correlation id, and no stack trace"
else
  fail "error responses carry a code and the correlation id, and no stack trace"
fi
echo

echo "Summary: $PASS_COUNT passed, $FAIL_COUNT failed"
if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
exit 0
