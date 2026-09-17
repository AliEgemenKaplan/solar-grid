import { Injectable, Optional } from '@nestjs/common';
import { CounterMetric, MetricsRegistry } from '@solar-grid/nest-common';
import { PrismaService } from '../prisma/prisma.service';

const NOOP: CounterMetric = { inc: () => undefined };

export type MessageOutcome =
  'processed' | 'duplicate' | 'retry_scheduled' | 'dead_lettered' | 'rejected';

export type MatchingRunOutcome = 'completed' | 'pricing_unavailable' | 'failed';

/** `settled`: billing recorded it. `rejected`: billing refused it. `unknown`: no answer. */
export type BillingOutcomeLabel = 'settled' | 'rejected' | 'unknown';

/**
 * What trade-matching-service counts: energy events, matching runs, trades
 * and the outcome of billing them. Without a registry every method does nothing.
 */
@Injectable()
export class TradingMetrics {
  private readonly messages: CounterMetric = NOOP;
  private readonly matchingRuns: CounterMetric = NOOP;
  private readonly tradesReserved: CounterMetric = NOOP;
  private readonly billingOutcomes: CounterMetric = NOOP;

  constructor(
    @Optional() private readonly registry?: MetricsRegistry,
    @Optional() prisma?: PrismaService,
  ) {
    if (!registry) return;

    this.messages = registry.counter(
      'messages_total',
      'Energy events handled, by event type and outcome.',
      ['event_type', 'outcome'],
    );
    this.matchingRuns = registry.counter(
      'matching_runs_total',
      'Matching runs, by how they ended.',
      ['outcome'],
    );
    this.tradesReserved = registry.counter(
      'trades_reserved_total',
      'Trades whose energy was reserved on both sides.',
    );
    this.billingOutcomes = registry.counter(
      'trade_billing_outcomes_total',
      'Attempts to record a trade with billing, by outcome.',
      ['outcome'],
    );

    const countFromDatabase = (
      name: string,
      help: string,
      count: (client: PrismaService) => Promise<number>,
    ) =>
      registry.gauge(name, `${help} Read from the database on each scrape.`, [], async (set) => {
        if (prisma) set({}, await count(prisma));
      });

    countFromDatabase('offers_open', 'Sell offers with energy still available.', (client) =>
      client.sellOffer.count({ where: { status: { in: ['OPEN', 'PARTIALLY_MATCHED'] } } }),
    );
    countFromDatabase('requests_open', 'Buy requests still waiting for energy.', (client) =>
      client.buyRequest.count({ where: { status: { in: ['OPEN', 'PARTIALLY_MATCHED'] } } }),
    );
    countFromDatabase(
      'trades_pending_billing',
      'Trades reserved but not yet confirmed by billing.',
      (client) => client.tradeMatch.count({ where: { status: 'PENDING_BILLING' } }),
    );
  }

  messageHandled(eventType: string | undefined, outcome: MessageOutcome): void {
    this.messages.inc({ event_type: knownEventType(eventType), outcome });
  }

  matchingRun(outcome: MatchingRunOutcome): void {
    this.matchingRuns.inc({ outcome });
    if (outcome === 'pricing_unavailable') this.registry?.dependencyFailed('pricing');
  }

  tradeReserved(): void {
    this.tradesReserved.inc();
  }

  billingOutcome(outcome: BillingOutcomeLabel): void {
    this.billingOutcomes.inc({ outcome });
    if (outcome === 'unknown') this.registry?.dependencyFailed('billing');
  }

  databaseUnavailable(): void {
    this.registry?.dependencyFailed('database');
  }
}

/** A malformed message can claim any type; only the known ones become label values. */
function knownEventType(eventType: string | undefined): string {
  return eventType === 'EnergySurplusDetected' || eventType === 'EnergyDemandDetected'
    ? eventType
    : 'unknown';
}
