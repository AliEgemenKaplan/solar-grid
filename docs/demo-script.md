# Solar Grid - Demo Script

Run all services first:

```bash
docker compose -f infrastructure/docker-compose.yml up -d --build
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

If a default port collides with another stack, copy the example env file and
change the value; there is no separate override compose file.

```bash
cp infrastructure/.env.example infrastructure/.env
docker compose -f infrastructure/docker-compose.yml up -d --build
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

Each demo run generates unique household IDs, so it can be repeated without manually clearing old demo data.

The script verifies:

1. All four `/health` endpoints return `ok`.
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

The scripts read `OPERATOR_API_TOKEN` and `INTERNAL_API_TOKEN` from the
environment and fall back to the development defaults the compose file uses.

The script prints a final `Summary: N passed, M failed` line and exits with status `1` if any required check fails.
