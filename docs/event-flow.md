# Solar Grid - Event Flow

## RabbitMQ Topology

### Exchanges

| Name | Type | Durable |
| --- | --- | --- |
| `solar-grid.energy` | topic | yes |
| `solar-grid.energy.dlx` | topic | yes |

### Queues

| Queue | Bound Exchange | Routing Key | Purpose |
| --- | --- | --- | --- |
| `trade-matching.energy.queue` | `solar-grid.energy` | `energy.surplus.detected`, `energy.demand.detected` | Main consumer queue for matching |
| `trade-matching.energy.dlq` | `solar-grid.energy.dlx` | `dlq.energy` | Failed event parking queue |

The main queue dead-letters failed messages to `solar-grid.energy.dlx` with routing key `dlq.energy`.

No separate retry queue is implemented. Failed messages go to the DLQ for inspection or manual replay.

## Routing Keys

| Key | Published By | Description |
| --- | --- | --- |
| `energy.surplus.detected` | smart-meter-service | Household production is greater than consumption |
| `energy.demand.detected` | smart-meter-service | Household consumption is greater than production |

## End-to-End Flow

1. A client submits `POST /readings` to smart-meter-service.
2. smart-meter-service stores the reading and current household status.
3. smart-meter-service publishes either `EnergySurplusDetected` or `EnergyDemandDetected`.
4. trade-matching-service consumes the event.
5. trade-matching-service checks `eventId` idempotency.
6. A surplus event creates a sell offer; a demand event creates a buy request.
7. trade-matching-service runs FIFO matching with prefetch set to `1`.
8. trade-matching-service calls pricing-engine-service `GET /prices/current`.
9. trade-matching-service calls billing-ledger-service `POST /trades`.
10. billing-ledger-service records the completed trade, CREDIT/DEBIT ledger entries, and balances transactionally.

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
