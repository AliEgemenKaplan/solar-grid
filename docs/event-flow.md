# Solar Grid - Event Flow

## RabbitMQ Topology

### Exchanges

| Name                    | Type  | Durable |
| ----------------------- | ----- | ------- |
| `solar-grid.energy`     | topic | yes     |
| `solar-grid.energy.dlx` | topic | yes     |

### Queues

| Queue                         | Bound Exchange          | Routing Key                                         | Purpose                          |
| ----------------------------- | ----------------------- | --------------------------------------------------- | -------------------------------- |
| `trade-matching.energy.queue` | `solar-grid.energy`     | `energy.surplus.detected`, `energy.demand.detected` | Main consumer queue for matching |
| `trade-matching.energy.dlq`   | `solar-grid.energy.dlx` | `dlq.energy`                                        | Failed event parking queue       |

The main queue dead-letters failed messages to `solar-grid.energy.dlx` with routing key `dlq.energy`. The consumer nacks without requeue, so a message that cannot be processed is parked once instead of being redelivered in a loop. Malformed messages skip processing entirely and go straight to the DLQ.

No separate retry queue is implemented yet. Failed messages go to the DLQ for inspection or manual replay.

## Message Properties

Every published event carries:

| Property                  | Value                                            |
| ------------------------- | ------------------------------------------------ |
| `deliveryMode`            | `2` (persistent)                                 |
| `messageId`               | the eventId of the event                         |
| `correlationId`           | the correlation id of the request that caused it |
| `type`                    | the event type                                   |
| `contentType`             | `application/json`                               |
| header `x-correlation-id` | the correlation id                               |

## Routing Keys

| Key                       | Published By        | Description                                      |
| ------------------------- | ------------------- | ------------------------------------------------ |
| `energy.surplus.detected` | smart-meter-service | Household production is greater than consumption |
| `energy.demand.detected`  | smart-meter-service | Household consumption is greater than production |

## End-to-End Flow

1. A client submits `POST /readings` to smart-meter-service.
2. smart-meter-service stores the reading, the household status and the outgoing event in one transaction.
3. The outbox publisher sends `EnergySurplusDetected` or `EnergyDemandDetected` to the exchange as a persistent message and marks the outbox row published.
4. trade-matching-service consumes the event.
5. trade-matching-service checks `eventId` idempotency.
6. A surplus event creates a sell offer; a demand event creates a buy request.
7. trade-matching-service runs FIFO matching with prefetch set to `1`.
8. trade-matching-service calls pricing-engine-service `GET /prices/current`.
9. trade-matching-service reserves the energy on the offer and the request and records the trade as `PENDING_BILLING`.
10. trade-matching-service calls billing-ledger-service `POST /trades` with the trade id as the idempotency key.
11. billing-ledger-service records the completed trade, CREDIT/DEBIT ledger entries, and balances transactionally.
12. trade-matching-service marks the trade `COMPLETED`, releases the energy if billing refused, or leaves it reserved for retry if the answer never arrived.

## Event Payloads

### EnergySurplusDetectedEvent

```json
{
  "eventId": "550e8400-e29b-41d4-a716-446655440000",
  "eventType": "EnergySurplusDetected",
  "correlationId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "householdId": "HH-SELLER-001",
  "productionKwh": 10,
  "consumptionKwh": 3,
  "surplusKwh": 7,
  "timestamp": "2026-05-27T10:00:00.000Z"
}
```

### EnergyDemandDetectedEvent

```json
{
  "eventId": "661f9500-f30c-52e5-b827-557766551111",
  "eventType": "EnergyDemandDetected",
  "correlationId": "b2c3d4e5-f6a7-8901-bcde-f01234567891",
  "householdId": "HH-BUYER-001",
  "productionKwh": 1,
  "consumptionKwh": 5,
  "demandKwh": 4,
  "timestamp": "2026-05-27T10:01:00.000Z"
}
```
