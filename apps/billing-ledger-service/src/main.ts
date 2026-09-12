import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HEADER_CORRELATION_ID } from '@solar-grid/shared-contracts';
import { randomUUID } from 'node:crypto';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = new Logger('Bootstrap');

  app.use((req, res, next) => {
    if (!req.headers[HEADER_CORRELATION_ID]) {
      req.headers[HEADER_CORRELATION_ID] = randomUUID();
    }
    res.setHeader(HEADER_CORRELATION_ID, req.headers[HEADER_CORRELATION_ID]);
    next();
  });

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Billing & Ledger Service')
    .setDescription(
      'Records completed trades, manages immutable ledger entries and household balances.',
    )
    .setVersion('1.0')
    .addTag('Trades')
    .addTag('Balances')
    .addTag('Ledger')
    .addTag('Health')
    .build();

  SwaggerModule.setup('api', app, SwaggerModule.createDocument(app, swaggerConfig));

  const port = process.env.PORT || 3004;
  await app.listen(port);
  logger.log(`Billing & Ledger Service running on port ${port}`);
  logger.log(`Swagger UI available at http://localhost:${port}/api`);
}

bootstrap();
