# Solar Grid — Architecture

## Overview

Solar Grid is a neighborhood-level peer-to-peer renewable energy trading platform built as a microservices system. Households with solar panels can sell surplus energy to nearby households that need energy.

## Service Responsibilities

### 1. smart-meter-service (port 3001)

Accepts raw smart meter readings from households. Calculates whether each reading results in a surplus or demand condition based on `netKwh = productionKwh - consumptionKwh`. Persists readings and maintains the current energy status per household. Publishes domain events to RabbitMQ when surplus or demand is detected.

### 2. pricing-engine-service (port 3002)

Maintains the pricing rule (base, min, max price per kWh). Calculates the current neighborhood energy price using a supply/demand ratio formula: `price = clamp(basePrice * (demand / max(supply, 1)), minPrice, maxPrice)`. Persists price snapshots and exposes them for history and current lookups.

### 3. trade-matching-service (port 3003)

Subscribes to RabbitMQ energy events. When a surplus event arrives it creates a sell offer; when a demand event arrives it creates a buy request. Stores the source `eventId` on offers/requests so duplicate RabbitMQ deliveries do not create duplicate work. Runs a FIFO matching algorithm pairing sellers and buyers, supporting partial fills. Fetches the current price from the pricing engine and sends completed trades to the billing service.

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

This enforces loose coupling: if the billing service changes its schema, no other service breaks. Services exchange data only through REST APIs and RabbitMQ events — never by sharing a database.

## Communication Patterns

### RabbitMQ (Async Events)

- **Exchange**: `solar-grid.energy` (topic type)
- **Publisher**: smart-meter-service
- **Consumer**: trade-matching-service
- Events are durable and survive broker restarts.
- A dead-letter exchange (`solar-grid.energy.dlx`) captures messages that fail during consumer processing.
- No separate retry queue is implemented; failed messages are parked in the DLQ for inspection or manual replay.

### REST APIs (Sync Calls)

- trade-matching-service → pricing-engine-service: `GET /prices/current`
- trade-matching-service → billing-ledger-service: `POST /trades`

REST calls use environment variables for service URLs so they work both locally and inside Docker Compose without hardcoded hostnames.

## Correlation IDs

Every inbound HTTP request gets a `x-correlation-id` header assigned if not present. This ID flows through all log entries, published events, and outbound HTTP calls, enabling end-to-end tracing of a single household reading as it becomes a trade match and ledger entry.
