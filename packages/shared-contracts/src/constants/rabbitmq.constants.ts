/**
 * RabbitMQ topology.
 *
 * A message that fails is not retried in place. It is republished to the retry
 * exchange, where it waits in a queue whose TTL grows with the attempt number
 * and is then dead-lettered back to the main exchange. Once the attempts are
 * used up it goes to the dead letter queue and stays there.
 *
 *   solar-grid.energy ──▶ trade-matching.energy.queue ──▶ consumer
 *                                                          │ transient failure
 *                                                          ▼
 *                             solar-grid.energy.retry ──▶ retry.N (TTL) ──┐
 *                                    ▲                                     │
 *                                    └─────── back to the main exchange ◀──┘
 *                                                          │ attempts used up,
 *                                                          │ or unprocessable
 *                                                          ▼
 *                              solar-grid.energy.dlx ──▶ trade-matching.energy.dlq
 */

export const EXCHANGE_SOLAR_GRID_ENERGY = 'solar-grid.energy';
export const EXCHANGE_SOLAR_GRID_ENERGY_RETRY = 'solar-grid.energy.retry';
export const EXCHANGE_SOLAR_GRID_ENERGY_DLX = 'solar-grid.energy.dlx';

export const ROUTING_KEY_SURPLUS_DETECTED = 'energy.surplus.detected';
export const ROUTING_KEY_DEMAND_DETECTED = 'energy.demand.detected';
export const ROUTING_KEY_DLQ = 'dlq.energy';

/**
 * Routing key a retried message carries when its delay expires and it is sent
 * back to the main exchange. The original key is kept in a header; the handler
 * does not need it, since the event body says what the event is.
 */
export const ROUTING_KEY_RETRY_REDELIVERY = 'energy.retry.redelivered';

export const QUEUE_TRADE_MATCHING_ENERGY = 'trade-matching.energy.queue';
export const QUEUE_TRADE_MATCHING_DLQ = 'trade-matching.energy.dlq';

/** One queue per attempt, so each attempt can have its own delay. */
export function retryQueueName(attempt: number): string {
  return `trade-matching.energy.retry.${attempt}`;
}

export function retryRoutingKey(attempt: number): string {
  return `retry.${attempt}`;
}

/** Message headers used to carry retry state and failure context. */
export const HEADER_RETRY_COUNT = 'x-retry-count';
export const HEADER_ORIGINAL_ROUTING_KEY = 'x-original-routing-key';
export const HEADER_FAILURE_REASON = 'x-failure-reason';
export const HEADER_FAILED_AT = 'x-failed-at';
