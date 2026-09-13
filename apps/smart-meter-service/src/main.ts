import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HEADER_CORRELATION_ID } from '@solar-grid/shared-contracts';
import { getOrGenerateCorrelationId } from '@solar-grid/shared-utils';
import type { NextFunction, Request, Response } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = new Logger('Bootstrap');

  // Every request gets a correlation id, and one that arrives unusable - too
  // long, or carrying characters that have no business in a log line - is
  // replaced rather than trusted.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const correlationId = getOrGenerateCorrelationId(req.headers);
    req.headers[HEADER_CORRELATION_ID] = correlationId;
    res.setHeader(HEADER_CORRELATION_ID, correlationId);
    next();
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Smart Meter Service')
    .setDescription(
      'Receives and processes household smart meter readings. Publishes surplus/demand events.',
    )
    .setVersion('1.0')
    .addTag('Readings')
    .addTag('Households')
    .addTag('Health')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api', app, document);

  const port = process.env.PORT || 3001;
  await app.listen(port);
  logger.log(`Smart Meter Service running on port ${port}`);
  logger.log(`Swagger UI available at http://localhost:${port}/api`);
}

bootstrap();
