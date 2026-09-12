# Solar Grid — API Contracts

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
  "productionKwh": 8.5,
  "consumptionKwh": 3.2,
  "netKwh": 5.3,
  "status": "SURPLUS",
  "surplusKwh": 5.3,
  "demandKwh": 0,
  "timestamp": "2026-05-27T10:00:00.000Z",
  "createdAt": "2026-05-27T10:00:01.000Z"
}
```

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
  "currentSurplusKwh": 5.3,
  "currentDemandKwh": 0,
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
  "pricePerKwh": 3.2,
  "currency": "TRY",
  "calculatedAt": "2026-05-27T10:05:00.000Z",
  "supplyKwh": 50,
  "demandKwh": 40
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
  "energyKwh": 4,
  "pricePerKwh": 4.75,
  "totalAmount": 19,
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
{ "householdId": "HH-SELLER-001", "balance": 19, "currency": "TRY", "updatedAt": "..." }
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
Manually trigger FIFO matching.
**Response (201):**
```json
{ "matched": 1, "failed": 0, "skipped": 0 }
```

### GET /health
