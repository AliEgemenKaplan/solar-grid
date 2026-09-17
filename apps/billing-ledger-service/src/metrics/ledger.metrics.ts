import { Injectable, Optional } from '@nestjs/common';
import { CounterMetric, MetricsRegistry } from '@solar-grid/nest-common';

const NOOP: CounterMetric = { inc: () => undefined };

/**
 * - `recorded`: a new trade, its ledger entries and balances written
 * - `replayed`: the same trade again, answered from the ledger
 * - `idempotency_conflict`: a known key with a different payload
 * - `conflict`: a trade id already recorded under another key
 * - `rejected`: a business rule refused it
 */
export type SettlementOutcome =
  'recorded' | 'replayed' | 'idempotency_conflict' | 'conflict' | 'rejected';

/** What billing-ledger-service counts. Without a registry every method does nothing. */
@Injectable()
export class LedgerMetrics {
  private readonly settlements: CounterMetric = NOOP;

  constructor(@Optional() registry?: MetricsRegistry) {
    if (!registry) return;
    this.settlements = registry.counter(
      'settlements_total',
      'Requests to record a trade, by outcome.',
      ['outcome'],
    );
  }

  settlement(outcome: SettlementOutcome): void {
    this.settlements.inc({ outcome });
  }
}
