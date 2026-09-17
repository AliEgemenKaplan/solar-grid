import { Controller, DynamicModule, Get, Global, Header, Module, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { RequiresMetricsReader } from '../auth/principal.guard';
import { MetricsRegistry } from './metrics-registry';

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
 * One metrics registry per service, available everywhere in it, and the
 * endpoint that exposes it.
 */
@Global()
@Module({})
export class MetricsModule {
  static forRoot(options: { service: string }): DynamicModule {
    return {
      module: MetricsModule,
      controllers: [MetricsController],
      // A factory, not a value: every application built from the module gets
      // its own registry, which matters as soon as a process builds two.
      providers: [
        { provide: MetricsRegistry, useFactory: () => new MetricsRegistry(options.service) },
      ],
      exports: [MetricsRegistry],
    };
  }
}
