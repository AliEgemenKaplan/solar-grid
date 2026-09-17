# Solar Grid - API Security and Conventions

Every HTTP service is configured by one function, `configureHttpApp` in
`packages/nest-common`, so authentication, validation, errors, headers, CORS
and Swagger behave identically across the four services.

## Who may call what

There is no user identity in this system. There are three kinds of caller, and
each endpoint is deliberately assigned to one of them.

| Caller                     | Credential                                  | Used for                                   |
| -------------------------- | ------------------------------------------- | ------------------------------------------ |
| Anyone                     | none                                        | Reads, and submitting meter readings       |
| Operator                   | `Authorization: Bearer $OPERATOR_API_TOKEN` | Actions that change how the market behaves |
| Another Solar Grid service | `Authorization: Bearer $INTERNAL_API_TOKEN` | Writing to the ledger                      |
| A metrics scraper          | `Authorization: Bearer $METRICS_TOKEN`      | Reading `/metrics`, and nothing else       |

### Every endpoint

| Service        | Endpoint                                                                    | Access                         | Why                                                                                                                  |
| -------------- | --------------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| smart-meter    | `POST /readings`                                                            | public, write rate limit       | Meters report here; there is no meter identity in this project, so it is rate limited and strictly validated instead |
| smart-meter    | `GET /readings/:householdId`                                                | public                         |                                                                                                                      |
| smart-meter    | `GET /households`                                                           | public                         |                                                                                                                      |
| smart-meter    | `GET /households/:householdId/status`                                       | public                         |                                                                                                                      |
| pricing        | `GET /prices/current`                                                       | public                         | Trade-matching reads it; so will the dashboard                                                                       |
| pricing        | `GET /prices/history`                                                       | public                         |                                                                                                                      |
| pricing        | `POST /prices/recalculate`                                                  | **operator**, write rate limit | Changes what every subsequent trade costs                                                                            |
| trade-matching | `POST /matching/run`                                                        | **operator**, write rate limit | Triggers settlement and matching on demand                                                                           |
| trade-matching | `GET /matches`, `GET /matches/:tradeId`                                     | public                         |                                                                                                                      |
| trade-matching | `GET /offers`, `GET /requests`                                              | public                         |                                                                                                                      |
| billing        | `POST /trades`                                                              | **internal service**           | Moves money; only trade-matching may record a trade                                                                  |
| billing        | `GET /trades`, `GET /trades/:tradeId`, `GET /trades/household/:householdId` | public                         |                                                                                                                      |
| billing        | `GET /balances/:householdId`, `GET /ledger/:householdId`                    | public                         |                                                                                                                      |
| all            | `GET /health`, `/health/live`, `/health/ready`                              | public, not rate limited       |                                                                                                                      |
| all            | `GET /metrics`                                                              | **metrics**, not rate limited  | Operational counts; see [observability.md](observability.md#metrics)                                                 |

That is every mutation in the system: one public and rate limited, two for
operators, one for services. `/metrics` is the one read that is not public: it
describes the service's inside rather than the market. Reads are public because the dashboard planned for
phase 7 runs in a browser, and a browser can never be given either token.

### Authentication and authorization

```
no Authorization header, or not "Bearer <token>"  → 401 UNAUTHENTICATED
a token that matches no configured token          → 401 UNAUTHENTICATED
a valid token for the other role                  → 403 FORBIDDEN
the token the route requires                      → allowed
```

Credentials are checked before the request body is validated, so an
unauthenticated caller learns nothing about what a valid body looks like.

- Tokens come from the environment only. Nothing in the source contains one.
- Every configured token is compared on every request, in constant time, over
  SHA-256 digests, so response timing reveals neither how close a guess was nor
  which token it nearly matched.
- A token is never logged, echoed or included in an error body. Tests assert it.
- A missing token fails closed: the route refuses every request.
- At startup each service warns about the tokens it uses that are missing,
  shorter than 32 characters, identical to each other, or still the development
  default while `NODE_ENV=production`.

### Service to service

trade-matching sends `INTERNAL_API_TOKEN` when it records a trade with billing.
Each service only receives the tokens it needs:

| Service        | `OPERATOR_API_TOKEN` | `INTERNAL_API_TOKEN` | `METRICS_TOKEN` |
| -------------- | -------------------- | -------------------- | --------------- |
| smart-meter    | -                    | -                    | checks          |
| pricing        | checks               | -                    | checks          |
| trade-matching | checks               | sends                | checks          |
| billing        | -                    | checks               | checks          |

The metrics token has its own principal so that a scraper - and every service
that must recognise it - never holds a token that could trigger a matching run
or record a trade.

A shared bearer token is the minimum that separates "a Solar Grid service" from
"anyone on the network". It does not identify _which_ service is calling, and
it is not mTLS; both are reasonable next steps in a real deployment and out of
scope here. `GET /prices/current` stays public rather than requiring the
service token, since the price is not secret and the dashboard needs it too.

## Validation

A global `ValidationPipe` runs on every request with `whitelist`,
`forbidNonWhitelisted` and `transform`:

- Unknown fields are **rejected**, not dropped. A client that sends `status`
  to `POST /trades` hoping to set it gets a 400.
- Path parameters are validated through DTOs. Household and trade ids must be
  1-64 characters of letters, digits, `.`, `_`, `:` or `-`.
- Query parameters are converted and bounded; `?limit=abc` is a 400.
- Enum filters (`?status=`) must be one of the documented values, exact case.
- Correlation ids, in a header or a filter, must be 1-128 characters from the
  same alphabet. In a header an unusable one is replaced; in a filter it is a 400.

### Decimal amounts

Where money crosses a boundary (`POST /trades`) amounts are decimal strings,
validated by `@DecimalAmountField`, which also generates the OpenAPI schema so
the documentation cannot disagree with the check.

| Rejected                                   | Example                            |
| ------------------------------------------ | ---------------------------------- |
| A JSON number                              | `4`                                |
| Empty                                      | `""`                               |
| Not a number                               | `"NaN"`, `"Infinity"`, `"four"`    |
| Exponent, sign, separators, empty fraction | `"4e3"`, `"+4"`, `"1,000"`, `"4."` |
| Surrounding whitespace                     | `" 4.000"`                         |
| More precision than the column stores      | `"4.0001"` for energy              |
| Out of range                               | `"-1.000"`, `"0.000"` for energy   |

Meter readings and pricing aggregates remain JSON numbers (they come from
instruments), with `maxDecimalPlaces`, bounds, and NaN and Infinity refused.

The database constraints from phase 2 still apply; validation refuses the same
things earlier, with a message that names the field.

## Error responses

Every error, from every service, has this shape:

```json
{
  "statusCode": 409,
  "code": "IDEMPOTENCY_CONFLICT",
  "message": "This idempotency key was already used for a different trade.",
  "correlationId": "demo-flow-001",
  "timestamp": "2026-09-16T10:15:30.000Z",
  "path": "/trades",
  "details": ["energyKwh differs from the recorded trade"]
}
```

- `code` is what a client branches on. `message` is for people.
- `correlationId` is the id this request was logged under; quote it to find
  every log line from every service it touched.
- `details` appears for validation failures and a few business rules.
- A 5xx says only "The request could not be completed." The exception, stack
  trace and anything it mentions - SQL, hosts, credentials - go to the log
  under the same correlation id, never to the client. A Prisma unique
  violation becomes a 409 without naming the constraint.

## Status codes

| Status | `code`                    | When                                                                                                                           |
| ------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 200    | -                         | A read; a command that creates nothing (`POST /matching/run`); an idempotent replay                                            |
| 201    | -                         | Something was created (`POST /readings`, `POST /trades`, `POST /prices/recalculate`)                                           |
| 400    | `VALIDATION_FAILED`       | The request does not match the schema                                                                                          |
| 401    | `UNAUTHENTICATED`         | Missing or unrecognised credentials                                                                                            |
| 403    | `FORBIDDEN`               | Recognised credentials, wrong role                                                                                             |
| 404    | `NOT_FOUND`               | The resource does not exist                                                                                                    |
| 409    | `IDEMPOTENCY_CONFLICT`    | The same idempotency key with a different payload                                                                              |
| 409    | `CONFLICT`                | The request would duplicate something, e.g. a trade id under a different key                                                   |
| 422    | `BUSINESS_RULE_VIOLATION` | Well formed but impossible: a household trading with itself, a total that is not energy times price, a reading from the future |
| 429    | `RATE_LIMITED`            | Too many requests from this address                                                                                            |
| 500    | `INTERNAL_ERROR`          | A bug or an unexpected failure                                                                                                 |
| 503    | `DOWNSTREAM_UNAVAILABLE`  | A service this request depends on did not answer                                                                               |

The line between 400 and 422: if the request could be rejected by looking at it
alone, it is a 400. If it takes a rule of the domain to see the problem, it is
a 422.

`POST /matching/run` returns 503 when pricing does not answer. The price is
fetched before any energy is reserved, so nothing is left half done and the run
can be retried. If billing does not answer, the run still returns 200: trades
are reserved as `PENDING_BILLING` and settled on a later run, which is the
phase 1 reserve, bill, confirm flow working as designed.

## Idempotency conflicts

`POST /trades` is idempotent on `idempotencyKey`, and the key is bound to the
request it was first used with:

```
same key, same payload        → 200, the stored trade, duplicate: true
same key, different payload   → 409 IDEMPOTENCY_CONFLICT, details name the fields
same tradeId, different key   → 409 CONFLICT
new key                       → 201, recorded
```

"Same payload" is decided by a SHA-256 fingerprint of a canonical form of the
trade, stored in `idempotency_keys.requestHash`:

- decimals at their column scale, so `"4"` and `"4.000"` are the same
- the completion time in UTC, so `+03:00` and `Z` offsets of one instant match
- a fixed field order, so JSON key order is irrelevant
- the correlation id left out: it identifies the caller's trace, not the trade

A key recorded before hashing existed has no hash and is treated as a replay.
Two identical requests arriving at the same moment still settle once; the
unique index decides, and the loser gets the replay answer.

## Pagination

Every list is paged:

```
GET /trades?page=2&limit=25
```

```json
{ "items": [], "page": 2, "limit": 25, "total": 123 }
```

- `page` defaults to 1 and may not exceed 10000.
- `limit` defaults to 50 and may not exceed 100.
- Out of range is a 400, not a silent clamp: `limit=999999` is refused.
- Order is newest first with the id as a tie breaker, so a page never repeats
  or skips a row between requests.
- Every filter and ordering is served by an index. `total` is a `COUNT` over
  the same filter; the tables are small, and a table that grew into millions of
  rows would move to cursor pagination rather than keep counting.

| Endpoint                             | Filters                        |
| ------------------------------------ | ------------------------------ |
| `GET /households`                    | `status`                       |
| `GET /readings/:householdId`         | -                              |
| `GET /prices/history`                | -                              |
| `GET /matches`                       | `status`, `correlationId`      |
| `GET /offers`, `GET /requests`       | `status`, `correlationId`      |
| `GET /trades`                        | `householdId`, `correlationId` |
| `GET /trades/household/:householdId` | -                              |
| `GET /ledger/:householdId`           | `correlationId`                |

Following one reading through the system is a matter of passing its
correlation id to `/offers`, `/requests`, `/matches`, `/trades` and `/ledger`.

## Swagger

| Environment                               | Swagger                       |
| ----------------------------------------- | ----------------------------- |
| `NODE_ENV` unset, `development` or `test` | on, at `/api` and `/api-json` |
| `NODE_ENV=production`                     | off                           |
| `SWAGGER_ENABLED=true` or `false`         | wins, in either direction     |

The Docker stack runs with `NODE_ENV=production`, so Swagger is off there unless
`SWAGGER_ENABLED=true` is set in `infrastructure/.env`. When it is on, the
document declares both bearer schemes, marks which operations need which, and
types every decimal field as a string.

## Rate limiting

`@nestjs/throttler`, in memory, per client address and per route:

| Setting                                        | Default        | Applies to                                                         |
| ---------------------------------------------- | -------------- | ------------------------------------------------------------------ |
| `RATE_LIMIT_MAX` per `RATE_LIMIT_TTL_MS`       | 300 per minute | Every route                                                        |
| `RATE_LIMIT_WRITE_MAX` per `RATE_LIMIT_TTL_MS` | 60 per minute  | `POST /readings`, `POST /matching/run`, `POST /prices/recalculate` |
| `RATE_LIMIT_ENABLED`                           | `true`         | Set to `false` to switch it off                                    |

Requests carrying the internal service token are exempt: public traffic must
not be able to stop trade-matching from settling trades with billing.

Only HTTP is limited. Nest runs global guards and filters in front of RabbitMQ
handlers too, so the rate limit guard skips anything that is not an HTTP
request, and the error filter hands a consumer's exception back unchanged to
the retry and dead letter handling in [reliability.md](reliability.md). The
messaging integration tests boot the consumer with this wiring for that reason.

The counters live in each process. That is right for one instance per service,
which is how this stack runs; several instances would need a shared store.

## Security headers and CORS

- Helmet sets its standard headers (`X-Content-Type-Options: nosniff`, frame and
  referrer policies, HSTS, and so on) and removes `X-Powered-By`. The content
  security policy is only relaxed while Swagger UI is being served.
- CORS is **off** by default. The frontend is planned to be served from the
  same origin as the API, which needs no CORS at all. For local development
  against a separate dev server, list origins in `CORS_ALLOWED_ORIGINS`. A `*`
  is ignored with a warning rather than honoured.

## Calling the API locally

The Docker stack uses the tokens `pnpm env:init` generated in
`infrastructure/.env`:

```bash
OPERATOR=$(sed -n 's/^OPERATOR_API_TOKEN=//p' infrastructure/.env)

# 401: no token
curl -i -X POST http://localhost:3003/matching/run

# 200: operator
curl -s -X POST http://localhost:3003/matching/run \
  -H "Authorization: Bearer $OPERATOR"

# public read, paged and filtered
curl -s "http://localhost:3003/matches?status=COMPLETED&limit=10"
```

## Configuration

| Variable               | Default                      | Services                |
| ---------------------- | ---------------------------- | ----------------------- |
| `OPERATOR_API_TOKEN`   | none; required in production | pricing, trade-matching |
| `INTERNAL_API_TOKEN`   | none; required in production | trade-matching, billing |
| `METRICS_TOKEN`        | none; required in production | all                     |
| `SWAGGER_ENABLED`      | on outside production        | all                     |
| `CORS_ALLOWED_ORIGINS` | empty                        | all                     |
| `RATE_LIMIT_ENABLED`   | `true`                       | all                     |
| `RATE_LIMIT_TTL_MS`    | `60000`                      | all                     |
| `RATE_LIMIT_MAX`       | `300`                        | all                     |
| `RATE_LIMIT_WRITE_MAX` | `60`                         | all                     |
