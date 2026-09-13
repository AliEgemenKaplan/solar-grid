# Solar Grid — API Contracts

## Decimal values

Money and energy are returned as **fixed-scale decimal strings**, never JSON
numbers, because a JSON number is a double and a double cannot hold `0.1` or
`4.0001` exactly.

| Kind          | Scale | Example    |
| ------------- | ----- | ---------- |
| Energy (kWh)  | 3     | `"7.000"`  |
| Price per kWh | 4     | `"4.0000"` |
| Money (TRY)   | 2     | `"16.00"`  |

Requests follow the same rule where the value is financial: `POST /trades`
takes decimal strings. Meter readings and pricing aggregates still accept JSON
numbers, since they come from instruments rather than from a ledger, and are
converted to decimals on arrival.

---

All services support the `x-correlation-id` request header for distributed tracing. Trade Matching forwards this header when calling Pricing and Billing.
Swagger UI is available at `http://localhost:<port>/api` for each service.

---

## smart-meter-service (port 3001)

### POST /readings

Submit a smart meter reading.

**Request:**

```json
{
  "householdId": "HH-001",
  "productionKwh": 8.5,
  "consumptionKwh": 3.2,
  "timestamp": "2026-05-27T10:00:00.000Z"
}
```

**Response (201):**

```json
{
  "id": "clxxxxx",
  "householdId": "HH-001",
  "productionKwh": "8.500",
  "consumptionKwh": "3.200",
  "netKwh": "5.300",
  "status": "SURPLUS",
  "surplusKwh": "5.300",
  "demandKwh": "0.000",
  "timestamp": "2026-05-27T10:00:00.000Z",
  "createdAt": "2026-05-27T10:00:01.000Z",
  "duplicate": false
}
```

A household reports one reading per timestamp. Re-sending the same
`householdId` and `timestamp` returns the stored reading with
`"duplicate": true` and publishes no second event.

### GET /readings/:householdId

Returns last 100 readings for a household, newest first.

### GET /households/:householdId/status

Returns the current energy status.

**Response (200):**

```json
{
  "id": "clxxxxx",
  "householdId": "HH-001",
  "currentStatus": "SURPLUS",
  "currentSurplusKwh": "5.300",
  "currentDemandKwh": "0.000",
  "lastReadingAt": "2026-05-27T10:00:00.000Z",
  "updatedAt": "2026-05-27T10:00:01.000Z"
}
```

### GET /health

```json
{ "status": "ok", "service": "smart-meter-service", "timestamp": "..." }
```

---

## pricing-engine-service (port 3002)

### GET /prices/current

```json
{
  "pricePerKwh": "3.2000",
  "currency": "TRY",
  "calculatedAt": "2026-05-27T10:05:00.000Z",
  "supplyKwh": "50.000",
  "demandKwh": "40.000"
}
```

### POST /prices/recalculate

**Request:**

```json
{
  "totalSupplyKwh": 50,
  "totalDemandKwh": 40
}
```

**Response (201):** Same shape as `GET /prices/current`.

### GET /prices/history?limit=50

Returns array of price snapshots, newest first.

### GET /health

```json
{ "status": "ok", "service": "pricing-engine-service", "timestamp": "..." }
```

---

## billing-ledger-service (port 3004)

### POST /trades

Record a completed trade (idempotent via `idempotencyKey`).

**Request:**

```json
{
  "tradeId": "TRD-001",
  "sellerHouseholdId": "HH-SELLER-001",
  "buyerHouseholdId": "HH-BUYER-001",
  "energyKwh": "4.000",
  "pricePerKwh": "4.7500",
  "totalAmount": "19.00",
  "currency": "TRY",
  "idempotencyKey": "match-uuid-001",
  "correlationId": "flow-uuid-001",
  "completedAt": "2026-05-27T10:10:00.000Z"
}
```

**Response (201):**

```json
{
  "id": "clxxxxx",
  "tradeId": "TRD-001",
  ...
  "duplicate": false
}
```

If the `idempotencyKey` already exists: response includes `"duplicate": true` and returns the original trade — no new ledger entries are created.

### GET /trades/:tradeId

### GET /trades/household/:householdId

### GET /balances/:householdId

```json
{ "householdId": "HH-SELLER-001", "balance": "19.00", "currency": "TRY", "updatedAt": "..." }
```

### GET /ledger/:householdId

Returns immutable ledger entries (CREDIT/DEBIT), newest first.

### GET /health

---

## trade-matching-service (port 3003)

### GET /offers

All sell offers with status.

### GET /requests

All buy requests with status.

### GET /matches

All trade matches.

### GET /matches/:tradeId

Single trade match by trade ID.

### POST /matching/run

Manually trigger FIFO matching. Safe to call while events are being consumed:
reservations are serialised, so a concurrent run cannot sell the same energy.

**Response (201):**

```json
{ "matched": 1, "failed": 0, "skipped": 0, "pending": 0, "settled": 0 }
```

| Field     | Meaning                                                     |
| --------- | ----------------------------------------------------------- |
| `matched` | trades reserved and billed during this run                  |
| `failed`  | trades billing refused; their energy was released           |
| `skipped` | pairs skipped because a household would trade with itself   |
| `pending` | trades reserved whose billing answer never arrived          |
| `settled` | trades reserved by an earlier run and confirmed in this one |

A trade match is `PENDING_BILLING`, `COMPLETED` or `FAILED`.

### GET /health
