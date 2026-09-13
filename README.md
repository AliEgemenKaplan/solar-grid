# Solar Grid

Solar Grid is a CENG442 microservice architecture project for neighborhood-level peer-to-peer renewable energy trading. Households with surplus solar production can sell energy to households with demand.

## Services

| Service                | Port         | Responsibility                                                                                       |
| ---------------------- | ------------ | ---------------------------------------------------------------------------------------------------- |
| smart-meter-service    | 3001         | Receives smart meter readings, calculates household energy state, publishes surplus/demand events    |
| pricing-engine-service | 3002         | Maintains pricing rules and calculates current price per kWh                                         |
| trade-matching-service | 3003         | Consumes RabbitMQ events, creates offers/requests, performs FIFO matching, calls Pricing and Billing |
| billing-ledger-service | 3004         | Records completed trades, ledger entries, balances, and billing idempotency                          |
| RabbitMQ               | 5672 / 15672 | Event broker and management UI                                                                       |

Each microservice owns a separate PostgreSQL database.

## Architecture

```text
POST /readings
    |
    v
smart-meter-service
    | publishes EnergySurplusDetected / EnergyDemandDetected
    v
RabbitMQ exchange: solar-grid.energy
    |
    v
trade-matching-service
    | GET /prices/current
    v
pricing-engine-service
    |
    | POST /trades
    v
billing-ledger-service
```

Communication patterns:

- RabbitMQ topic events from Smart Meter to Trade Matching.
- REST from Trade Matching to Pricing.
- REST from Trade Matching to Billing.
- `x-correlation-id` is propagated through events and REST headers.

## Reliability Notes

- A reading and the event it produces are written in one database transaction,
  and a publisher moves the event to RabbitMQ afterwards, so a broker outage
  delays events instead of losing them.
- Events are persistent, carry `eventId`, `correlationId`, `occurredAt`,
  `sourceEventId` and a schema `version`, and are published with `mandatory` so
  one with nowhere to go comes back instead of disappearing.
- A failing message is retried with a growing delay up to `RABBITMQ_MAX_RETRIES`
  times and is then parked in `trade-matching.energy.dlq` with the reason in its
  headers. Nothing is redelivered forever.
- Duplicate delivery is expected: `sourceEventId` is unique on offers and
  requests, trades carry a stable idempotency key, and the ledger refuses to
  record the same settlement twice.
- Energy is reserved on both sides before billing is called and released only
  if billing refuses outright, so the same kilowatt hours cannot be sold or
  charged twice.
- Consumer prefetch is `1`: matching is serialised by a database lock anyway.
- Health endpoints are lightweight liveness checks at `/health`.

[docs/event-flow.md](docs/event-flow.md) walks through how an event is created,
how it crosses RabbitMQ, what happens when it fails and how it reaches the dead
letter queue. [docs/reliability.md](docs/reliability.md) lists the guarantees
and the test that proves each one.

### Looking at the queues

```bash
docker exec solar-grid-rabbitmq rabbitmqctl list_queues name messages consumers
```

The management UI is at http://localhost:15672 (guest / guest), where a parked
message can be inspected and republished once the cause is fixed.

## Prerequisites

- Docker and Docker Compose v2
- Node.js >= 24 (see `.nvmrc`)
- pnpm 10 — `corepack enable` picks the pinned version up from package.json

## Validation Commands

Run these before the live demo:

```bash
pnpm install --frozen-lockfile
pnpm prisma:generate   # required before the first build: the Prisma client is generated, not committed
pnpm lint
pnpm typecheck
pnpm test
pnpm build
docker compose -f infrastructure/docker-compose.yml up -d --build
bash scripts/demo.sh
```

PowerShell demo:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/demo.ps1
```

## Local Port Conflicts

Every published port binds to `127.0.0.1` and can be remapped without editing
the compose file. The PostgreSQL containers publish no host ports at all; use
`docker compose exec postgres-smart-meter psql -U postgres smart_meter_db` for
a shell, or start the stack with `infrastructure/docker-compose.dev-ports.yml`
as a second `-f` argument when you want to reach a database from your machine.

```bash
cp infrastructure/.env.example infrastructure/.env
# edit the ports that collide, then
docker compose -f infrastructure/docker-compose.yml up -d --build
```

The demo scripts follow the same values:

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

## Docker Compose

Start:

```bash
docker compose -f infrastructure/docker-compose.yml up -d --build
```

Logs:

```bash
docker compose -f infrastructure/docker-compose.yml logs -f
```

Stop:

```bash
docker compose -f infrastructure/docker-compose.yml down
```

Clean volumes:

```bash
docker compose -f infrastructure/docker-compose.yml down -v --remove-orphans
```

## API Documentation

Swagger UI is available when services are running:

- Smart Meter: http://localhost:3001/api
- Pricing Engine: http://localhost:3002/api
- Trade Matching: http://localhost:3003/api
- Billing & Ledger: http://localhost:3004/api

RabbitMQ Management:

- http://localhost:15672
- username: `guest`
- password: `guest`

## Repository Structure

```text
SolarGrid/
  apps/
    smart-meter-service/
    pricing-engine-service/
    trade-matching-service/
    billing-ledger-service/
  packages/
    shared-contracts/
    shared-utils/
  infrastructure/
    docker-compose.yml
    .env.example
  docs/
  scripts/
    demo.sh
    demo.ps1
  package.json
  pnpm-lock.yaml
  pnpm-workspace.yaml
```

## Documentation

| Doc                                                | Purpose                                                          |
| -------------------------------------------------- | ---------------------------------------------------------------- |
| [docs/architecture.md](docs/architecture.md)       | Final service architecture and communication patterns            |
| [docs/api-contracts.md](docs/api-contracts.md)     | REST endpoints and payload examples                              |
| [docs/event-flow.md](docs/event-flow.md)           | RabbitMQ topology, routing keys, and flow                        |
| [docs/database-design.md](docs/database-design.md) | Database tables per service                                      |
| [docs/reliability.md](docs/reliability.md)         | Idempotency, DLQ behavior, correlation IDs, and health endpoints |
| [docs/demo-script.md](docs/demo-script.md)         | Demo execution and expected checks                               |

## Team Contributions

| Name              | Contribution                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| Ali Egemen Kaplan | project setup, infrastructure, Smart Meter Service, Pricing Engine Service, validation support |

## Report Evidence Checklist

For the final implementation report, capture:

- `pnpm build` output
- `pnpm test` output
- Docker Compose running containers
- `/health` responses for all services
- Demo script final PASS summary
- RabbitMQ queues/exchange screenshot
- Swagger screenshots for the four services
- Ledger/balance responses after a completed demo trade
