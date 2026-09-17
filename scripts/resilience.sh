#!/usr/bin/env bash
# Solar Grid resilience check, against the running Docker stack.
#
# Stops and starts real containers - a database, the broker, pricing, billing,
# trade-matching - and checks that each outage is reported, handled without
# losing or duplicating money, and recovered from. It changes the state of the
# stack it runs against: use it on a local stack, never on one you care about.
#
#   docker compose -f infrastructure/docker-compose.yml up -d --build --wait
#   bash scripts/resilience.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/infrastructure/.env"
SMART_METER="${SMART_METER_URL:-http://localhost:3001}"
PRICING="${PRICING_URL:-http://localhost:3002}"
MATCHING="${MATCHING_URL:-http://localhost:3003}"
BILLING="${BILLING_URL:-http://localhost:3004}"

PYTHON_BIN="$(command -v python3 || command -v python)"
[ -n "$PYTHON_BIN" ] || { echo "ERROR: python3 or python is required."; exit 1; }

env_value() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1 | tr -d '\r'; }
OPERATOR_TOKEN="${OPERATOR_API_TOKEN:-$(env_value OPERATOR_API_TOKEN)}"
METRICS_TOKEN="${METRICS_TOKEN:-$(env_value METRICS_TOKEN)}"
[ -n "$OPERATOR_TOKEN" ] && [ -n "$METRICS_TOKEN" ] || {
  echo "ERROR: tokens not found; run 'pnpm env:init' and start the stack first."
  exit 1
}

RUN="$(date +%s)"
PASS_COUNT=0
FAIL_COUNT=0
pass() { PASS_COUNT=$((PASS_COUNT + 1)); echo "PASS: $1"; }
fail() { FAIL_COUNT=$((FAIL_COUNT + 1)); echo "FAIL: $1"; }
check() { if eval "$2"; then pass "$1"; else fail "$1"; fi; }

status_of() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
body_of() { curl -s "$@"; }
json() { "$PYTHON_BIN" -c "import json,sys; data=json.load(sys.stdin); print($1)" 2>/dev/null; }

# wait_for SECONDS DESCRIPTION COMMAND...: true once COMMAND succeeds.
wait_for() {
  local seconds="$1" what="$2"
  shift 2
  local deadline=$(( $(date +%s) + seconds ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if "$@" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "  (gave up after ${seconds}s waiting for $what)"
  return 1
}

ready() { [ "$(status_of "$1/health/ready")" = "200" ]; }
not_ready() { [ "$(status_of "$1/health/ready")" = "503" ]; }
dlq_depth() {
  docker exec solar-grid-rabbitmq rabbitmqctl -q list_queues name messages 2>/dev/null \
    | awk '$1=="trade-matching.energy.dlq"{print $2}'
}

# reading HOUSEHOLD PRODUCTION CONSUMPTION CORRELATION_ID -> HTTP status
reading() {
  status_of -X POST "$SMART_METER/readings" -H 'Content-Type: application/json' \
    -H "x-correlation-id: $4" \
    -d "{\"householdId\":\"$1\",\"productionKwh\":$2,\"consumptionKwh\":$3,\"timestamp\":\"2026-05-27T12:00:00.000Z\"}"
}

# pair NAME -> posts a 4 kWh seller and a 4 kWh buyer; the buyer's id is cid-NAME-buyer
pair() {
  reading "HH-$1-SELLER-$RUN" 4 0 "cid-$1-seller-$RUN" >/dev/null
  reading "HH-$1-BUYER-$RUN" 0 4 "cid-$1-buyer-$RUN"
}

request_status() {
  body_of "$MATCHING/requests?correlationId=$1" | json 'data["items"][0]["status"] if data["items"] else ""'
}
match_status() {
  body_of "$MATCHING/matches?correlationId=$1" | json 'data["items"][0]["status"] if data["items"] else ""'
}
matches_for() { body_of "$MATCHING/matches?correlationId=$1" | json 'data["total"]'; }
billed_for() { body_of "$BILLING/trades?correlationId=$1" | json 'data["total"]'; }
# Predicates for wait_for: it re-runs the command, so each value must be read
# inside the function rather than substituted into its arguments once.
request_is() { [ "$(request_status "$1")" = "$2" ]; }
match_is() { [ "$(match_status "$1")" = "$2" ]; }
billed_is() { [ "$(billed_for "$1")" = "$2" ]; }
dlq_grew() { [ "$(dlq_depth)" -gt "${dlq_before:-0}" ] 2>/dev/null; }

operator_run() {
  status_of -X POST "$MATCHING/matching/run" -H "Authorization: Bearer $OPERATOR_TOKEN" \
    -H "x-correlation-id: $1"
}
logs_since() { docker logs --since "$1" "$2" 2>&1; }

echo "Solar Grid resilience check (run $RUN)"
echo

echo "0. Everything ready"
for url in "$SMART_METER" "$PRICING" "$MATCHING" "$BILLING"; do
  check "$url ready" "ready $url"
done
echo

echo "1. PostgreSQL outage (billing's database)"
since="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
docker stop solar-grid-postgres-ledger >/dev/null
wait_for 20 "billing to notice" not_ready "$BILLING"
check "billing stays live" '[ "$(status_of "$BILLING/health/live")" = "200" ]'
check "billing reports not ready" 'not_ready "$BILLING"'
outage_body="$(body_of -H "x-correlation-id: cid-db-$RUN" "$BILLING/balances/HH-ANY")"
check "a read answers 503 DOWNSTREAM_UNAVAILABLE" \
  '[ "$(printf "%s" "$outage_body" | json "data[\"code\"]")" = "DOWNSTREAM_UNAVAILABLE" ]'
check "the answer says nothing about the database" \
  '! printf "%s" "$outage_body" | grep -qiE "postgres|prisma|5432|solargrid_app"'
docker start solar-grid-postgres-ledger >/dev/null
check "billing is ready again" 'wait_for 90 "billing" ready "$BILLING"'
check "the log names the dependency and the request" \
  'logs_since "$since" solar-grid-billing-ledger | grep "cid-db-$RUN" | grep -q "\"dependency\":\"database\""'
echo

echo "2. RabbitMQ outage"
docker stop solar-grid-rabbitmq >/dev/null
wait_for 45 "trade-matching to notice" not_ready "$MATCHING"
check "trade-matching reports not ready" 'not_ready "$MATCHING"'
check "smart-meter stays ready" 'ready "$SMART_METER"'
check "readings are still accepted" '[ "$(pair broker)" = "201" ]'
docker start solar-grid-rabbitmq >/dev/null
check "trade-matching is ready again" 'wait_for 120 "trade-matching" ready "$MATCHING"'
check "the events queued during the outage are matched" \
  'wait_for 90 "the trade" request_is "cid-broker-buyer-$RUN" MATCHED'
check "and billed once" 'wait_for 30 "billing" billed_is "cid-broker-buyer-$RUN" 1'
echo

echo "3. Pricing outage: retries, dead letter queue, recovery"
dlq_before="$(dlq_depth)"
since="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
docker stop solar-grid-pricing-engine >/dev/null
pair pricing >/dev/null
check "the event is parked after its retries" \
  'wait_for 90 "the dead letter queue" dlq_grew'
retries="$(logs_since "$since" solar-grid-trade-matching | grep "cid-pricing-buyer-$RUN" | grep -c '"event":"message.retry.scheduled"')"
check "three retries were scheduled" '[ "$retries" = "3" ]'
check "nothing was reserved" '[ "$(matches_for "cid-pricing-buyer-$RUN")" = "0" ]'
check "an operator run answers 503" '[ "$(operator_run "cid-pricing-run-$RUN")" = "503" ]'
docker start solar-grid-pricing-engine >/dev/null
wait_for 90 "pricing" ready "$PRICING"
check "the next run matches the waiting request" \
  '[ "$(operator_run "cid-pricing-recovery-$RUN")" = "200" ] && [ "$(request_status "cid-pricing-buyer-$RUN")" = MATCHED ]'
echo

echo "4. Billing outage"
docker stop solar-grid-billing-ledger >/dev/null
pair billing >/dev/null
check "the trade stays reserved" \
  'wait_for 60 "the reservation" match_is "cid-billing-buyer-$RUN" PENDING_BILLING'
docker start solar-grid-billing-ledger >/dev/null
wait_for 90 "billing" ready "$BILLING"
operator_run "cid-billing-recovery-$RUN" >/dev/null
check "the next run completes it" '[ "$(match_status "cid-billing-buyer-$RUN")" = COMPLETED ]'
check "billing recorded it once" '[ "$(billed_for "cid-billing-buyer-$RUN")" = 1 ]'
echo

echo "5. trade-matching restarted mid-flow"
pair restart >/dev/null
docker restart solar-grid-trade-matching >/dev/null
wait_for 90 "trade-matching" ready "$MATCHING"
check "the trade completes after the restart" \
  'wait_for 90 "the trade" match_is "cid-restart-buyer-$RUN" COMPLETED'
check "exactly one trade" '[ "$(matches_for "cid-restart-buyer-$RUN")" = 1 ]'
check "billed once" '[ "$(billed_for "cid-restart-buyer-$RUN")" = 1 ]'
echo

echo "6. Broker restart"
docker restart solar-grid-rabbitmq >/dev/null
check "trade-matching is ready again" 'wait_for 120 "trade-matching" ready "$MATCHING"'
check "new events are consumed" \
  '[ "$(pair after-restart)" = "201" ] && wait_for 90 "the trade" match_is "cid-after-restart-buyer-$RUN" COMPLETED'
echo

echo "7. One correlation id through every service"
since="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
pair trace >/dev/null
wait_for 60 "the trade" match_is "cid-trace-buyer-$RUN" COMPLETED
cid="cid-trace-buyer-$RUN"
check "smart-meter logged the reading and its publication" \
  'logs_since "$since" solar-grid-smart-meter | grep "$cid" | grep -q "\"event\":\"outbox.event.published\""'
check "trade-matching logged the settled trade" \
  'logs_since "$since" solar-grid-trade-matching | grep "$cid" | grep -q "\"event\":\"trade.settled\""'
check "pricing logged the price request" \
  'logs_since "$since" solar-grid-pricing-engine | grep "$cid" | grep -q "\"event\":\"http.request.completed\""'
check "billing logged the recorded trade" \
  'logs_since "$since" solar-grid-billing-ledger | grep "$cid" | grep -q "\"event\":\"trade.recorded\""'
echo

echo "8. Metrics and secrets"
for url in "$SMART_METER" "$PRICING" "$MATCHING" "$BILLING"; do
  check "$url/metrics needs its token" '[ "$(status_of "$url/metrics")" = "401" ]'
  check "$url/metrics answers with it" \
    '[ "$(status_of -H "Authorization: Bearer $METRICS_TOKEN" "$url/metrics")" = "200" ]'
done
all_logs="$(docker compose -f "$ROOT/infrastructure/docker-compose.yml" logs --no-color 2>&1)"
leaked=0
for name in POSTGRES_PASSWORD SMART_METER_DB_PASSWORD PRICING_DB_PASSWORD MATCHING_DB_PASSWORD \
  LEDGER_DB_PASSWORD RABBITMQ_PASSWORD OPERATOR_API_TOKEN INTERNAL_API_TOKEN METRICS_TOKEN; do
  value="$(env_value "$name")"
  if [ -n "$value" ] && printf '%s' "$all_logs" | grep -qF "$value"; then
    echo "  $name appears in the logs"
    leaked=1
  fi
done
check "no secret appears in any log" '[ "$leaked" = 0 ]'
echo

echo "Summary: $PASS_COUNT passed, $FAIL_COUNT failed"
[ "$FAIL_COUNT" -eq 0 ]
