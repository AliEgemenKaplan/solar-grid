import { Logger } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';
import type { RequestObservation } from '../http/request-observation';

export type Labels = Record<string, string>;

export interface CounterMetric {
  inc(labels?: Labels, value?: number): void;
}

export interface GaugeMetric {
  set(labels: Labels, value: number): void;
}

export interface HistogramMetric {
  observe(labels: Labels, value: number): void;
}

/** What a service depends on, as the dependency metrics name it. */
export type Dependency = 'database' | 'rabbitmq' | 'pricing' | 'billing';

/** Every metric name starts with this, so they are easy to tell apart from others. */
export const METRIC_PREFIX = 'solargrid_';

/** From a quick read to a slow write under load; anything longer is an outlier. */
const HTTP_DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];

/**
 * The metrics of one service, in Prometheus text format.
 *
 * A small, fixed set: HTTP traffic, dependency failures, and whatever a
 * service registers about its own work. Label values are bounded - route
 * templates, never raw paths; outcomes from a known list, never error text -
 * so the number of series cannot grow with traffic.
 *
 * Recording a metric must never fail the operation it describes, so every
 * write goes through a wrapper that swallows errors and logs the first one.
 */
export class MetricsRegistry {
  readonly registry = new Registry();
  private readonly logger = new Logger('Metrics');
  private reportedFailure = false;

  private readonly httpRequests: CounterMetric;
  private readonly httpDuration: HistogramMetric;
  private readonly dependencyFailures: CounterMetric;
  private readonly dependencyUp: GaugeMetric;

  constructor(readonly service: string) {
    this.registry.setDefaultLabels({ service });

    this.httpRequests = this.counter(
      'http_requests_total',
      'HTTP requests handled, by route template and status code.',
      ['method', 'route', 'status'],
    );
    this.httpDuration = this.histogram(
      'http_request_duration_seconds',
      'Time to handle an HTTP request, by route template.',
      ['method', 'route'],
      HTTP_DURATION_BUCKETS,
    );
    this.dependencyFailures = this.counter(
      'dependency_failures_total',
      'Operations that failed because a dependency was unavailable.',
      ['dependency'],
    );
    this.dependencyUp = this.gauge(
      'dependency_up',
      'Whether a dependency answered its last readiness check (1) or not (0).',
      ['dependency'],
    );
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  counter(name: string, help: string, labelNames: string[] = []): CounterMetric {
    const counter = new Counter({
      name: METRIC_PREFIX + name,
      help,
      labelNames,
      registers: [this.registry],
    });
    return {
      inc: (labels = {}, value = 1) => this.safely(() => counter.inc(labels, value)),
    };
  }

  gauge(
    name: string,
    help: string,
    labelNames: string[] = [],
    /** Called on every scrape to refresh the value; failures leave the last value. */
    collect?: (set: (labels: Labels, value: number) => void) => Promise<void>,
  ): GaugeMetric {
    const gauge: Gauge<string> = new Gauge({
      name: METRIC_PREFIX + name,
      help,
      labelNames,
      registers: [this.registry],
      collect: collect
        ? async () => {
            try {
              await collect((labels, value) => gauge.set(labels, value));
            } catch (err) {
              this.reportFailure(err);
            }
          }
        : undefined,
    });
    return {
      set: (labels, value) => this.safely(() => gauge.set(labels, value)),
    };
  }

  histogram(name: string, help: string, labelNames: string[], buckets: number[]): HistogramMetric {
    const histogram = new Histogram({
      name: METRIC_PREFIX + name,
      help,
      labelNames,
      buckets,
      registers: [this.registry],
    });
    return {
      observe: (labels, value) => this.safely(() => histogram.observe(labels, value)),
    };
  }

  /** Feeds the HTTP metrics; installed as a request observer. */
  observeRequest(observation: RequestObservation): void {
    const labels = {
      method: observation.method,
      route: observation.route,
      status: String(observation.statusCode),
    };
    this.httpRequests.inc(labels);
    this.httpDuration.observe(
      { method: observation.method, route: observation.route },
      observation.durationMs / 1000,
    );
  }

  dependencyFailed(dependency: Dependency): void {
    this.dependencyFailures.inc({ dependency });
  }

  dependencyStatus(dependency: string, up: boolean): void {
    this.dependencyUp.set({ dependency }, up ? 1 : 0);
  }

  async render(): Promise<string> {
    return this.registry.metrics();
  }

  private safely(record: () => void): void {
    try {
      record();
    } catch (err) {
      this.reportFailure(err);
    }
  }

  private reportFailure(err: unknown): void {
    if (this.reportedFailure) return;
    this.reportedFailure = true;
    try {
      this.logger.warn({
        event: 'metrics.record_failed',
        message: 'A metric could not be recorded; further failures are not logged',
        reason: err instanceof Error ? err.message : String(err),
      });
    } catch {
      // Metrics are never worth an exception.
    }
  }
}
