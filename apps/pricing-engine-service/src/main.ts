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
    title: 'Pricing Engine Service',
    description: 'Dynamic local energy pricing based on neighbourhood supply and demand.',
    tags: ['Prices', 'Health'],
    credentials: ['operator'],
  });

  // Nest's own shutdown hooks are not enabled: this handler runs the same
  // close, with a deadline, and exits with a status that says how it went.
  installGracefulShutdown(app);

  const port = process.env.PORT || 3002;
  await app.listen(port);
  logger.log(`Pricing Engine Service running on port ${port}`);
  if (swaggerEnabled) {
    logger.log(`Swagger UI available at http://localhost:${port}/api`);
  }
}

bootstrap();
