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

/**
 * One series of a metric, as the diagnostics endpoint reports it. For a
 * histogram, `value` is how many observations there were and `sum` their total.
 */
export interface DiagnosticSeries {
  labels: Labels;
  value: number;
  sum?: number;
}

export interface DiagnosticMetric {
  /** Without the solargrid_ prefix: `messages_total`. */
  name: string;
  help: string;
  type: 'counter' | 'gauge' | 'histogram';
  series: DiagnosticSeries[];
}

export interface DiagnosticsSnapshot {
  service: string;
  /** When this process started counting: every counter is since then. */
  countingSince: string;
  generatedAt: string;
  metrics: DiagnosticMetric[];
}

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
  /** Counters start at zero with the registry, so this is what they count from. */
  readonly countingSince = new Date();
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

  /**
   * The same numbers as `render`, as JSON for the operator's diagnostics view.
   *
   * Only this service's own metrics, without the service label every series
   * carries. Histograms are reduced to how many observations there were and
   * their sum: the buckets are for a monitoring system, not for a person.
   */
  async snapshot(): Promise<DiagnosticsSnapshot> {
    const metrics = await this.registry.getMetricsAsJSON();
    return {
      service: this.service,
      countingSince: this.countingSince.toISOString(),
      generatedAt: new Date().toISOString(),
      metrics: metrics
        .filter((metric) => metric.name.startsWith(METRIC_PREFIX))
        .map((metric) => {
          const type = String(metric.type) as DiagnosticMetric['type'];
          const name = metric.name.slice(METRIC_PREFIX.length);
          const withoutService = (labels: Partial<Record<string, string | number>>): Labels => {
            const { service: _service, le: _le, ...rest } = labels;
            return Object.fromEntries(
              Object.entries(rest)
                .filter(([, value]) => value !== undefined)
                .map(([key, value]) => [key, String(value)]),
            );
          };
          if (type !== 'histogram') {
            return {
              name,
              help: metric.help,
              type,
              series: metric.values.map((entry) => ({
                labels: withoutService(entry.labels),
                value: entry.value,
              })),
            };
          }
          // One series per label set: the _count and _sum lines, joined.
          const series = new Map<string, DiagnosticSeries>();
          for (const entry of metric.values) {
            const metricName = (entry as { metricName?: string }).metricName ?? '';
            if (!metricName.endsWith('_count') && !metricName.endsWith('_sum')) continue;
            const labels = withoutService(entry.labels);
            const key = JSON.stringify(labels);
            const current = series.get(key) ?? { labels, value: 0, sum: 0 };
            if (metricName.endsWith('_count')) current.value = entry.value;
            else current.sum = entry.value;
            series.set(key, current);
          }
          return { name, help: metric.help, type, series: [...series.values()] };
        }),
    };
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
