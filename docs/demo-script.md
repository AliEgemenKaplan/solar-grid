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

If local ports conflict, start Compose with the override file:

```bash
docker compose -f infrastructure/docker-compose.yml -f infrastructure/docker-compose.override.yml up -d --build
```

Then point the demo scripts at the remapped host ports:

```bash
SMART_METER_URL=http://localhost:13001 \
PRICING_URL=http://localhost:13002 \
MATCHING_URL=http://localhost:13003 \
BILLING_URL=http://localhost:13004 \
bash scripts/demo.sh
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
9. Posting the same billing trade twice returns `duplicate: true`.

The script prints a final `Summary: N passed, M failed` line and exits with status `1` if any required check fails.
