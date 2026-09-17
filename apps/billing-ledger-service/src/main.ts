import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { configureHttpApp, installGracefulShutdown } from '@solar-grid/nest-common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = new Logger('Bootstrap');

  // Correlation ids, security headers, CORS, validation, the error contract
  // and Swagger are configured the same way in every service.
  const { swaggerEnabled } = configureHttpApp(app, {
    title: 'Billing & Ledger Service',
    description: 'Records completed trades in an append-only ledger and keeps household balances.',
    tags: ['Trades', 'Balances', 'Ledger', 'Health'],
    credentials: ['internal-service'],
  });

  // Nest's own shutdown hooks are not enabled: this handler runs the same
  // close, with a deadline, and exits with a status that says how it went.
  installGracefulShutdown(app);

  const port = process.env.PORT || 3004;
  await app.listen(port);
  logger.log(`Billing & Ledger Service running on port ${port}`);
  if (swaggerEnabled) {
    logger.log(`Swagger UI available at http://localhost:${port}/api`);
  }
}

bootstrap().catch((err: unknown) => {
  // Anything that stops startup - an unsafe configuration, an unreachable
  // database - ends the process with its reason and a non-zero status.
  Logger.flush();
  new Logger('Bootstrap').error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
