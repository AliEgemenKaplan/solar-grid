# Solar Grid - Reliability

## Event Idempotency

RabbitMQ provides at-least-once delivery, so the trade-matching-service treats Smart Meter events as potentially duplicated.

- `EnergySurplusDetected.eventId` is stored as `sell_offers.sourceEventId`.
- `EnergyDemandDetected.eventId` is stored as `buy_requests.sourceEventId`.
- Both columns are unique for non-null values.
- When a duplicate event arrives, the consumer logs it and skips offer/request creation and matching for that duplicate message.

This prevents duplicate sell offers or buy requests when RabbitMQ redelivers the same event.

## Billing Idempotency

The billing-ledger-service protects financial records with an `idempotencyKey`.

1. trade-matching-service sends an `idempotencyKey` with every completed trade.
2. billing-ledger-service checks `idempotency_keys` before writing ledger data.
3. If the key already exists, it returns the original trade with `duplicate: true`.
4. If the key is new, it creates the completed trade, idempotency key, ledger entries, and balances in a single Prisma transaction.

The transaction writes:

- `completed_trade`
- `idempotency_key`
- seller `CREDIT` ledger entry
- buyer `DEBIT` ledger entry
- seller balance increment
- buyer balance decrement

If any step fails, the transaction rolls back.

## RabbitMQ DLQ Behavior

The trade-matching-service subscribes to:

- exchange: `solar-grid.energy`
- queue: `trade-matching.energy.queue`
- routing keys: `energy.surplus.detected`, `energy.demand.detected`

The main queue is configured with:

- dead-letter exchange: `solar-grid.energy.dlx`
- dead-letter routing key: `dlq.energy`

The DLQ queue `trade-matching.energy.dlq` is declared and bound to the DLX with routing key `dlq.energy`.

No separate retry queue or exponential backoff retry policy is implemented. If the consumer throws while processing a message, the failed message is routed to the DLQ by RabbitMQ/NestJS RabbitMQ handling. This is intentionally simple for the university demo.

## Matching Concurrency

The RabbitMQ consumer prefetch is set to `1` for this demo. That serializes event processing in a single service instance and reduces the risk of two matching runs updating the same offers or requests at the same time.

This is not a distributed lock. Running multiple trade-matching-service replicas would require a stronger database locking strategy.

## Correlation IDs

Each HTTP service assigns a `x-correlation-id` header if the request does not include one.

The ID is propagated through:

- Smart Meter log lines
- RabbitMQ event payloads
- Trade Matching log lines
- Trade Matching REST calls to Pricing via `x-correlation-id`
- Trade Matching REST calls to Billing via `x-correlation-id`
- Billing trade payloads and ledger rows

This lets the demo trace one reading through event processing, matching, and ledger creation.

## Health Endpoints

Each service exposes `GET /health`.

The endpoint is intentionally lightweight and returns service liveness:

```json
{ "status": "ok", "service": "<service-name>", "timestamp": "..." }
```

Docker Compose still uses infrastructure-level health checks for PostgreSQL and RabbitMQ startup ordering.
