import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import type { NextFunction, Request, Response } from 'express';
import { HEADER_CORRELATION_ID } from '@solar-grid/shared-contracts';
import { getOrGenerateCorrelationId } from '@solar-grid/shared-utils';
import { AllExceptionsFilter } from '../errors/all-exceptions.filter';
import { ApiErrorResponse } from '../errors/api-error';
import { CredentialVerifier, PrincipalKind } from '../auth/credentials';
import {
  INTERNAL_SERVICE_AUTH_SCHEME,
  METRICS_AUTH_SCHEME,
  OPERATOR_AUTH_SCHEME,
} from '../auth/principal.guard';
import { MetricsRegistry } from '../metrics/metrics-registry';
import { connectionUrlProblems, enforceOrWarn } from '../config/runtime-safety';
import { observeRequests } from './request-observation';

export interface HttpAppOptions {
  title: string;
  description: string;
  tags: string[];
  /**
   * Credentials this service checks or sends. Only these are expected in its
   * environment, and only these are warned about when missing.
   */
  credentials: PrincipalKind[];
}

export interface HttpAppSettings {
  swaggerEnabled: boolean;
  corsOrigins: string[];
}

/**
 * Swagger is on in development and test, off in production unless asked for.
 * An explicit SWAGGER_ENABLED always wins, in either direction.
 */
export function isSwaggerEnabled(config: Pick<ConfigService, 'get'>): boolean {
  const explicit = config.get<string>('SWAGGER_ENABLED');
  if (explicit !== undefined && explicit !== '') return explicit === 'true';
  return config.get<string>('NODE_ENV') !== 'production';
}

/**
 * Origins allowed to call the API from a browser. Empty by default: the
 * frontend will be served from the same origin, which needs no CORS at all.
 * A wildcard is refused rather than honoured.
 */
export function corsOriginsFrom(config: Pick<ConfigService, 'get'>): string[] {
  const raw = config.get<string>('CORS_ALLOWED_ORIGINS') ?? '';
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0 && origin !== '*');
}

/**
 * Everything an HTTP service in this system needs before it listens:
 * correlation ids, security headers, CORS, validation, the error contract and,
 * where allowed, Swagger. One function, so the four services cannot drift
 * apart on any of it.
 */
export function configureHttpApp(app: INestApplication, options: HttpAppOptions): HttpAppSettings {
  const config = app.get(ConfigService);
  const logger = new Logger('HttpPlatform');

  const swaggerEnabled = isSwaggerEnabled(config);
  const corsOrigins = corsOriginsFrom(config);

  // Every request gets a correlation id, and one that arrives unusable - too
  // long, or carrying characters that have no business in a log line - is
  // replaced rather than trusted. Error responses echo it back.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const correlationId = getOrGenerateCorrelationId(req.headers);
    req.headers[HEADER_CORRELATION_ID] = correlationId;
    res.setHeader(HEADER_CORRELATION_ID, correlationId);
    next();
  });

  // After the correlation id is settled, so every request line carries it.
  const metrics = metricsOf(app);
  app.use(observeRequests(metrics ? [(observation) => metrics.observeRequest(observation)] : []));

  // Swagger UI needs inline scripts and styles; a JSON API does not. The
  // content security policy is only relaxed when the UI is actually served.
  app.use(helmet({ contentSecurityPolicy: swaggerEnabled ? false : undefined }));

  if (corsOrigins.length > 0) {
    app.enableCors({
      origin: corsOrigins,
      methods: ['GET', 'POST'],
      allowedHeaders: ['Content-Type', 'Authorization', HEADER_CORRELATION_ID],
      exposedHeaders: [HEADER_CORRELATION_ID],
      credentials: false,
      maxAge: 600,
    });
  }
  if ((config.get<string>('CORS_ALLOWED_ORIGINS') ?? '').split(',').some((o) => o.trim() === '*')) {
    logger.warn({
      event: 'config.warning',
      message: 'CORS_ALLOWED_ORIGINS contains "*", which is ignored: list the origins explicitly.',
    });
  }

  app.useGlobalPipes(
    new ValidationPipe({
      // Unknown fields are refused, not silently dropped: a client sending
      // `status` to an endpoint that does not accept it has a bug worth hearing about.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(
    new AllExceptionsFilter((dependency) => metrics?.dependencyFailed(dependency)),
  );

  // Never the values, only whether they are usable. In production any of
  // these stops the service; elsewhere they are warnings.
  const environment = config.get<string>('NODE_ENV');
  enforceOrWarn(
    [
      ...CredentialVerifier.configurationWarnings(
        {
          operatorToken: config.get<string>('OPERATOR_API_TOKEN'),
          internalServiceToken: config.get<string>('INTERNAL_API_TOKEN'),
          metricsToken: config.get<string>('METRICS_TOKEN'),
        },
        options.credentials,
        environment,
      ),
      ...connectionUrlProblems('DATABASE_URL', config.get<string>('DATABASE_URL')),
      ...connectionUrlProblems('RABBITMQ_URL', config.get<string>('RABBITMQ_URL')),
    ],
    environment,
    logger,
  );

  if (swaggerEnabled) {
    const builder = new DocumentBuilder()
      .setTitle(options.title)
      .setDescription(options.description)
      .setVersion('1.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', description: 'OPERATOR_API_TOKEN' },
        OPERATOR_AUTH_SCHEME,
      )
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', description: 'INTERNAL_API_TOKEN' },
        INTERNAL_SERVICE_AUTH_SCHEME,
      )
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', description: 'METRICS_TOKEN' },
        METRICS_AUTH_SCHEME,
      );
    for (const tag of options.tags) builder.addTag(tag);

    const document = SwaggerModule.createDocument(app, builder.build(), {
      extraModels: [ApiErrorResponse],
    });
    SwaggerModule.setup('api', app, document);
  }

  logger.log({
    event: 'http.platform.configured',
    message: `Swagger ${swaggerEnabled ? 'enabled at /api' : 'disabled'}; CORS ${
      corsOrigins.length > 0
        ? `allowed for ${corsOrigins.join(', ')}`
        : 'disabled (same origin only)'
    }`,
    swaggerEnabled,
    corsOrigins,
  });

  return { swaggerEnabled, corsOrigins };
}

/** The service's metrics, when it registered MetricsModule. */
function metricsOf(app: INestApplication): MetricsRegistry | undefined {
  try {
    return app.get(MetricsRegistry, { strict: false });
  } catch {
    return undefined;
  }
}
