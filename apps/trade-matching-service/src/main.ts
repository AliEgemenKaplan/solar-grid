import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import {
  configureHttpApp,
  createServiceLogger,
  installGracefulShutdown,
} from '@solar-grid/nest-common';
import { AppModule } from './app.module';

// One structured logger for the whole process, Nest's own output included:
// JSON lines in production, readable lines in development, secrets redacted.
const serviceLogger = createServiceLogger('trade-matching-service');

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: serviceLogger });
  const logger = new Logger('Bootstrap');

  // Correlation ids, security headers, CORS, validation, the error contract
  // and Swagger are configured the same way in every service.
  const { swaggerEnabled } = configureHttpApp(app, {
    title: 'Trade Matching Service',
    description:
      'Matches surplus with demand first-come-first-served, reserving energy before billing it.',
    tags: ['Matching', 'Offers', 'Requests', 'Health'],
    credentials: ['operator', 'internal-service'],
  });

  // Nest's own shutdown hooks are not enabled: this handler runs the same
  // close, with a deadline, and exits with a status that says how it went.
  installGracefulShutdown(app);

  const port = process.env.PORT || 3003;
  await app.listen(port);
  logger.log({
    event: 'service.started',
    message: `Trade Matching Service running on port ${port}`,
    port: Number(port),
    swaggerEnabled,
  });
}

bootstrap().catch((err: unknown) => {
  // Anything that stops startup - an unsafe configuration, an unreachable
  // database - ends the process with its reason and a non-zero status.
  serviceLogger.error(
    {
      event: 'service.start_failed',
      message: err instanceof Error ? err.message : String(err),
    },
    'Bootstrap',
  );
  process.exit(1);
});
