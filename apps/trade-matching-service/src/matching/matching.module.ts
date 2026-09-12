import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MatchingController } from './matching.controller';
import { MatchingService } from './matching.service';
import { PricingClient } from '../clients/pricing.client';
import { BillingClient } from '../clients/billing.client';

const DEFAULT_HTTP_TIMEOUT_MS = 5000;

@Module({
  imports: [
    HttpModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        // Without a deadline a hung pricing or billing call blocks the only
        // consumer channel, and with prefetch 1 that stalls every event.
        timeout: Number(
          config.get<string>('HTTP_CLIENT_TIMEOUT_MS', String(DEFAULT_HTTP_TIMEOUT_MS)),
        ),
        maxRedirects: 0,
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [MatchingController],
  providers: [MatchingService, PricingClient, BillingClient],
  exports: [MatchingService],
})
export class MatchingModule {}
