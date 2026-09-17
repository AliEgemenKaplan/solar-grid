import {
  Controller,
  DynamicModule,
  Get,
  Inject,
  Injectable,
  Logger,
  Module,
  ModuleMetadata,
  OnModuleDestroy,
  Res,
} from '@nestjs/common';
import type { InjectionToken } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOperation,
  ApiProperty,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { DependencyCheck, evaluateReadiness, ReadinessReport } from './readiness';

const HEALTH_SERVICE_NAME = Symbol('HEALTH_SERVICE_NAME');
const DEPENDENCY_CHECKS = Symbol('DEPENDENCY_CHECKS');

/**
 * Knows whether the application has started to shut down. Nest calls
 * onModuleDestroy before any other shutdown hook, so readiness turns false
 * before a single consumer is cancelled or connection closed.
 */
@Injectable()
export class ApplicationLifecycle implements OnModuleDestroy {
  private stopping = false;

  get shuttingDown(): boolean {
    return this.stopping;
  }

  onModuleDestroy(): void {
    this.stopping = true;
  }
}

class LivenessResponse {
  @ApiProperty({ example: 'ok' })
  status!: 'ok';

  @ApiProperty({ example: 'billing-ledger-service' })
  service!: string;

  @ApiProperty({ example: '2026-09-17T10:00:00.000Z' })
  timestamp!: string;
}

class DependencyReportResponse {
  @ApiProperty({ enum: ['up', 'down'] })
  status!: 'up' | 'down';

  @ApiProperty({ description: 'Whether this dependency being down makes the service not ready' })
  critical!: boolean;

  @ApiProperty({ example: 3 })
  durationMs!: number;
}

class ReadinessResponse {
  @ApiProperty({ enum: ['ready', 'not_ready', 'shutting_down'] })
  status!: ReadinessReport['status'];

  @ApiProperty({ example: 'billing-ledger-service' })
  service!: string;

  @ApiProperty({ example: '2026-09-17T10:00:00.000Z' })
  timestamp!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: { $ref: getSchemaPath(DependencyReportResponse) },
    example: { database: { status: 'up', critical: true, durationMs: 3 } },
  })
  checks!: Record<string, DependencyReportResponse>;
}

/**
 * Probes are never rate limited: a platform that gets a 429 from a health
 * check has no way to tell it from an outage.
 */
@ApiTags('Health')
@ApiExtraModels(DependencyReportResponse)
@SkipThrottle()
@Controller('health')
export class HealthController {
  private readonly logger = new Logger('Health');
  /** Dependencies seen down on the last probe, so only changes are logged. */
  private readonly down = new Set<string>();

  constructor(
    @Inject(HEALTH_SERVICE_NAME) private readonly service: string,
    @Inject(DEPENDENCY_CHECKS) private readonly checks: DependencyCheck[],
    private readonly lifecycle: ApplicationLifecycle,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Liveness, kept at its original path; same as /health/live' })
  @ApiResponse({ status: 200, type: LivenessResponse })
  check(): LivenessResponse {
    return this.live();
  }

  @Get('live')
  @ApiOperation({
    summary: 'Liveness: the process is running and serving HTTP',
    description:
      'Never touches a dependency, so a database outage cannot get a healthy process restarted.',
  })
  @ApiResponse({ status: 200, type: LivenessResponse })
  live(): LivenessResponse {
    return { status: 'ok', service: this.service, timestamp: new Date().toISOString() };
  }

  @Get('ready')
  @ApiOperation({
    summary: 'Readiness: the dependencies needed for useful work answer',
    description: '503 while a critical dependency is down or the service is shutting down.',
  })
  @ApiResponse({ status: 200, type: ReadinessResponse })
  @ApiResponse({ status: 503, type: ReadinessResponse })
  async ready(@Res({ passthrough: true }) res: Response): Promise<ReadinessReport> {
    const failedNow = new Set<string>();
    const report = await evaluateReadiness(this.service, this.checks, {
      shuttingDown: this.lifecycle.shuttingDown,
      onFailure: (name, reason) => {
        failedNow.add(name);
        if (!this.down.has(name)) {
          this.logger.warn({
            event: 'readiness.changed',
            message: `Dependency ${name} is down`,
            dependency: name,
            status: 'down',
            reason,
          });
        }
      },
    });

    if (report.status !== 'shutting_down') {
      for (const name of this.down) {
        if (!failedNow.has(name)) {
          this.logger.log({
            event: 'readiness.changed',
            message: `Dependency ${name} is back up`,
            dependency: name,
            status: 'up',
          });
        }
      }
      this.down.clear();
      for (const name of failedNow) this.down.add(name);
    }

    res.status(report.status === 'ready' ? 200 : 503);
    return report;
  }
}

export interface HealthModuleOptions {
  service: string;
  /** Modules that provide what `checks` injects, when it is not global. */
  imports?: ModuleMetadata['imports'];
  inject?: InjectionToken[];
  checks: (...dependencies: never[]) => DependencyCheck[];
}

/**
 * `/health/live`, `/health/ready` and the original `/health`, the same in
 * every service. Each service says which dependencies it needs.
 */
@Module({})
export class HealthModule {
  static forRoot(options: HealthModuleOptions): DynamicModule {
    return {
      module: HealthModule,
      imports: options.imports ?? [],
      controllers: [HealthController],
      providers: [
        ApplicationLifecycle,
        { provide: HEALTH_SERVICE_NAME, useValue: options.service },
        {
          provide: DEPENDENCY_CHECKS,
          inject: options.inject ?? [],
          useFactory: options.checks as (...dependencies: unknown[]) => DependencyCheck[],
        },
      ],
    };
  }
}
