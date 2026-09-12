# Solar Grid — Database Design

Each service owns its own PostgreSQL database. No service ever accesses another service's tables.

---

## smart-meter-service → `smart_meter_db`

### `meter_readings`

| Column         | Type     | Notes                              |
| -------------- | -------- | ---------------------------------- |
| id             | cuid     | PK                                 |
| householdId    | String   | Indexed                            |
| productionKwh  | Float    |                                    |
| consumptionKwh | Float    |                                    |
| netKwh         | Float    | Computed: production - consumption |
| status         | Enum     | SURPLUS / DEMAND / BALANCED        |
| timestamp      | DateTime | From the meter device              |
| createdAt      | DateTime | Server insert time                 |

`(householdId, timestamp)` is unique: a meter reports one reading per
timestamp, so a retried request cannot create a second reading or event.

### `outbox_events`

| Column        | Type      | Notes                                        |
| ------------- | --------- | -------------------------------------------- |
| id            | cuid      | PK                                           |
| eventId       | String    | UNIQUE; also sent as the AMQP messageId      |
| eventType     | String    | EnergySurplusDetected / EnergyDemandDetected |
| routingKey    | String    | Exchange routing key                         |
| payload       | Json      | The event exactly as it will be published    |
| correlationId | String    |                                              |
| status        | Enum      | PENDING / PUBLISHED                          |
| attempts      | Int       | Failed publish attempts                      |
| lastError     | String?   | Why the last attempt failed                  |
| createdAt     | DateTime  | Indexed with status for the publisher scan   |
| publishedAt   | DateTime? |                                              |

Written in the same transaction as the reading that produced it, so the
database and the broker can never disagree about what happened.

### `household_energy_status`

| Column            | Type     | Notes                       |
| ----------------- | -------- | --------------------------- |
| id                | cuid     | PK                          |
| householdId       | String   | UNIQUE                      |
| currentStatus     | Enum     | SURPLUS / DEMAND / BALANCED |
| currentSurplusKwh | Float    | 0 when DEMAND/BALANCED      |
| currentDemandKwh  | Float    | 0 when SURPLUS/BALANCED     |
| updatedAt         | DateTime | Auto-updated                |

---

## pricing-engine-service → `pricing_db`

### `pricing_rules`

| Column    | Type     | Notes                     |
| --------- | -------- | ------------------------- |
| id        | cuid     | PK                        |
| basePrice | Float    | Default: 4.00             |
| minPrice  | Float    | Default: 2.50             |
| maxPrice  | Float    | Default: 7.00             |
| currency  | String   | Default: TRY              |
| isActive  | Boolean  | Only one active rule used |
| createdAt | DateTime |                           |
| updatedAt | DateTime |                           |

### `price_snapshots`

| Column          | Type     | Notes                    |
| --------------- | -------- | ------------------------ |
| id              | cuid     | PK                       |
| totalSupplyKwh  | Float    |                          |
| totalDemandKwh  | Float    |                          |
| calculatedPrice | Float    | Result of formula        |
| currency        | String   |                          |
| createdAt       | DateTime | Immutable history record |

---

## trade-matching-service → `matching_db`

### `sell_offers`

| Column        | Type     | Notes                                                           |
| ------------- | -------- | --------------------------------------------------------------- |
| id            | cuid     | PK                                                              |
| householdId   | String   | Indexed                                                         |
| sourceEventId | String?  | UNIQUE for non-null values; prevents duplicate event processing |
| availableKwh  | Float    | Decrements as partial matches occur                             |
| originalKwh   | Float    | Unchanged; historical record                                    |
| status        | Enum     | OPEN / PARTIALLY_MATCHED / MATCHED / CANCELLED                  |
| correlationId | String   |                                                                 |
| createdAt     | DateTime | Used for FIFO ordering                                          |
| updatedAt     | DateTime |                                                                 |

### `buy_requests`

Same structure as `sell_offers` but with `requestedKwh` instead of `availableKwh`. It also stores `sourceEventId` as a unique non-null value for new demand events.

### `trade_matches`

| Column                | Type     | Notes                                |
| --------------------- | -------- | ------------------------------------ |
| id                    | cuid     | PK                                   |
| tradeId               | String   | UNIQUE; sent to billing              |
| sellerHouseholdId     | String   |                                      |
| buyerHouseholdId      | String   |                                      |
| energyKwh             | Float    | Actual trade volume                  |
| pricePerKwh           | Float    | Price at time of match               |
| totalAmount           | Float    | energyKwh × pricePerKwh, rounded     |
| currency              | String   |                                      |
| status                | Enum     | PENDING_BILLING / COMPLETED / FAILED |
| billingTradeId        | String?  | Trade id billing confirmed           |
| offerId               | String   | Offer this trade reserved from       |
| requestId             | String   | Request this trade reserved for      |
| billingAttempts       | Int      | How many times billing was called    |
| idempotencyKey        | String   | UNIQUE; equals tradeId               |
| correlationId         | String   |                                      |
| failureReason         | String?  | Set when status = FAILED             |
| createdAt / updatedAt | DateTime |                                      |

---

## billing-ledger-service → `ledger_db`

### `completed_trades`

| Column                                | Type     | Notes                              |
| ------------------------------------- | -------- | ---------------------------------- |
| id                                    | cuid     | PK                                 |
| tradeId                               | String   | UNIQUE                             |
| sellerHouseholdId                     | String   | Indexed                            |
| buyerHouseholdId                      | String   | Indexed                            |
| energyKwh / pricePerKwh / totalAmount | Float    | Trade details                      |
| currency                              | String   |                                    |
| idempotencyKey                        | String   | UNIQUE; prevents duplicate records |
| correlationId                         | String   |                                    |
| completedAt                           | DateTime | Business timestamp from matching   |
| createdAt                             | DateTime | Server insert time                 |

### `ledger_entries` _(immutable — never updated or deleted)_

| Column        | Type     | Notes          |
| ------------- | -------- | -------------- |
| id            | cuid     | PK             |
| tradeId       | String   | Indexed        |
| householdId   | String   | Indexed        |
| entryType     | Enum     | CREDIT / DEBIT |
| amount        | Float    |                |
| currency      | String   |                |
| correlationId | String   |                |
| createdAt     | DateTime | Immutable      |

### `household_balances`

| Column      | Type     | Notes                               |
| ----------- | -------- | ----------------------------------- |
| householdId | String   | UNIQUE PK                           |
| balance     | Float    | + for net sellers, - for net buyers |
| currency    | String   |                                     |
| updatedAt   | DateTime |                                     |

### `idempotency_keys`

| Column       | Type     | Notes                      |
| ------------ | -------- | -------------------------- |
| key          | String   | UNIQUE; provided by caller |
| tradeId      | String   |                            |
| responseHash | String?  | Optional cached response   |
| createdAt    | DateTime |                            |
