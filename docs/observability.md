# Solar Grid - Observability

How to see what the system is doing: structured logs, the correlation id that
ties one operation together across services, and the metrics each service
exposes. For what to do when something is wrong, see
[troubleshooting.md](troubleshooting.md).

No monitoring stack is part of this repository. The logs are JSON lines any
log shipper can read, and the metrics are Prometheus text any scraper can
collect.

## Logs

Every service logs through one logger. In Docker (`NODE_ENV=production`) each
line is a JSON object; running a service locally gives readable lines instead.

```json
{
  "timestamp": "2026-09-18T10:12:03.418Z",
  "level": "info",
  "service": "trade-matching-service",
  "context": "MatchingService",
  "event": "trade.settled",
  "message": "Trade completed and recorded by billing",
  "tradeId": "TRD-5F1A2B3C4D5E",
  "idempotencyKey": "TRD-5F1A2B3C4D5E",
  "billingAttempt": 1,
  "energyKwh": "4.000",
  "totalAmount": "16.00",
  "currency": "TRY",
  "durationMs": 23,
  "correlationId": "demo-flow-001"
}
```

| Field                                                               | Always           | Meaning                                                       |
| ------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------- |
| `timestamp`                                                         | yes              | When the line was written, UTC                                |
| `level`                                                             | yes              | `trace`, `debug`, `info`, `warn`, `error`, `fatal`            |
| `service`                                                           | yes              | Which of the four services wrote it                           |
| `context`                                                           | usually          | The class that wrote it                                       |
| `event`                                                             | operational ones | A stable, dotted name for what happened - search on this      |
| `message`                                                           | usually          | The same thing in words                                       |
| `correlationId`                                                     | when known       | The operation it belongs to; see below                        |
| `eventId`, `sourceEventId`, `tradeId`, `attempt`, `durationMs`, ... | when relevant    | The identifiers and measurements for that event               |
| `error`                                                             | on failures      | `name`, `message`, `code` and, for unexpected errors, `stack` |

| Variable     | Default                                  | Values                                              |
| ------------ | ---------------------------------------- | --------------------------------------------------- |
| `LOG_FORMAT` | `json` in production, `pretty` elsewhere | `json`, `pretty`                                    |
| `LOG_LEVEL`  | `log` (info and above)                   | `verbose`, `debug`, `log`, `warn`, `error`, `fatal` |

### What is never logged

- `Authorization` headers, bearer tokens, passwords, API keys: fields with
  names like these are replaced with `[REDACTED]`, and so is the text after
  `Bearer`
- passwords inside connection strings (`postgresql://user:[REDACTED]@host`)
- the value of every token and password the service was given in its
  environment, wherever it would appear
- query strings and request or response bodies

Stack traces are logged for unexpected errors and never sent to a client.
Writing a log line never throws: a value that cannot be serialised produces a
`log.write_failed` line instead of an exception in a request or a consumer.

### Events

| Event                                                          | Service        | Level           | Key fields                                                    |
| -------------------------------------------------------------- | -------------- | --------------- | ------------------------------------------------------------- |
| `http.request.completed`                                       | all            | info¹           | `method`, `route`, `path`, `statusCode`, `durationMs`         |
| `http.request.failed`                                          | all            | warn/error      | `statusCode`, `errorCode`, `dependency` for 503s              |
| `http.request.aborted`                                         | all            | warn            | the client went away before the response                      |
| `auth.rejected`                                                | all            | warn            | `reason`, `required`, `presented`                             |
| `readiness.changed`                                            | all            | warn/info       | `dependency`, `status` (`down`/`up`), `reason`                |
| `service.started`, `service.start_failed`                      | all            | info/error      |                                                               |
| `shutdown.started`, `shutdown.completed`, `shutdown.timed_out` | all            | info/error      | `signal`, `durationMs`                                        |
| `reading.received`, `reading.duplicate`                        | smart-meter    | info            | `householdId`, `status`                                       |
| `outbox.event.created`, `outbox.event.published`               | smart-meter    | info            | `eventId`, `eventType`, `sourceEventId`, `attempts`           |
| `outbox.publish.failed`, `outbox.publish.unroutable`           | smart-meter    | warn/error      | `eventId`, `reason`                                           |
| `message.consumed`, `message.processed`                        | trade-matching | info            | `eventId`, `attempt`, `maxAttempts`, `redelivered`, `outcome` |
| `message.duplicate`                                            | trade-matching | info            | `eventId`                                                     |
| `message.retry.scheduled`                                      | trade-matching | warn            | `retry`, `delayMs`, `reason`                                  |
| `message.dead_lettered`                                        | trade-matching | error           | `retries`, `reason`                                           |
| `message.ack_lost`                                             | trade-matching | warn            | the broker connection closed mid-message; it is redelivered   |
| `offer.created`, `request.created`                             | trade-matching | info            | `householdId`, `energyKwh`                                    |
| `matching.started`, `matching.completed`                       | trade-matching | info            | `matched`, `failed`, `pending`, `settled`, `durationMs`       |
| `pricing.request.completed`, `pricing.request.failed`          | trade-matching | info/error      | `pricePerKwh`, `durationMs`, `reason`                         |
| `trade.reserved`                                               | trade-matching | info            | `tradeId`, `offerId`, `requestId`, `energyKwh`                |
| `trade.settled`, `trade.failed`, `billing.request.failed`      | trade-matching | info/error/warn | `tradeId`, `idempotencyKey`, `billingAttempt`                 |
| `settlement.completed`                                         | trade-matching | info            | trades left over from earlier runs, now settled               |
| `trade.recording`, `trade.recorded`, `trade.replayed`          | billing        | info            | `tradeId`, `idempotencyKey`, `totalAmount`                    |
| `trade.idempotency_conflict`                                   | billing        | warn            | `differingFields`                                             |
| `price.recalculated`, `pricing.rule.seeded`                    | pricing        | info            | `pricePerKwh`                                                 |

¹ Requests to `/health*` and `/metrics` are logged at debug level.

### Reading them

```bash
# everything one service said, as it happens
docker compose -f infrastructure/docker-compose.yml logs -f trade-matching-service

# one operation, across every service
docker compose -f infrastructure/docker-compose.yml logs --no-color | grep '"correlationId":"demo-flow-001"'

# with jq: only failures in the last ten minutes
docker logs --since 10m solar-grid-trade-matching 2>&1 \
  | jq -c 'select(.level == "error" or .level == "warn") | {timestamp, event, message, correlationId}'
```

## Correlation ids

One id follows an operation from the HTTP request that started it to the ledger
entries it produced.

```mermaid
flowchart LR
  client[client<br/>x-correlation-id, optional] --> sm[smart-meter<br/>reading, outbox row]
  sm -->|AMQP: correlationId property,<br/>x-correlation-id header, event body| tm[trade-matching<br/>offer / request]
  tm -->|x-correlation-id| pr[pricing<br/>GET /prices/current]
  tm -->|x-correlation-id + body| bl[billing<br/>trade, ledger entries]
```

- **Accepted or issued.** An `x-correlation-id` of 1-128 letters, digits,
  `.`, `_`, `:` or `-` is kept; anything else, or nothing, is replaced with a
  new UUID. Every response carries the id it was handled under.
- **Carried by the event.** smart-meter stores the id with the reading's
  outbox event and publishes it three ways: the AMQP `correlationId` property,
  the `x-correlation-id` header and the event body. Retries and dead-lettered
  copies keep it.
- **Stored with what it produced.** Offers, requests, trade matches, completed
  trades and ledger entries all have a `correlationId` column.
- **Logged.** Every operational log line about the operation has it.

A trade joins two operations - a seller's reading and a buyer's - so it takes
the id of the one that triggered the matching run that reserved it; the offer
and the request keep their own. A matching run started with
`POST /matching/run` uses that request's id. A trade settled on a later run
keeps its original id, and billing is always called with it, so billing's rows
match trade-matching's.

To follow one:

```bash
CID=demo-flow-001
curl -s "localhost:3003/offers?correlationId=$CID"
curl -s "localhost:3003/requests?correlationId=$CID"
curl -s "localhost:3003/matches?correlationId=$CID"
curl -s "localhost:3004/trades?correlationId=$CID"
docker compose -f infrastructure/docker-compose.yml logs --no-color | grep "$CID"
```

The event's own identifiers stay as they were: `eventId` identifies the event
and is what consumers deduplicate on; `sourceEventId` is the reading that
caused it.

## Metrics

Each service serves `GET /metrics` in Prometheus text format, to a caller
holding `METRICS_TOKEN`:

```bash
curl -s -H "Authorization: Bearer $(sed -n 's/^METRICS_TOKEN=//p' infrastructure/.env)" \
  localhost:3003/metrics
```

`401` without the token, `403` with any other token. The endpoint is read-only,
not rate limited, never cached, and exposes counts only: no identifiers,
payloads or secrets. Every series carries a `service` label.

| Metric                                             | Type      | Labels                      | Service        |
| -------------------------------------------------- | --------- | --------------------------- | -------------- |
| `solargrid_http_requests_total`                    | counter   | `method`, `route`, `status` | all            |
| `solargrid_http_request_duration_seconds`          | histogram | `method`, `route`           | all            |
| `solargrid_dependency_failures_total`              | counter   | `dependency`                | all            |
| `solargrid_dependency_up`                          | gauge     | `dependency`                | all            |
| `solargrid_readings_total`                         | counter   | `result`                    | smart-meter    |
| `solargrid_outbox_events_created_total`            | counter   |                             | smart-meter    |
| `solargrid_outbox_events_published_total`          | counter   |                             | smart-meter    |
| `solargrid_outbox_publish_failures_total`          | counter   | `reason`                    | smart-meter    |
| `solargrid_outbox_events_pending`                  | gauge     |                             | smart-meter    |
| `solargrid_messages_total`                         | counter   | `event_type`, `outcome`     | trade-matching |
| `solargrid_matching_runs_total`                    | counter   | `outcome`                   | trade-matching |
| `solargrid_trades_reserved_total`                  | counter   |                             | trade-matching |
| `solargrid_trade_billing_outcomes_total`           | counter   | `outcome`                   | trade-matching |
| `solargrid_offers_open`, `solargrid_requests_open` | gauge     |                             | trade-matching |
| `solargrid_trades_pending_billing`                 | gauge     |                             | trade-matching |
| `solargrid_settlements_total`                      | counter   | `outcome`                   | billing        |
| `solargrid_price_recalculations_total`             | counter   |                             | pricing        |

Label values come from fixed lists, so the number of series does not grow with
traffic:

- `route` is the route template (`/trades/:tradeId`), or `unmatched` for a path
  no route handles
- `dependency`: `database`, `rabbitmq`, `pricing`, `billing`
- `outcome` for messages: `processed`, `duplicate`, `retry_scheduled`,
  `dead_lettered`, `rejected`
- `outcome` for matching runs: `completed`, `pricing_unavailable`, `failed`
- `outcome` for billing: `settled`, `rejected` (billing refused the trade),
  `unknown` (no answer; the trade stays reserved)
- `outcome` for settlements: `recorded`, `replayed`, `idempotency_conflict`,
  `conflict`, `rejected`

`dependency_up` is updated whenever readiness is probed, which compose does
every 15 seconds. The three trade-matching gauges and `outbox_events_pending`
are counted in the database on each scrape; if the database is down they keep
their last value.

Recording a metric never fails the operation it measures: every write is
wrapped, and the first failure is logged as `metrics.record_failed`.

### The same counters, for the operator

`GET /diagnostics` on every service returns the same counters as JSON, to a
caller holding the **operator** token, for the operator dashboard's System
view. `/metrics` stays with the metrics token: a scraper still cannot read
anything else, and the operator - who can already read every statistic - does
not need the scraper's token to see how the services are doing.

```json
{
  "service": "trade-matching-service",
  "countingSince": "2026-09-19T13:38:02.000Z",
  "generatedAt": "2026-09-19T14:02:11.000Z",
  "metrics": [
    {
      "name": "messages_total",
      "help": "Energy events handled, by event type and outcome.",
      "type": "counter",
      "series": [
        { "labels": { "event_type": "EnergySurplusDetected", "outcome": "processed" }, "value": 12 }
      ]
    }
  ]
}
```

Names lose the `solargrid_` prefix and series lose the `service` label.
Histograms are reduced to how many observations there were (`value`) and their
total (`sum`). The labels are the same bounded ones as above: never an
identifier, a payload or a secret. Every counter starts from zero when the
service starts, so `countingSince` says what they count from.

### Scraping them

Any Prometheus-compatible scraper works. With Prometheus itself, not included
here:

```yaml
scrape_configs:
  - job_name: solar-grid
    authorization:
      credentials_file: /etc/prometheus/solar-grid-metrics-token
    static_configs:
      - targets:
          - smart-meter-service:3001
          - pricing-engine-service:3002
          - trade-matching-service:3003
          - billing-ledger-service:3004
```

Useful questions to ask of them:

| Question                              | Expression                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| Is anything being parked?             | `increase(solargrid_messages_total{outcome="dead_lettered"}[15m]) > 0`         |
| Are events piling up in the outbox?   | `solargrid_outbox_events_pending > 0` for several minutes                      |
| Are trades stuck waiting for billing? | `solargrid_trades_pending_billing > 0` for several minutes                     |
| Which dependency is failing?          | `sum by (service, dependency) (rate(solargrid_dependency_failures_total[5m]))` |
| Error rate                            | `sum(rate(solargrid_http_requests_total{status=~"5.."}[5m]))`                  |
