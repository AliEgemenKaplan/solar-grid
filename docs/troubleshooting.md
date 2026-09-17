# Solar Grid - Troubleshooting

What a failure looks like from the outside, how to find its cause, and how to
recover. Commands assume the Docker stack from the repository root. The logs,
correlation ids and metrics used below are described in
[observability.md](observability.md); start-up and configuration problems are
in [operations.md](operations.md#troubleshooting).

```bash
C="docker compose -f infrastructure/docker-compose.yml"
```

## First look

```bash
$C ps -a                                              # healthy? restarting? exited?
for p in 3001 3002 3003 3004; do curl -s localhost:$p/health/ready; echo; done
docker exec solar-grid-rabbitmq rabbitmqctl list_queues name messages consumers
$C logs --since 10m --no-color | grep -E '"level":"(error|warn)"' | tail -50
```

`/health/ready` names the dependency that is down; the service log says why,
under `readiness.changed`.

## Telling the dependencies apart

| Readiness shows                                    | Log event                                                              | It is                     |
| -------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------- |
| `database: down` on one service                    | `readiness.changed`, `http.request.failed` with `dependency: database` | That service's PostgreSQL |
| `rabbitmq: down` on smart-meter and trade-matching | `readiness.changed`; `outbox.publish.failed` in smart-meter            | The broker                |
| everything ready, events retrying                  | `pricing.request.failed` in trade-matching                             | pricing-engine-service    |
| everything ready, trades `PENDING_BILLING`         | `billing.request.failed` in trade-matching                             | billing-ledger-service    |

Pricing and billing are deliberately not part of trade-matching's readiness:
one slow service should not take another out of rotation.

## Symptoms

### An API call answers 503

The body has `"code": "DOWNSTREAM_UNAVAILABLE"` and a `correlationId`.

1. Find the request: `$C logs --no-color | grep <correlationId>`. The
   `http.request.failed` line has a `dependency` field or, for a matching run,
   a `pricing.request.failed` line sits next to it.
2. `database`: check that service's PostgreSQL container and readiness.
   `pricing`: check `solar-grid-pricing-engine`.

Nothing was half done. A write refused for an unreachable database was rolled
back; a matching run refused for pricing reserved nothing. Send the request
again once readiness is back.

### /health/ready answers 503

`checks` says which dependency. Liveness (`/health/live`) stays 200 - the
process is fine - and `restart` would not help. See the recovery steps below
for the dependency named. A `status` of `shutting_down` means the service is
stopping on purpose.

### Messages are retrying

```bash
docker logs --since 10m solar-grid-trade-matching 2>&1 | grep '"message.retry.scheduled"'
docker exec solar-grid-rabbitmq rabbitmqctl list_queues name messages | grep retry
```

Each line has `reason`, `retry` and `delayMs`. A retry waits 2s, 4s, then 8s
(`RABBITMQ_RETRY_DELAY_MS`, doubling), and after `RABBITMQ_MAX_RETRIES` the
message is parked. The usual reason is pricing being down
(`pricing-engine-service is unavailable`) or the database refusing a write.
Fix the dependency; retries in progress then succeed on their own.

### The dead letter queue has messages

```bash
docker exec solar-grid-rabbitmq rabbitmqctl list_queues name messages | grep dlq
docker logs solar-grid-trade-matching 2>&1 | grep '"message.dead_lettered"'
```

Each `message.dead_lettered` line has the `reason`, the number of `retries`,
the `eventId` and the `correlationId`; the parked message carries the same in
its `x-failure-reason`, `x-retry-count` and `x-failed-at` headers (management UI
at http://localhost:15672, _Queues_ > `trade-matching.energy.dlq` > _Get
messages_).

- `unprocessable: ...` - the event itself is wrong. Retrying cannot fix it.
  Find the producer from `sourceEventId` and fix that.
- Anything else - the retries ran out while a dependency was down. By then the
  offer or request the event carried was usually already stored: check with
  `GET /offers?correlationId=` or `GET /requests?correlationId=`. If it is
  there, `POST /matching/run` with the operator token matches it; the parked
  message has nothing left to do. If it is not, republish it to the `solar-grid.energy` exchange under the routing key in its
  `x-original-routing-key` header - from the management UI's _Publish message_
  on that exchange, copying the payload, or with _Move messages_ if the
  `rabbitmq_shovel_management` plugin is enabled (it is not in this stack).
  That is safe: the consumer deduplicates on `eventId`.

### Trades are not matching

```bash
curl -s "localhost:3003/offers?status=OPEN"
curl -s "localhost:3003/requests?status=OPEN"
docker logs --since 10m solar-grid-trade-matching 2>&1 | grep '"matching.completed"' | tail -5
```

- `matching.completed` with `reason: no-candidates`: one side is empty. Check
  that smart-meter's events are arriving (`message.consumed`), and in
  smart-meter that they are being published (`outbox.event.published`,
  `solargrid_outbox_events_pending`).
- `reason: nothing-to-match`: the only candidates are a household trading with
  itself, which is skipped.
- `pricing.request.failed`: see _Messages are retrying_.
- No `message.consumed` at all: `list_queues name messages consumers` should show
  one consumer on `trade-matching.energy.queue`. With none, trade-matching is
  not ready - check its readiness.

Matching is first come, first served across the whole market: a buyer is
matched with the oldest open offer, which is not necessarily the offer from the
same demo run.

### Billing is not completing

```bash
curl -s "localhost:3003/matches?status=PENDING_BILLING"
docker logs --since 10m solar-grid-trade-matching 2>&1 | grep '"billing.request.failed"'
```

A trade whose billing call got no answer stays `PENDING_BILLING` with its energy
reserved - neither sold again nor given back - and its `failureReason` set.
Every matching run retries these first, with the same idempotency key, so
billing records each trade once however many times it is asked. Once billing is
ready again, the next event or `POST /matching/run` settles them.

A trade billing _refused_ (a 4xx) is `FAILED`, its energy released, with
`trade.failed` in the log - that is a data problem, not an outage.

### A service keeps restarting or will not start

```bash
$C logs --tail 30 <service>
```

`Refusing to start with an unsafe configuration` lists what to fix, by variable
name. `password authentication failed` or `role ... does not exist` points at a
volume older than its credentials - see [operations.md](operations.md#troubleshooting).

## Recovery

| What                    | How                                                                           | What happens                                                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Restart a service       | `$C restart trade-matching-service`                                           | It stops gracefully: stops consuming, finishes the message in hand, closes. Anything not acknowledged is redelivered and deduplicated.                         |
| Restart RabbitMQ        | `$C restart rabbitmq`                                                         | Queues and persistent messages survive. Services report not ready, reconnect on their own, and consume again; smart-meter publishes what waited in its outbox. |
| Restart a PostgreSQL    | `$C restart postgres-ledger`                                                  | Its service answers 503 and reports not ready meanwhile, then reconnects on its own. Nothing written before the restart is lost.                               |
| Settle stuck trades     | `POST /matching/run` with the operator token                                  | Retries `PENDING_BILLING` trades, then matches open offers and requests.                                                                                       |
| Replay a parked message | Republish it to `solar-grid.energy` with its original routing key (see above) | Processed like a redelivery; duplicates are ignored.                                                                                                           |
| Check the whole stack   | `bash scripts/resilience.sh`                                                  | Stops and starts every dependency and checks each recovery. It changes state: local stacks only.                                                               |

## What not to do

- **Do not edit the databases by hand** - not balances, not ledger entries, not
  trade statuses. The runtime roles cannot, on purpose; the owner can, and a
  hand-edited balance no longer matches its ledger. Recover through the service
  instead: retry the request, run matching, replay the event.
- **Do not purge `trade-matching.energy.queue` or the retry queues** to "unstick"
  things. They hold events that have not been processed yet; purging loses
  them. The dead letter queue is the place for inspection.
- **Do not change a trade's idempotency key** or re-send a trade to billing with
  a new one. The key is what makes a retry safe.
- **Do not delete a volume to fix an outage.** `pnpm docker:clean` erases every
  reading, trade and balance. It is for starting over, not for recovery.
- **Do not restart a service because readiness is 503.** Liveness is the
  question for restarts, and it stays 200: the service is waiting for its
  dependency and will recover when it does.
