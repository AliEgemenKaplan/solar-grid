import { Controller, DynamicModule, Get, Global, Header, Module, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { RequiresMetricsReader, RequiresOperator } from '../auth/principal.guard';
import { DiagnosticsSnapshot, MetricsRegistry } from './metrics-registry';

/**
 * Prometheus text format, for a scraper holding METRICS_TOKEN. Not rate
 * limited, like the health endpoints: a scrape refused with 429 looks like
 * an outage.
 */
@ApiTags('Metrics')
@SkipThrottle()
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsRegistry) {}

  @Get()
  @RequiresMetricsReader()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Operational metrics in Prometheus text format',
    description:
      'HTTP traffic, dependency failures and the service’s own counters. Counts only: no identifiers, no payloads, no secrets.',
  })
  @ApiProduces('text/plain')
  @ApiOkResponse({ description: 'Prometheus exposition format 0.0.4' })
  async scrape(@Res({ passthrough: true }) res: Response): Promise<string> {
    res.setHeader('Content-Type', this.metrics.contentType);
    return this.metrics.render();
  }
}

/**
 * The same counters as /metrics, as JSON, for the operator dashboard.
 *
 * /metrics stays with the scraper's token, so a scraper still cannot read
 * anything else; this gives the operator - who can already read every
 * statistic - the service's own counts without handing them that token.
 * Counts only, with bounded labels: route templates, outcomes, dependency
 * names. Never an identifier, a payload or a secret.
 */
@ApiTags('Diagnostics')
@Controller('diagnostics')
export class DiagnosticsController {
  constructor(private readonly metrics: MetricsRegistry) {}

  @Get()
  @RequiresOperator()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'This service’s operational counters, as JSON',
    description:
      'Every counter and gauge the service keeps, since it last started. Histograms are reduced to a count and a sum.',
  })
  @ApiOkResponse({ description: 'A diagnostics snapshot' })
  snapshot(): Promise<DiagnosticsSnapshot> {
    return this.metrics.snapshot();
  }
}

/**
 * One metrics registry per service, available everywhere in it, and the
 * endpoints that expose it.
 */
@Global()
@Module({})
export class MetricsModule {
  static forRoot(options: { service: string }): DynamicModule {
    return {
      module: MetricsModule,
      controllers: [MetricsController, DiagnosticsController],
      // A factory, not a value: every application built from the module gets
      // its own registry, which matters as soon as a process builds two.
      providers: [
        { provide: MetricsRegistry, useFactory: () => new MetricsRegistry(options.service) },
      ],
      exports: [MetricsRegistry],
    };
  }
}
