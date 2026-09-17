# Solar Grid - API Contracts

Authentication, validation, the error body, status codes, pagination and rate
limits are the same everywhere and are described once, in
[api-security.md](api-security.md). This document lists the endpoints.

## Conventions in brief

- **Decimals are strings.** Energy has 3 decimals (`"7.000"`), prices 4
  (`"4.0000"`), money 2 (`"16.00"`). A JSON number is a double and cannot hold
  every amount exactly. `POST /trades` also takes them as strings; meter
  readings and pricing aggregates still take JSON numbers.
- **Lists are paged.** `?page=1&limit=50`, maximum 100, and the response is
  `{ "items": [], "page": 1, "limit": 50, "total": 0 }`.
- **Errors** have `statusCode`, `code`, `message`, `correlationId`, `timestamp`,
  `path` and sometimes `details`.
- **`x-correlation-id`** may be sent with any request and is always returned.
- **Swagger** is at `http://localhost:<port>/api` when enabled.

Access: 🌐 public · 🔑 operator token · 🔒 internal service token

---

## smart-meter-service (port 3001)

### 🌐 POST /readings

```json
{
  "householdId": "HH-001",
  "productionKwh": 8.5,
  "consumptionKwh": 3.2,
  "timestamp": "2026-05-27T10:00:00.000Z"
}
```

`201` the first time, `200` for the same household and timestamp again:

```json
{
  "id": "clx...",
  "householdId": "HH-001",
  "productionKwh": "8.500",
  "consumptionKwh": "3.200",
  "netKwh": "5.300",
  "status": "SURPLUS",
  "timestamp": "2026-05-27T10:00:00.000Z",
  "createdAt": "2026-05-27T10:00:01.000Z",
  "surplusKwh": "5.300",
  "demandKwh": "0.000",
  "duplicate": false
}
```

`400` invalid input · `422` a reading from the future · `429` too many writes.

### 🌐 GET /readings/:householdId

Paged `ReadingSummary` items (the reading without `surplusKwh`, `demandKwh`,
`duplicate`), newest first.

### 🌐 GET /households

Paged household statuses, most recently active first. Filter: `status`
(`SURPLUS`, `DEMAND`, `BALANCED`).

### 🌐 GET /households/:householdId/status

```json
{
  "householdId": "HH-001",
  "currentStatus": "SURPLUS",
  "currentSurplusKwh": "5.300",
  "currentDemandKwh": "0.000",
  "lastReadingAt": "2026-05-27T10:00:00.000Z",
  "updatedAt": "2026-05-27T10:00:01.000Z"
}
```

`404` when the household has never reported.

---

## pricing-engine-service (port 3002)

### 🌐 GET /prices/current

```json
{
  "pricePerKwh": "3.2000",
  "currency": "TRY",
  "calculatedAt": "2026-05-27T10:05:00.000Z",
  "supplyKwh": "50.000",
  "demandKwh": "40.000"
}
```

### 🔑 POST /prices/recalculate

```json
{ "totalSupplyKwh": 50, "totalDemandKwh": 40 }
```

`201` with the new price, same shape as `GET /prices/current`. `401` / `403`
without the operator token.

### 🌐 GET /prices/history

Paged snapshots, newest first:
`{ id, totalSupplyKwh, totalDemandKwh, calculatedPrice, currency, createdAt }`.

---

## trade-matching-service (port 3003)

### 🔑 POST /matching/run

Settles trades left unconfirmed by earlier runs, then matches. `200`:

```json
{ "matched": 1, "failed": 0, "skipped": 0, "pending": 0, "settled": 0 }
```

| Field     | Meaning                                                         |
| --------- | --------------------------------------------------------------- |
| `matched` | trades reserved and billed during this run                      |
| `failed`  | trades billing refused; their energy was released               |
| `skipped` | pairs skipped because a household would trade with itself       |
| `pending` | trades reserved whose billing answer never arrived              |
| `settled` | trades reserved by an earlier run and confirmed during this one |

`503 DOWNSTREAM_UNAVAILABLE` when pricing does not answer; nothing was reserved.

### 🌐 GET /matches

Paged trade matches, newest first. Filters: `status` (`PENDING_BILLING`,
`COMPLETED`, `FAILED`), `correlationId`.

```json
{
  "id": "clx...",
  "tradeId": "TRD-5F1A2B3C4D5E",
  "sellerHouseholdId": "HH-SELLER-001",
  "buyerHouseholdId": "HH-BUYER-001",
  "energyKwh": "4.000",
  "pricePerKwh": "4.0000",
  "totalAmount": "16.00",
  "currency": "TRY",
  "status": "COMPLETED",
  "billingTradeId": "TRD-5F1A2B3C4D5E",
  "offerId": "clx...",
  "requestId": "clx...",
  "idempotencyKey": "TRD-5F1A2B3C4D5E",
  "billingAttempts": 1,
  "correlationId": "demo-flow-001",
  "failureReason": null,
  "createdAt": "...",
  "updatedAt": "..."
}
```

### 🌐 GET /matches/:tradeId

One trade match. `404` if it does not exist.

### 🌐 GET /offers · 🌐 GET /requests

Paged sell offers and buy requests, newest first. Filters: `status` (`OPEN`,
`PARTIALLY_MATCHED`, `MATCHED`, `CANCELLED`), `correlationId`. Offers carry
`availableKwh` and `originalKwh`; requests carry `requestedKwh` and
`originalKwh`.

---

## billing-ledger-service (port 3004)

### 🔒 POST /trades

Called by trade-matching-service.

```json
{
  "tradeId": "TRD-5F1A2B3C4D5E",
  "sellerHouseholdId": "HH-SELLER-001",
  "buyerHouseholdId": "HH-BUYER-001",
  "energyKwh": "4.000",
  "pricePerKwh": "4.7500",
  "totalAmount": "19.00",
  "currency": "TRY",
  "idempotencyKey": "TRD-5F1A2B3C4D5E",
  "correlationId": "demo-flow-001",
  "completedAt": "2026-05-27T10:10:00.000Z"
}
```

| Outcome                                                                       | Status                                     |
| ----------------------------------------------------------------------------- | ------------------------------------------ |
| Recorded                                                                      | `201`, `duplicate: false`                  |
| Same key, same payload                                                        | `200`, the stored trade, `duplicate: true` |
| Same key, different payload                                                   | `409 IDEMPOTENCY_CONFLICT`                 |
| Same `tradeId`, different key                                                 | `409 CONFLICT`                             |
| Seller and buyer are the same household                                       | `422`                                      |
| `totalAmount` is not `energyKwh × pricePerKwh`, rounded half up to 2 decimals | `422`                                      |
| Invalid decimal, currency other than `TRY`, unknown field                     | `400`                                      |
| No token / operator token                                                     | `401` / `403`                              |

### 🌐 GET /trades

Paged completed trades, newest first. Filters: `householdId` (seller or buyer),
`correlationId`.

### 🌐 GET /trades/:tradeId

One completed trade. `404` if it does not exist.

### 🌐 GET /trades/household/:householdId

Paged trades where the household is the seller or the buyer.

### 🌐 GET /balances/:householdId

```json
{ "householdId": "HH-SELLER-001", "balance": "19.00", "currency": "TRY", "updatedAt": "..." }
```

A household with no trades has a balance of `"0.00"` and `updatedAt: null`.
Billing keeps no household registry, so "never traded" and "unknown" are the
same answer.

### 🌐 GET /ledger/:householdId

Paged, append-only entries, newest first. Filter: `correlationId`.

```json
{
  "id": "clx...",
  "tradeId": "TRD-5F1A2B3C4D5E",
  "householdId": "HH-SELLER-001",
  "entryType": "CREDIT",
  "amount": "19.00",
  "currency": "TRY",
  "correlationId": "demo-flow-001",
  "createdAt": "..."
}
```

---

## Every service

### 🌐 GET /health/live · 🌐 GET /health

```json
{ "status": "ok", "service": "billing-ledger-service", "timestamp": "..." }
```

The process is running. Never checks a dependency. `/health` is the original
path and returns the same.

### 🌐 GET /health/ready

```json
{
  "status": "ready",
  "service": "smart-meter-service",
  "timestamp": "...",
  "checks": {
    "database": { "status": "up", "critical": true, "durationMs": 2 },
    "rabbitmq": { "status": "up", "critical": false, "durationMs": 0 }
  }
}
```

`200` when every critical dependency answers; `503` with `status: "not_ready"`
when one does not, or `status: "shutting_down"`. Not rate limited. See
[operations.md](operations.md#health-checks).
