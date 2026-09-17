import { Injectable, Optional } from '@nestjs/common';
import { CounterMetric, MetricsRegistry } from '@solar-grid/nest-common';

const NOOP: CounterMetric = { inc: () => undefined };

/** What pricing-engine-service counts. Without a registry every method does nothing. */
@Injectable()
export class PricingMetrics {
  private readonly recalculations: CounterMetric = NOOP;

  constructor(@Optional() registry?: MetricsRegistry) {
    if (!registry) return;
    this.recalculations = registry.counter(
      'price_recalculations_total',
      'Prices recalculated from supply and demand.',
    );
  }

  priceRecalculated(): void {
    this.recalculations.inc();
  }
}
