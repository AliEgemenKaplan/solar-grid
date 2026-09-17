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
  logger.log(`Trade Matching Service running on port ${port}`);
  if (swaggerEnabled) {
    logger.log(`Swagger UI available at http://localhost:${port}/api`);
  }
}

bootstrap();
