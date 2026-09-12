# Solar Grid - Reliability

Every guarantee below is covered by a test that fails when the guarantee is
removed. The integration tests run against a real PostgreSQL and a real
RabbitMQ through Testcontainers: `pnpm test:integration`.

## The reading and its event cannot disagree

Writing to the database and publishing to a broker are two separate systems,
so doing both in sequence has no safe ordering: publish first and a database
failure invents an event for a reading that does not exist; write first and a
broker failure loses an event for a reading that does.

smart-meter-service writes the reading, the household status and the event to
`outbox_events` in a single transaction. A publisher then moves pending rows
to RabbitMQ and marks them published. If the broker is unreachable the row
stays pending and the next pass retries it.

The publisher applies its own deadline to each publish. The AMQP client queues
messages while it is offline instead of failing, so without a deadline one
unreachable broker would stall the loop.

An event may therefore be published twice - after a crash between the publish
and the update, for instance. That is intentional: delivery is at least once
and the consumer removes the duplicates.

## The same reading is only counted once

A meter reports one reading per household per timestamp, so
`meter_readings (householdId, timestamp)` is unique. Re-sending a reading
returns the stored one with `"duplicate": true` and queues no second event.

## The same event only creates one offer

`sell_offers.sourceEventId` and `buy_requests.sourceEventId` are unique. The
consumer inserts and treats a unique violation as "already handled" rather
than checking first, because a check followed by an insert leaves a gap that
two simultaneous deliveries of the same event can slip through.

## The same energy is never sold twice

trade-matching-service reserves before it bills:

1. **Reserve** - in one transaction, take the energy off the offer and the
   request and record the trade as `PENDING_BILLING`.
2. **Bill** - call billing outside that transaction, so no lock is held while
   the network is involved.
3. **Confirm** - record what billing answered.

The reservation transaction takes a PostgreSQL advisory lock, so only one
reservation happens at a time however many runs are in flight, and both
updates carry their own amount check (`availableKwh >= energyKwh`). Postgres
re-evaluates that check against the committed row, so a competing transaction
cannot slip between a read and a write. If either side no longer has the
energy, the whole reservation rolls back and the trade is skipped.

## A trade is never billed twice

The idempotency key is the trade id. It is stored with the trade and never
regenerated, so every attempt to bill that trade carries the same key and the
same payload, and billing recognises a retry for what it is.

What billing answers decides what happens to the reservation:

| Answer                           | Meaning                        | What happens                                         |
| -------------------------------- | ------------------------------ | ---------------------------------------------------- |
| 2xx                              | recorded                       | Trade is `COMPLETED`                                 |
| 4xx                              | refused, and will refuse again | Energy is given back, trade is `FAILED`              |
| timeout, 5xx, dropped connection | unknown                        | Energy stays reserved, trade stays `PENDING_BILLING` |

The unknown case is the one that matters. Billing may well have recorded the
trade before the answer was lost, so writing it off and re-matching the same
energy would charge the households twice. Instead the trade keeps its
reservation, and the next matching run retries it with the same key before it
matches anything new.

On the billing side the `idempotency_keys` unique index is the real guard: two
requests carrying one key can both pass a preliminary check, so the request
that loses the insert reports the winner's trade instead of failing.

## Failed messages stop, they do not spin

The RabbitMQ library requeues by default, which turns one failing message into
an endless redelivery loop that blocks everything behind it. The consumer nacks
without requeue instead, so the message is dead lettered to
`trade-matching.energy.dlq` through `solar-grid.energy.dlx`.

Malformed events are rejected before any database work, since no number of
retries will fix a message that is missing its `surplusKwh`.

There is no delayed retry yet: a transient failure goes to the dead letter
queue on the first attempt and has to be replayed. A retry queue with a TTL
and a bounded attempt count is the next step.

## Events survive a broker restart

A durable exchange and a durable queue only preserve the topology. Messages
also have to be published as persistent, which the publisher does through
`defaultPublishOptions`. Each message carries `messageId` (the event id),
`correlationId` and `type` so it can be traced and deduplicated without
parsing the body.

## Service to service calls have a deadline

Calls to pricing and billing time out (`HTTP_CLIENT_TIMEOUT_MS`, 5s by
default). Without one, a hung call blocks the single consumer channel and no
further events are processed.

## Correlation IDs

Each HTTP service assigns `x-correlation-id` when a request arrives without
one. It travels through log lines, the event payload, the AMQP `correlationId`
property and header, the REST calls to pricing and billing, and the rows those
calls write.

## Health endpoints

Each service exposes `GET /health`, a liveness check that reports the service
name and a timestamp. It does not yet check the database or the broker;
`/health/live` and `/health/ready` come with the operations work.
