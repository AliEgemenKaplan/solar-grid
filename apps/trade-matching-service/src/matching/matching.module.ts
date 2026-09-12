import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MatchingController } from './matching.controller';
import { MatchingService } from './matching.service';
import { PricingClient } from '../clients/pricing.client';
import { BillingClient } from '../clients/billing.client';

@Module({
  imports: [HttpModule],
  controllers: [MatchingController],
  providers: [MatchingService, PricingClient, BillingClient],
  exports: [MatchingService],
})
export class MatchingModule {}
