# Solar Grid - Statistics API

Every service answers `GET /stats/...` for the data it owns. The endpoints are
read-only: they run SELECTs and nothing else, and no statistics endpoint can
change a reading, a trade, a price or a ledger entry.

Authentication, the error body, pagination and rate limits work exactly as
[api-security.md](api-security.md) describes; this document covers what the
statistics endpoints add on top.

## Where the numbers come from

Each service keeps its own database, so each answers for its own half of the
story and nothing is copied into a reporting database:

| Service               | Endpoints                                              | Answers                                                            |
| --------------------- | ------------------------------------------------------ | ------------------------------------------------------------------ |
| smart-meter (3001)    | `/stats/summary`, `/stats/households`, `/stats/trends` | What the meters recorded: production, consumption, surplus, demand |
| pricing (3002)        | `/stats/summary`, `/stats/trends`                      | What the price did, and the supply and demand behind it            |
| trade-matching (3003) | `/stats/summary`, `/stats/households`, `/stats/trends` | What was offered, what was wanted, what traded and at what price   |
| billing (3004)        | `/stats/summary`, `/stats/households`, `/stats/trends` | What was settled, what the ledger holds, where the balances stand  |

A dashboard that wants one overview asks all four and puts the answers side by
side. That is deliberate: a single cross-service summary would mean one service
calling the other three on every request, which adds failure modes to a read
that is only ever informational. See
[Known limitations](#known-limitations).

## Authentication

Every statistics endpoint requires the **operator** token:

```bash
curl -H "Authorization: Bearer $OPERATOR_API_TOKEN" \
  "http://localhost:3003/stats/summary"
```

- no token, or one nobody recognises → `401 UNAUTHENTICATED`
- the internal service or metrics token → `403 FORBIDDEN`
- the operator token → `200`

A single household's own readings, trades, balance and ledger stay as public as
they were. These endpoints are different in kind: they describe the whole
neighbourhood's energy and money, which is commercial information about people
who did not ask to be aggregated.

## The window: `from` and `to`

Both are optional, both are UTC, and the window is **half open**: `from` is
included and `to` is excluded. Two adjacent windows therefore tile without
counting a row twice.

| Query                                                | Covers                                       |
| ---------------------------------------------------- | -------------------------------------------- |
| _(neither)_                                          | everything recorded                          |
| `?from=2026-05-27`                                   | from midnight UTC on the 27th until now      |
| `?from=2026-05-27&to=2026-05-28`                     | the 27th, all of it, and nothing of the 28th |
| `?from=2026-05-27T10:00:00Z&to=2026-05-27T11:00:00Z` | one hour                                     |

Accepted forms: a date (`2026-05-27`, meaning midnight UTC), or a date and time
with an explicit offset (`2026-05-27T10:00:00Z`, `2026-05-27T13:00:00+03:00`).

A time **without** an offset (`2026-05-27T10:00:00`) is refused with `400`.
JavaScript reads that as local time and PostgreSQL as UTC, so accepting it would
mean the same query returning different numbers depending on where it was typed.

Which column the window applies to:

| Service        | Column                                                    |
| -------------- | --------------------------------------------------------- |
| smart-meter    | `timestamp`, when the meter took the reading              |
| pricing        | `createdAt`, when the price was calculated                |
| trade-matching | `createdAt`, when the trade, offer or request was created |
| billing        | `completedAt` for trades, `createdAt` for ledger entries  |

Some figures have no window by nature and say so in the response: the offer and
request **state** in the trade summary and the **balances** in the billing
summary are as they stand now. The window selects which rows are looked at, not
what their current status is.

## Limits

| Limit                                                           | Response                      |
| --------------------------------------------------------------- | ----------------------------- |
| `from` later than or equal to `to`                              | `422 BUSINESS_RULE_VIOLATION` |
| a window with a `from` wider than 366 days                      | `422 BUSINESS_RULE_VIOLATION` |
| a trend needing more than 744 hour, 366 day or 105 week buckets | `422 BUSINESS_RULE_VIOLATION` |
| `limit` above 100, `page` above 10000                           | `400 VALIDATION_FAILED`       |

A request with no `from` reads the whole history, which is deliberate: an
aggregate is one indexed pass and returns one row however much it covers. The
366 day ceiling exists so a caller who does name a window cannot ask for one
that has to be scanned a year at a time and then split into buckets.

## Trends

`GET /stats/trends?bucket=hour|day|week&from=&to=`

- `bucket` defaults to `day`; anything else is `400`.
- The window is aligned outward to whole buckets, exactly as PostgreSQL's
  `date_trunc` does, and a week starts on **Monday**.
- With no window, a trend covers the last 24 hours, 30 days or 12 weeks.
- **Every** bucket in the window is returned, oldest first. A bucket nothing
  happened in reports zeros - and a null average - rather than being left out,
  so a chart shows the quiet hours instead of drawing through them.

```bash
curl -H "Authorization: Bearer $OPERATOR_API_TOKEN" \
  "http://localhost:3003/stats/trends?bucket=day&from=2026-05-25&to=2026-06-01"
```

## Decimals

Energy, prices and money are decimal strings, at the same scales as the rest of
the API: energy `"15.000"`, prices `"4.0000"`, money `"65.00"`. PostgreSQL sums
and averages the exact `numeric` columns, and the only arithmetic done outside
the database - the volume weighted price - is decimal division. No energy or
money is ever a JavaScript number on the way through.

A **sum** over no rows is `"0.000"`: adding nothing up is honestly zero. An
**average, minimum or maximum** over no rows is `null`, because there was no
price. A client that charts `averagePricePerKwh` must expect nulls.

---

## smart-meter - energy

### `GET /stats/summary`

```json
{
  "range": { "from": "2026-05-27T00:00:00.000Z", "to": "2026-05-28T00:00:00.000Z" },
  "readings": 4,
  "households": 3,
  "productionKwh": "22.500",
  "consumptionKwh": "14.250",
  "netKwh": "8.250",
  "surplusKwh": "12.250",
  "demandKwh": "4.000",
  "firstReadingAt": "2026-05-27T00:30:00.000Z",
  "lastReadingAt": "2026-05-27T03:10:00.000Z"
}
```

`surplusKwh` and `demandKwh` are the positive and negative halves of the net,
counted separately: a neighbourhood that both offers and needs 10 kWh is not
the same as one that did nothing, and adding them would make it look that way.

### `GET /stats/households`

Paged, one row per household with readings in the window, biggest producer
first, ties broken by `householdId`. Supports `?householdId=`.

```json
{
  "items": [
    {
      "householdId": "HH-A",
      "readings": 3,
      "productionKwh": "13.000",
      "consumptionKwh": "16.000",
      "netKwh": "-3.000",
      "surplusKwh": "6.000",
      "demandKwh": "9.000",
      "firstReadingAt": "2026-05-27T00:30:00.000Z",
      "lastReadingAt": "2026-05-28T01:00:00.000Z"
    }
  ],
  "page": 1,
  "limit": 50,
  "total": 3
}
```

### `GET /stats/trends`

Buckets of `readings`, `households`, `productionKwh`, `consumptionKwh`,
`netKwh`.

---

## pricing - prices

### `GET /stats/summary`

```json
{
  "range": { "from": null, "to": null },
  "snapshots": 3,
  "averagePricePerKwh": "4.0000",
  "minPricePerKwh": "2.0000",
  "maxPricePerKwh": "6.0000",
  "averageSupplyKwh": "40.000",
  "averageDemandKwh": "43.333",
  "latest": {
    "pricePerKwh": "6.0000",
    "supplyKwh": "30.000",
    "demandKwh": "60.000",
    "calculatedAt": "2026-05-28T01:00:00.000Z"
  },
  "band": {
    "basePrice": "4.0000",
    "minPrice": "2.5000",
    "maxPrice": "7.0000",
    "currency": "TRY"
  }
}
```

`band` is the active pricing rule as it stands now, so a price can be read
against the rule that produced it. `latest` is the newest snapshot **in the
window**, and is null when the window has none.

### `GET /stats/trends`

Buckets of `snapshots`, `averagePricePerKwh`, `minPricePerKwh`,
`maxPricePerKwh`, `averageSupplyKwh`, `averageDemandKwh`.

---

## trade-matching - the market

### `GET /stats/summary`

```json
{
  "range": { "from": null, "to": null },
  "currency": "TRY",
  "households": 4,
  "trades": { "total": 4, "completed": 2, "pendingBilling": 1, "failed": 1 },
  "completed": {
    "energyKwh": "15.000",
    "volume": "65.00",
    "averagePricePerKwh": "4.5000",
    "volumeWeightedPricePerKwh": "4.3333",
    "minPricePerKwh": "4.0000",
    "maxPricePerKwh": "5.0000"
  },
  "pending": { "energyKwh": "2.000", "volume": "6.00" },
  "offers": {
    "total": 4,
    "open": 1,
    "partiallyMatched": 2,
    "matched": 1,
    "cancelled": 0,
    "totalKwh": "27.000",
    "matchedKwh": "17.000",
    "openKwh": "10.000"
  },
  "requests": { "...": "the same shape" }
}
```

- `averagePricePerKwh` is the mean price of a trade; `volumeWeightedPricePerKwh`
  is `volume / energyKwh`, what the neighbourhood actually paid per kWh. They
  differ whenever trades were different sizes, and both are worth having.
- `matchedKwh` / `openKwh` are the matched and unmatched energy: what an offer
  or request was opened with, how much of it has traded, and how much is still
  on the table.
- `pending` is energy reserved on a trade whose billing answer has not arrived.
  It is neither traded nor available.

### `GET /stats/households`

Paged, one row per household that **completed** a trade in the window, most
money moved first, ties broken by `householdId`. Supports `?householdId=`,
which matches whichever side of the trade the household was on.

```json
{
  "items": [
    {
      "householdId": "HH-A",
      "tradesAsSeller": 1,
      "tradesAsBuyer": 0,
      "soldKwh": "10.000",
      "boughtKwh": "0.000",
      "sellVolume": "40.00",
      "buyVolume": "0.00",
      "netVolume": "40.00",
      "lastTradeAt": "2026-05-27T00:30:00.000Z"
    }
  ],
  "page": 1,
  "limit": 50,
  "total": 4
}
```

Reserved and failed trades are left out: energy that has not settled is not
trading yet, and energy that was refused went back to the offer it came from.

### `GET /stats/trends`

Buckets of `trades` (created, whatever their outcome), `completed`,
`energyKwh`, `volume` and `averagePricePerKwh` over the completed ones.

---

## billing - money

### `GET /stats/summary`

```json
{
  "range": { "from": null, "to": null },
  "currency": "TRY",
  "trades": {
    "trades": 2,
    "energyKwh": "15.000",
    "volume": "65.00",
    "averagePricePerKwh": "4.5000",
    "volumeWeightedPricePerKwh": "4.3333",
    "minPricePerKwh": "4.0000",
    "maxPricePerKwh": "5.0000",
    "households": 3
  },
  "ledger": {
    "entries": 4,
    "credited": "65.00",
    "debited": "65.00",
    "net": "0.00",
    "households": 3
  },
  "balances": {
    "households": 4,
    "inCredit": 2,
    "inDebit": 1,
    "settled": 1,
    "totalCredit": "65.00",
    "totalDebit": "65.00"
  }
}
```

- Billing records a trade and writes its two ledger entries in one transaction,
  so **billed and settled are the same moment here**. `trades.volume` is both
  the total billed and the total settled; there is no separate settlement step
  to count.
- `ledger.net` is credits minus debits and is `"0.00"` in a healthy ledger:
  every trade credits one household exactly what it debits another. Anything
  else means entries are missing, and it is on the response rather than assumed.
- `balances` is current, whatever window was asked for.

Trades that billing **refused** are not here: they never became a completed
trade, and they are counted by trade-matching as `trades.failed`.

### `GET /stats/households`

Paged, one row per household with ledger entries in the window, most money
moved first. A trade writes one entry per side, so a household with eight
entries was in eight trades.

```json
{
  "items": [
    {
      "householdId": "HH-B",
      "entries": 2,
      "credits": 0,
      "debits": 2,
      "credited": "0.00",
      "debited": "65.00",
      "net": "-65.00",
      "firstEntryAt": "2026-05-27T00:30:00.000Z",
      "lastEntryAt": "2026-05-28T02:30:00.000Z"
    }
  ],
  "page": 1,
  "limit": 50,
  "total": 3
}
```

### `GET /stats/trends`

Buckets of `trades`, `energyKwh`, `volume` and `averagePricePerKwh`, by when
each trade completed.

---

## Errors

The usual contract, with `correlationId`, and never a SQL error, a hostname or
a stack trace:

| Status | Code                      | When                                                                                             |
| ------ | ------------------------- | ------------------------------------------------------------------------------------------------ |
| 400    | `VALIDATION_FAILED`       | A malformed bound, an unknown bucket, a bad household id, a parameter the endpoint does not have |
| 401    | `UNAUTHENTICATED`         | No token, or one nobody recognises                                                               |
| 403    | `FORBIDDEN`               | A recognised token belonging to another role                                                     |
| 422    | `BUSINESS_RULE_VIOLATION` | A backwards window, one wider than the limit, too many buckets                                   |
| 429    | `RATE_LIMITED`            | Too many requests                                                                                |
| 503    | `DOWNSTREAM_UNAVAILABLE`  | The database did not answer                                                                      |

```json
{
  "statusCode": 422,
  "code": "BUSINESS_RULE_VIOLATION",
  "message": "from must be earlier than to.",
  "correlationId": "demo-001",
  "timestamp": "2026-09-18T10:15:30.000Z",
  "path": "/stats/summary?from=2026-06-01&to=2026-05-01"
}
```

## How the queries run

- One SQL aggregate per figure, using `FILTER`, `date_trunc` and `UNION ALL`
  where the shape needs it. Nothing loads rows into Node to add them up, and no
  endpoint issues a query per household.
- Every value is a bound parameter. Bounds are sent as text and cast to
  `timestamp` in SQL, so a comparison means the same thing whatever time zone
  the database session or the Node process is in.
- Paged endpoints do their paging and their counting in SQL, with the same
  `?page=&limit=` contract and ordering rules as every other list in the API.
- The queries run as `solargrid_app`, the same least privileged role as the
  rest of the service: `SELECT` on the tables it already had, no new grants.

Indexes added for them: `meter_readings(timestamp)`,
`trade_matches(createdAt)`, `trade_matches(sellerHouseholdId)`,
`trade_matches(buyerHouseholdId)`, `completed_trades(completedAt)` and
`ledger_entries(createdAt)`. Each one serves a window or filter the existing
indexes could not, because those start with the household.

With a demo's worth of rows the planner still chooses a sequential scan, which
is the faster plan at that size; the indexes are there for when the tables are
not a demo.

## Known limitations

- **No single cross-service overview.** Each service answers for its own
  database; combining them is the caller's job. One service calling the other
  three would make an informational read depend on three more processes.
- **Counted, not reconciled.** trade-matching and billing count trades from
  their own tables, and the two totals are not meant to be equal. A trade
  reserved but not yet settled is `pendingBilling` in one and absent from the
  other; a trade recorded straight through `POST /trades` by an internal
  caller - as the demo's idempotency check does - is in billing's totals and
  was never matched at all. Each service answers for what it did.
- **Household statistics are derived, not registered.** There is no household
  registry in this system; a household exists because it reported a reading or
  traded. A household that has done neither in the window is simply absent, and
  billing's per-household figures come from ledger entries, so they cover
  households that have traded and no others.
- **Single currency.** Amounts are summed across rows and the currency is read
  back from them. The system is TRY throughout; mixed currencies would need the
  sums to be grouped by currency first.
- **Counts are exact, not cached.** Every request runs its aggregates against
  the live tables. That is right at this size and would need revisiting - a
  materialised view, a summary table - long before a neighbourhood became a
  city.
- **`/stats/trends` has no timezone parameter.** Buckets are UTC. A dashboard
  that wants local days has to ask for the hours and add them up itself.
