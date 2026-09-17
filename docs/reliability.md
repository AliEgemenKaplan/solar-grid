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

## Amounts do not drift

Money and energy are `numeric` in the database and decimal objects in code, so
`0.1 + 0.2` is `0.30` and an offer that has been fully consumed holds exactly
zero. The float version needed an epsilon comparison to decide whether a
remainder of 1e-17 kWh counted as exhausted; that guesswork is gone. Amounts
are rounded once, half away from zero, at the scale the column stores.

## A reading that arrives late cannot rewind a household

`household_energy_status` records the timestamp of the reading behind it and is
written with a conditional upsert, so an out-of-order delivery updates nothing.

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

## Failed messages are retried a bounded number of times, then stop

The RabbitMQ library requeues by default, which turns one failing message into
an endless redelivery loop that blocks everything behind it. Nothing here
relies on that behaviour.

A transient failure - the database blinking, a dependency briefly unavailable -
is retried with a delay that doubles each attempt (2s, 4s, 8s by default). The
attempt number travels in the `x-retry-count` header, so it can be read from
the management UI rather than guessed. Once `RABBITMQ_MAX_RETRIES` attempts are
spent the message is parked in `trade-matching.energy.dlq` with the reason and
the attempt count in its headers.

Malformed events, unknown event types and event versions this consumer does not
understand are parked immediately: no number of retries will fix a message that
is missing its `surplusKwh`.

[event-flow.md](event-flow.md) has the topology and the exact routing.

## Events survive a broker restart

A durable exchange and a durable queue only preserve the topology. Messages
also have to be published as persistent, which the publisher does through
`defaultPublishOptions`. Each message carries `messageId` (the event id),
`correlationId` and `type` so it can be traced and deduplicated without
parsing the body. The topology is redeclared on every connect, so a broker that
has been restarted has its exchanges and queues back before anything is
consumed.

## An event the broker cannot route is not lost

Messages are published with `mandatory`, so one that matches no binding comes
back to the publisher instead of being dropped. The outbox row stays pending,
the reason is recorded on it, and the event publishes itself once a consumer
has declared its queue - which is exactly the state the system is in the first
time it ever starts.

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

Each service exposes `GET /health/live`, which never touches a dependency, and
`GET /health/ready`, which answers 503 while its database - or, for
trade-matching, the broker - is down or while the service is shutting down.
`GET /health` remains as an alias of liveness. The compose healthchecks use
readiness.

A service shutting down stops taking messages and waits for the ones in hand
before it closes its connections, so a deploy does not turn in-flight events
into redeliveries. See [operations.md](operations.md) for both.
