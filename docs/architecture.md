# Solar Grid — Architecture

## Overview

Solar Grid is a neighborhood-level peer-to-peer renewable energy trading platform built as a microservices system. Households with solar panels can sell surplus energy to nearby households that need energy.

## Service Responsibilities

### 1. smart-meter-service (port 3001)

Accepts raw smart meter readings from households. Calculates whether each reading results in a surplus or demand condition based on `netKwh = productionKwh - consumptionKwh`. Persists readings and maintains the current energy status per household. Surplus and demand events are written to a transactional outbox in the same transaction as the reading, and a publisher moves them to RabbitMQ, so a broker outage delays events instead of losing them.

### 2. pricing-engine-service (port 3002)

Maintains the pricing rule (base, min, max price per kWh). Calculates the current neighborhood energy price using a supply/demand ratio formula: `price = clamp(basePrice * (demand / max(supply, 1)), minPrice, maxPrice)`. Persists price snapshots and exposes them for history and current lookups.

### 3. trade-matching-service (port 3003)

Subscribes to RabbitMQ energy events. When a surplus event arrives it creates a sell offer; when a demand event arrives it creates a buy request. Stores the source `eventId` on offers/requests so duplicate RabbitMQ deliveries do not create duplicate work. Runs a FIFO matching algorithm pairing sellers and buyers, supporting partial fills. Energy is reserved on both sides before billing is called and released only if billing refuses outright, so the same kilowatt hours cannot be sold or charged twice. See [reliability.md](reliability.md).

### 4. billing-ledger-service (port 3004)

The financial record keeper. Accepts completed trade notifications and records them in an immutable ledger (CREDIT for seller, DEBIT for buyer). Updates household balances atomically using a database transaction. Uses idempotency keys to prevent duplicate ledger entries on retries.

## Data Ownership

Each service owns its own PostgreSQL database and is the only service allowed to read or write that data:

| Service                | Database       |
| ---------------------- | -------------- |
| smart-meter-service    | smart_meter_db |
| pricing-engine-service | pricing_db     |
| trade-matching-service | matching_db    |
| billing-ledger-service | ledger_db      |

This enforces loose coupling: if the billing service changes its schema, no other service breaks. Services exchange data only through REST APIs and RabbitMQ events - never by sharing a database.

Each database is built from committed SQL migrations applied with
`prisma migrate deploy` at startup, and money and energy are stored as exact
`numeric` columns rather than floats. See
[database-design.md](database-design.md).

## Communication Patterns

### RabbitMQ (Async Events)

- **Exchange**: `solar-grid.energy` (topic type)
- **Publisher**: smart-meter-service
- **Consumer**: trade-matching-service
- Exchanges and queues are durable and messages are published as persistent, so events survive a broker restart.
- A failing message is retried a bounded number of times with a growing delay through `solar-grid.energy.retry`, and is then parked in `trade-matching.energy.dlq` through the dead letter exchange. Nothing is ever redelivered forever.
- Messages are published with `mandatory`, so an event with nowhere to go comes back to the publisher rather than disappearing.
- See [event-flow.md](event-flow.md) for the topology, the retry ladder and the recovery behaviour.

### REST APIs (Sync Calls)

- trade-matching-service → pricing-engine-service: `GET /prices/current`
- trade-matching-service → billing-ledger-service: `POST /trades`

Both calls have a timeout (`HTTP_CLIENT_TIMEOUT_MS`). A trade whose billing
call times out keeps its reservation and is retried with the same idempotency
key rather than being written off.

REST calls use environment variables for service URLs so they work both locally and inside Docker Compose without hardcoded hostnames.

## Correlation IDs

Every inbound HTTP request gets a `x-correlation-id` header assigned if not present. This ID flows through all log entries, published events, and outbound HTTP calls, enabling end-to-end tracing of a single household reading as it becomes a trade match and ledger entry.
