# Solar Grid - Event Flow

How an event is created, how it crosses RabbitMQ, what happens when it fails,
and how it ends up in the dead letter queue.

## The happy path

```
POST /readings
   │
   ▼
smart-meter-service ── one transaction ──▶ meter_readings + household_energy_status + outbox_events
   │
   │ outbox publisher (immediately, and every OUTBOX_POLL_INTERVAL_MS)
   ▼
solar-grid.energy  (topic, durable)
   │   routing key: energy.surplus.detected | energy.demand.detected
   ▼
trade-matching.energy.queue  (durable, prefetch 1)
   │
   ▼
trade-matching-service ──▶ sell_offers / buy_requests ──▶ matching
                                                            │
                                          GET /prices/current│  POST /trades
                                                            ▼
                                        pricing-engine-service, billing-ledger-service
```

The reading and its event are written in one database transaction, so the
broker can lag behind the database but the two can never disagree. Publishing
is the outbox publisher's job alone; nothing else talks to the exchange.

## Topology

| Exchange                  | Type           | Purpose                                         |
| ------------------------- | -------------- | ----------------------------------------------- |
| `solar-grid.energy`       | topic, durable | Where energy events are published               |
| `solar-grid.energy.retry` | topic, durable | Holding area for messages waiting to be retried |
| `solar-grid.energy.dlx`   | topic, durable | Route to the dead letter queue                  |

| Queue                           | Bound to                                                                                               | Arguments                                                                                        | Purpose                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | --------------------------------------- |
| `trade-matching.energy.queue`   | `solar-grid.energy` on `energy.surplus.detected`, `energy.demand.detected`, `energy.retry.redelivered` | dead-letters to `solar-grid.energy.dlx`                                                          | What the consumer reads                 |
| `trade-matching.energy.retry.N` | `solar-grid.energy.retry` on `retry.N`                                                                 | `x-message-ttl` for attempt N, dead-letters to `solar-grid.energy` as `energy.retry.redelivered` | Waiting room for attempt N              |
| `trade-matching.energy.dlq`     | `solar-grid.energy.dlx` on `dlq.energy`                                                                | -                                                                                                | Messages that will not be retried again |

Everything is durable and is declared on every connect, so a broker that has
been restarted gets its topology back before a message is consumed.

## Retry

```
trade-matching.energy.queue
        │
        ▼
    consumer ──── success ────▶ ack, done
        │
        │ transient failure, attempt <= RABBITMQ_MAX_RETRIES
        ▼
publish to solar-grid.energy.retry with routing key retry.N
        │                    header x-retry-count = N
        ▼
trade-matching.energy.retry.N   waits x-message-ttl
        │
        ▼
back to solar-grid.energy as energy.retry.redelivered
        │
        ▼
trade-matching.energy.queue        (attempt N+1)
```

- The attempt number lives in the `x-retry-count` header, so it is visible in
  the management UI and in the logs, not inferred.
- The delay doubles with each attempt: `RABBITMQ_RETRY_DELAY_MS`, then double,
  then double again. With the defaults that is 2s, 4s, 8s.
- Each attempt has its own queue because RabbitMQ only expires messages at the
  head of a queue. With one shared queue and per-message TTLs, a message with a
  long delay would hold up every shorter one behind it.
- The original message is acknowledged once its retry copy is safely published,
  so the main queue never holds a message that is only waiting for a clock.

**Why the message comes back under a different routing key.** A dead-lettered
message keeps whatever routing key it had, which for a retry copy is `retry.N`.
The retry queues therefore set `x-dead-letter-routing-key` to
`energy.retry.redelivered`, and the main queue is bound to that key as well.
The original key travels in the `x-original-routing-key` header; the handler
does not need it, because the event body says what the event is.

## Dead letter queue

A message is parked in `trade-matching.energy.dlq` when:

| Reason                                                                                      | Retries spent                 |
| ------------------------------------------------------------------------------------------- | ----------------------------- |
| The event is malformed, has an unknown type, or a version this consumer does not understand | none - retrying cannot fix it |
| The attempts configured in `RABBITMQ_MAX_RETRIES` are used up                               | all of them                   |

Parked messages carry what happened:

| Header                   | Meaning                             |
| ------------------------ | ----------------------------------- |
| `x-retry-count`          | How many retries were spent         |
| `x-failure-reason`       | The error that ended it             |
| `x-failed-at`            | When it was parked                  |
| `x-original-routing-key` | The key it was first published with |

Nothing is consuming that queue, which is the point: the messages wait there
for a person. To look at them:

```bash
docker exec solar-grid-rabbitmq rabbitmqctl list_queues name messages
```

or the management UI at http://localhost:15672 (`RABBITMQ_USER` and
`RABBITMQ_PASSWORD` from `infrastructure/.env`), where a message can be
inspected. Once the cause is fixed it can be republished to `solar-grid.energy`
under the routing key in its `x-original-routing-key` header; often it does not
need to be, because the offer or request it carried was stored before the
failure. [troubleshooting.md](troubleshooting.md#the-dead-letter-queue-has-messages)
has the steps.

## Publishing

The outbox publisher marks a row published only once the broker has confirmed
it. Three failures are handled separately:

| What happened                                           | What the publisher does                                                                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| The broker is unreachable                               | Stops the pass; the row stays pending and the next tick retries it                                                        |
| The broker accepts nothing because no queue is bound    | Records the failure on that row and carries on with the rest; the row publishes itself once a consumer declares its queue |
| The process dies between publishing and marking the row | The event is published again later, and the consumer ignores the duplicate                                                |

Messages are published with `mandatory`, so a message the broker cannot route
comes back instead of being dropped silently. That is the state the system is
in the very first time it starts, before trade-matching has declared its queue.

Every message is persistent (`deliveryMode: 2`); a durable exchange and queue
only preserve the topology, not the messages in it.

## Event envelope

Events are flat: envelope metadata and domain fields side by side.

| Field                                                                                     | Meaning                                                                                                      |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `eventId`                                                                                 | Unique per event. Consumers deduplicate on it; also sent as the AMQP `messageId`                             |
| `eventType`                                                                               | `EnergySurplusDetected` or `EnergyDemandDetected`                                                            |
| `version`                                                                                 | Schema version. A consumer parks anything newer than it understands                                          |
| `occurredAt`                                                                              | When the event was produced                                                                                  |
| `correlationId`                                                                           | Ties the whole operation together                                                                            |
| `sourceEventId`                                                                           | What caused it: the id of the meter reading                                                                  |
| `householdId`, `productionKwh`, `consumptionKwh`, `surplusKwh` / `demandKwh`, `timestamp` | The domain fields. `timestamp` is when the meter took the reading, which can be much older than `occurredAt` |

```json
{
  "eventId": "550e8400-e29b-41d4-a716-446655440000",
  "eventType": "EnergySurplusDetected",
  "version": 1,
  "occurredAt": "2026-05-27T10:00:01.000Z",
  "correlationId": "demo-flow-001",
  "sourceEventId": "clx8s7d9a0001abcd",
  "householdId": "HH-SELLER-001",
  "productionKwh": "10.000",
  "consumptionKwh": "3.000",
  "surplusKwh": "7.000",
  "timestamp": "2026-05-27T10:00:00.000Z"
}
```

Energy is a decimal string, not a JSON number - see
[api-contracts.md](api-contracts.md).

## Correlation id

```
client (optional x-correlation-id header)
   │
   ▼
smart-meter HTTP middleware ── normalises it, or issues a new one
   │
   ├─▶ log lines
   ├─▶ meter reading and outbox rows
   ▼
AMQP message: correlationId property, x-correlation-id header, and the event body
   │
   ▼
trade-matching consumer ──▶ log lines, sell_offers / buy_requests, trade_matches
   │
   ├─▶ GET /prices/current      (x-correlation-id header)
   ▼
   └─▶ POST /trades             (x-correlation-id header) ──▶ completed_trades, ledger_entries
```

An id that arrives unusable - longer than 128 characters, or carrying anything
outside letters, digits, `.`, `_`, `:` and `-` - is replaced with a fresh one
rather than trusted, because it ends up in log lines, AMQP properties and
database columns. The consumer applies the same rule to the id inside an event
and parks the message if it fails; an id that is only padded with whitespace is
trimmed and passed on clean.

Every log line about the operation carries the id, so
`docker compose logs --no-color | grep <id>` shows it crossing all four
services. [observability.md](observability.md#correlation-ids) covers how a
trade, which joins two readings, picks its id.

## Duplicate delivery

At-least-once delivery means duplicates are normal, not exceptional. They
arrive when the outbox republishes an event whose confirmation was lost, when a
consumer crashes before acknowledging, and after a retry whose original was
already partly processed.

The business operation still happens once:

- `sell_offers.sourceEventId` and `buy_requests.sourceEventId` are unique, and
  the consumer inserts first and treats a unique violation as "already handled"
  rather than checking beforehand
- a trade carries an idempotency key derived from its own id, so billing
  recognises a retry
- `ledger_entries (tradeId, householdId, entryType)` is unique, so the ledger
  cannot record the same settlement twice

## Configuration

| Variable                    | Default | What it does                                       |
| --------------------------- | ------- | -------------------------------------------------- |
| `RABBITMQ_MAX_RETRIES`      | `3`     | Retries before a message is parked                 |
| `RABBITMQ_RETRY_DELAY_MS`   | `2000`  | Delay before the first retry; doubles each attempt |
| `RABBITMQ_PREFETCH`         | `1`     | Unacknowledged messages per consumer               |
| `OUTBOX_POLL_INTERVAL_MS`   | `2000`  | How often pending events are retried               |
| `OUTBOX_PUBLISH_TIMEOUT_MS` | `5000`  | Deadline for one publish                           |

Changing the retry delay changes `x-message-ttl` on the retry queues, and
RabbitMQ refuses to redeclare a queue with different arguments. Run
`pnpm docker:clean` once after changing it.

## Failure recovery, in short

| Failure                             | What happens                                                                                                                                       |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Broker down when a reading arrives  | The reading is stored, the event stays pending, and it publishes when the broker returns                                                           |
| Nothing bound to the exchange       | The broker returns the message, the row stays pending, and it publishes once the consumer starts                                                   |
| Broker restarts                     | Topology is redeclared on reconnect, persistent messages are still there, publisher and consumer carry on                                          |
| Consumer fails on a message         | Retried with a growing delay, up to `RABBITMQ_MAX_RETRIES`, then parked in the DLQ                                                                 |
| Consumer crashes mid-message        | RabbitMQ redelivers it; the unique index on `sourceEventId` keeps the effect to one                                                                |
| Broker connection drops mid-message | The handler finishes, its acknowledgement is lost (`message.ack_lost`), and the redelivery is recognised as a duplicate; the process keeps running |
| Malformed message                   | Parked immediately, with the reason in its headers                                                                                                 |
