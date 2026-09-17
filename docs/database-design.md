# Solar Grid - Database Design

Each service owns its own PostgreSQL database. No service ever reads or writes
another service's tables; they exchange data through REST and RabbitMQ only.

## Schema management

Schemas are built from committed SQL migrations under
`apps/<service>/prisma/migrations`, applied with `prisma migrate deploy` when a
container starts. Nothing generates DDL from the schema file at runtime, so the
database a reviewer gets from a clean clone is the database that was tested.

Every service starts from the same two migrations, and three have picked up
one or two more as query patterns arrived:

| Migration                                 | Services                             | What it does                                                              |
| ----------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------- |
| `20260913090000_init`                     | all                                  | Tables, enums, indexes and foreign keys, generated from the Prisma schema |
| `20260913090100_integrity_constraints`    | all                                  | CHECK constraints, which Prisma cannot express in its schema language     |
| `20260916090000_correlation_indexes`      | trade-matching                       | Tracing a reading to the offer or request it produced                     |
| `20260916090000_idempotency_request_hash` | billing                              | The hash that tells a retry from a different payload with the same key    |
| `20260918090000_*_stats_indexes`          | smart-meter, trade-matching, billing | Indexes the statistics endpoints need; see [analytics.md](analytics.md)   |

Deploying a second time is a no-op: Prisma records applied migrations in
`_prisma_migrations` and skips them.

## Numeric types

Money and energy are `numeric`, never `double precision`:

| Kind   | Type             | Example                       |
| ------ | ---------------- | ----------------------------- |
| Energy | `DECIMAL(12, 3)` | `7.000` kWh, to the watt hour |
| Price  | `DECIMAL(10, 4)` | `4.0000` TRY/kWh              |
| Money  | `DECIMAL(14, 2)` | `16.00` TRY, to the kurus     |

Binary floating point cannot represent `0.1` or `4.0001` exactly, and these
values are multiplied, summed and compared for exhaustion. The API returns
them as fixed-scale strings for the same reason - see
[api-contracts.md](api-contracts.md).

---

## smart-meter-service - `smart_meter_db`

### `meter_readings`

| Column         | Type          | Notes                                     |
| -------------- | ------------- | ----------------------------------------- |
| id             | cuid          | PK                                        |
| householdId    | String        |                                           |
| productionKwh  | Decimal(12,3) | `>= 0`                                    |
| consumptionKwh | Decimal(12,3) | `>= 0`                                    |
| netKwh         | Decimal(12,3) | Checked to equal production - consumption |
| status         | Enum          | SURPLUS / DEMAND / BALANCED               |
| timestamp      | DateTime      | When the meter took the reading           |
| createdAt      | DateTime      |                                           |

`(householdId, timestamp)` is unique: a meter reports one reading per
timestamp, so a retried request cannot create a second reading or event. The
same index serves "readings for this household, newest first".

`timestamp` is indexed on its own as well, for the statistics endpoints: they
read a window across every household, and an index that starts with the
household cannot serve that.

### `household_energy_status`

| Column            | Type          | Notes                                    |
| ----------------- | ------------- | ---------------------------------------- |
| id                | cuid          | PK                                       |
| householdId       | String        | UNIQUE                                   |
| currentStatus     | Enum          |                                          |
| currentSurplusKwh | Decimal(12,3) | `>= 0`                                   |
| currentDemandKwh  | Decimal(12,3) | `>= 0`                                   |
| lastReadingAt     | DateTime      | Timestamp of the reading behind this row |
| updatedAt         | DateTime      |                                          |

The row is written with a conditional upsert that only overwrites when the new
reading is newer than `lastReadingAt`, so a reading that arrives late cannot
roll the household back to an older state.

### `outbox_events`

| Column        | Type      | Notes                                        |
| ------------- | --------- | -------------------------------------------- |
| id            | cuid      | PK                                           |
| eventId       | String    | UNIQUE; also sent as the AMQP messageId      |
| eventType     | String    | EnergySurplusDetected / EnergyDemandDetected |
| routingKey    | String    |                                              |
| payload       | Json      | The event exactly as it will be published    |
| correlationId | String    |                                              |
| status        | Enum      | PENDING / PUBLISHED                          |
| attempts      | Int       | `>= 0`                                       |
| lastError     | String?   |                                              |
| createdAt     | DateTime  | Indexed with status for the publisher scan   |
| publishedAt   | DateTime? |                                              |

Written in the same transaction as the reading that produced it, so the
database and the broker can never disagree about what happened.

---

## pricing-engine-service - `pricing_db`

### `pricing_rules`

| Column                | Type          | Notes                             |
| --------------------- | ------------- | --------------------------------- |
| id                    | cuid          | PK                                |
| basePrice             | Decimal(10,4) | `> 0`                             |
| minPrice / maxPrice   | Decimal(10,4) | `> 0`, and `minPrice <= maxPrice` |
| currency              | String        | Three letter code                 |
| isActive              | Boolean       |                                   |
| createdAt / updatedAt | DateTime      |                                   |

### `price_snapshots`

| Column          | Type          | Notes             |
| --------------- | ------------- | ----------------- |
| id              | cuid          | PK                |
| totalSupplyKwh  | Decimal(12,3) | `>= 0`            |
| totalDemandKwh  | Decimal(12,3) | `>= 0`            |
| calculatedPrice | Decimal(10,4) | `> 0`             |
| currency        | String        | Three letter code |
| createdAt       | DateTime      | Indexed           |

Every price lookup reads the newest snapshot (`ORDER BY createdAt DESC LIMIT
1`), which is what the index on `createdAt` is for.

---

## trade-matching-service - `matching_db`

### `sell_offers`

| Column        | Type          | Notes                                          |
| ------------- | ------------- | ---------------------------------------------- |
| id            | cuid          | PK                                             |
| householdId   | String        | Indexed                                        |
| sourceEventId | String?       | UNIQUE; stops a redelivered event creating two |
| availableKwh  | Decimal(12,3) | `>= 0` and `<= originalKwh`                    |
| originalKwh   | Decimal(12,3) | `> 0`; never changes                           |
| status        | Enum          | OPEN / PARTIALLY_MATCHED / MATCHED / CANCELLED |
| correlationId | String        |                                                |
| createdAt     | DateTime      | Indexed with status for the matching scan      |

The two CHECK constraints are the database-level statement of what the
reservation logic promises: an offer can never go negative, and can never end
up with more energy than it started with.

### `buy_requests`

Same shape with `requestedKwh` in place of `availableKwh`, and the same
constraints and indexes.

### `trade_matches`

| Column                | Type          | Notes                                  |
| --------------------- | ------------- | -------------------------------------- |
| id                    | cuid          | PK                                     |
| tradeId               | String        | UNIQUE; sent to billing                |
| sellerHouseholdId     | String        | Checked to differ from the buyer       |
| buyerHouseholdId      | String        |                                        |
| energyKwh             | Decimal(12,3) | `> 0`                                  |
| pricePerKwh           | Decimal(10,4) | `> 0`                                  |
| totalAmount           | Decimal(14,2) | `>= 0`                                 |
| currency              | String        | Three letter code                      |
| status                | Enum          | PENDING_BILLING / COMPLETED / FAILED   |
| billingTradeId        | String?       | Trade id billing confirmed             |
| offerId               | String        | FK to `sell_offers`                    |
| requestId             | String        | FK to `buy_requests`                   |
| idempotencyKey        | String        | UNIQUE; equals tradeId                 |
| billingAttempts       | Int           | `>= 0`                                 |
| correlationId         | String        | Indexed, for tracing a reading through |
| failureReason         | String?       |                                        |
| createdAt / updatedAt | DateTime      | `(status, createdAt)` indexed          |

The foreign keys mean a trade cannot reserve energy from an offer or request
that is not there, and `(status, createdAt)` is how settlement finds
unconfirmed trades oldest first. `createdAt`, `sellerHouseholdId` and
`buyerHouseholdId` are indexed for the statistics endpoints, which read a
window across every status and a household's trading from either side of it.

---

## billing-ledger-service - `ledger_db`

### `completed_trades`

| Column            | Type          | Notes                                 |
| ----------------- | ------------- | ------------------------------------- |
| id                | cuid          | PK                                    |
| tradeId           | String        | UNIQUE                                |
| sellerHouseholdId | String        | Indexed; checked to differ from buyer |
| buyerHouseholdId  | String        | Indexed                               |
| energyKwh         | Decimal(12,3) | `> 0`                                 |
| pricePerKwh       | Decimal(10,4) | `> 0`                                 |
| totalAmount       | Decimal(14,2) | `>= 0`                                |
| currency          | String        | Three letter code                     |
| idempotencyKey    | String        | UNIQUE                                |
| correlationId     | String        | Indexed, for tracing                  |
| completedAt       | DateTime      | Indexed, for statistics by trade time |
| createdAt         | DateTime      |                                       |

### `ledger_entries` _(append only - never updated or deleted)_

| Column        | Type          | Notes                          |
| ------------- | ------------- | ------------------------------ |
| id            | cuid          | PK                             |
| tradeId       | String        | FK to `completed_trades`       |
| householdId   | String        |                                |
| entryType     | Enum          | CREDIT / DEBIT                 |
| amount        | Decimal(14,2) | `>= 0`; direction is entryType |
| currency      | String        | Three letter code              |
| correlationId | String        |                                |
| createdAt     | DateTime      |                                |

`(tradeId, householdId, entryType)` is unique. One side of a trade is credited
or debited exactly once, so even an application bug that tried to settle the
same trade twice cannot produce a second set of entries. The ledger endpoint
reads one household newest first, which `(householdId, createdAt)` serves;
`createdAt` on its own serves the statistics, which read every household at
once. Nothing here is ever updated or deleted, statistics included: they are
SELECTs run by a role with no such privilege.

### `household_balances`

| Column      | Type          | Notes                             |
| ----------- | ------------- | --------------------------------- |
| id          | cuid          | PK                                |
| householdId | String        | UNIQUE                            |
| balance     | Decimal(14,2) | May be negative: buyers owe money |
| currency    | String        | Three letter code                 |
| updatedAt   | DateTime      |                                   |

A cache of the ledger, updated inside the same transaction as the entries.
Balances are touched in a fixed order (sorted by household id) so two trades
running in opposite directions between the same pair cannot deadlock.

### `idempotency_keys`

| Column       | Type     | Notes                                                                |
| ------------ | -------- | -------------------------------------------------------------------- |
| id           | cuid     | PK                                                                   |
| key          | String   | UNIQUE                                                               |
| tradeId      | String   | FK to `completed_trades`                                             |
| responseHash | String?  | Reserved for rejecting a reused key that carries a different payload |
| createdAt    | DateTime |                                                                      |
