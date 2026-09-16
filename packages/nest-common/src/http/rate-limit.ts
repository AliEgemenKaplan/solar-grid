import { DynamicModule, ExecutionContext, Injectable, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Throttle, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { Request } from 'express';
import { bearerTokenFrom } from '../auth/credentials';
import { verifierFromConfig } from '../auth/principal.guard';

const DEFAULT_WINDOW_MS = 60_000;
/** Reads: generous enough for a dashboard polling several endpoints. */
const DEFAULT_READ_LIMIT = 300;
/** Writes: a meter reports every few minutes, not hundreds of times a minute. */
const DEFAULT_WRITE_LIMIT = 60;

function readPositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function windowMs(): number {
  return readPositiveInt(process.env.RATE_LIMIT_TTL_MS, DEFAULT_WINDOW_MS);
}

/**
 * The throttler, limited to HTTP.
 *
 * A global guard is not only an HTTP guard: Nest also runs it in front of
 * every RabbitMQ handler. There the "request" is an event and the "response"
 * is the raw AMQP message, the throttler fails trying to set headers on it,
 * and every event is rejected. Events are paced by the broker, not by this.
 */
@Injectable()
export class HttpThrottlerGuard extends ThrottlerGuard {
  protected override async shouldSkip(context: ExecutionContext): Promise<boolean> {
    return context.getType() !== 'http';
  }
}

/**
 * Rate limiting for every route, per client address.
 *
 * Calls carrying the internal service token are exempt: trade-matching
 * settling a trade with billing must not fail because the public side of the
 * system is busy. `RATE_LIMIT_ENABLED=false` switches it off entirely, which
 * is what the integration suites that are not about rate limiting use.
 */
@Module({})
export class RateLimitModule {
  static forRoot(): DynamicModule {
    return {
      module: RateLimitModule,
      imports: [
        ThrottlerModule.forRootAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (config: ConfigService) => {
            const verifier = verifierFromConfig(config);
            const enabled = config.get<string>('RATE_LIMIT_ENABLED', 'true') !== 'false';

            return {
              throttlers: [
                {
                  name: 'default',
                  ttl: readPositiveInt(config.get<string>('RATE_LIMIT_TTL_MS'), DEFAULT_WINDOW_MS),
                  limit: readPositiveInt(config.get<string>('RATE_LIMIT_MAX'), DEFAULT_READ_LIMIT),
                },
              ],
              skipIf: (context: ExecutionContext) => {
                if (!enabled) return true;
                const request = context.switchToHttp().getRequest<Request>();
                const token = bearerTokenFrom(request.headers?.authorization);
                return verifier.identify(token) === 'internal-service';
              },
            };
          },
        }),
      ],
      providers: [{ provide: APP_GUARD, useClass: HttpThrottlerGuard }],
    };
  }
}

/**
 * A tighter limit for routes that write. Resolved per request, so the value
 * follows RATE_LIMIT_WRITE_MAX without a restart of the decorator.
 */
export function WriteRateLimit() {
  return Throttle({
    default: {
      limit: () => readPositiveInt(process.env.RATE_LIMIT_WRITE_MAX, DEFAULT_WRITE_LIMIT),
      ttl: () => windowMs(),
    },
  });
}
