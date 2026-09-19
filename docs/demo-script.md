# Solar Grid - Demo Script

Create the credentials once, then start everything:

```bash
pnpm env:init
docker compose -f infrastructure/docker-compose.yml up -d --build --wait
```

Then run:

```bash
bash scripts/demo.sh
```

PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/demo.ps1
```

## Port Override Mode

If a default port collides with another stack, change it in
`infrastructure/.env`; there is no separate override compose file.

```bash
pnpm env:init   # if infrastructure/.env does not exist yet
# edit the ports that collide, then
docker compose -f infrastructure/docker-compose.yml up -d --build --wait
```

Then point the demo scripts at the ports you chose:

```bash
SMART_METER_URL=http://localhost:13001 PRICING_URL=http://localhost:13002 MATCHING_URL=http://localhost:13003 BILLING_URL=http://localhost:13004 bash scripts/demo.sh
```

PowerShell:

```powershell
$env:SMART_METER_URL="http://localhost:13001"
$env:PRICING_URL="http://localhost:13002"
$env:MATCHING_URL="http://localhost:13003"
$env:BILLING_URL="http://localhost:13004"
powershell -ExecutionPolicy Bypass -File scripts/demo.ps1
```

## What The Demo Verifies

Each demo run generates unique household IDs, so it can be repeated without manually clearing old demo data. Its readings and its directly recorded trade are timestamped when it runs, so they appear in the operator dashboard's recent windows at http://localhost:8080. The seller's surplus equals the buyer's demand (4 kWh), so a run leaves no open offer behind for the next run's buyer to be matched with.

`scripts/resilience.sh` is the other half: it takes dependencies away and checks that the stack recovers. It changes the stack's state, so run it after the demo, not before.

The script verifies:

1. All four `/health/ready` endpoints return `ready`.
2. A seller reading returns `SURPLUS`.
3. A buyer reading returns `DEMAND`.
4. RabbitMQ events are consumed and a completed match is created.
5. Seller balance becomes positive.
6. Buyer balance becomes negative.
7. Seller ledger contains a `CREDIT` entry.
8. Buyer ledger contains a `DEBIT` entry.
9. Posting the same billing trade twice, with the internal service token, returns `duplicate: true`.
10. Money and prices come back as fixed-scale decimal strings.
11. `POST /matching/run` without a token is `401`, with the service token `403`, with the operator token `200`.
12. `POST /trades` without a token is `401`.
13. `GET /matches?limit=100000` is `400`.
14. The same idempotency key with a different payload is `409`.
15. An error body carries a `code` and the request's correlation id, and no stack trace.
16. Energy statistics count the demo's readings.
17. Trade statistics report the settled trade, its volume and an average price.
18. Billing statistics show a ledger whose credits and debits cancel to `0.00`.
19. An hourly trend returns 24 buckets in order, quiet ones included.
20. `GET /stats/summary` without a token is `401`, with the service token `403`.

The scripts read `OPERATOR_API_TOKEN` and `INTERNAL_API_TOKEN` from the
environment, or else from `infrastructure/.env`, and never print them.

The script prints a final `Summary: N passed, M failed` line and exits with status `1` if any required check fails.
