import { Module } from '@nestjs/common';
import { PricesController } from './prices.controller';
import { PricesService } from './prices.service';
import { PricingMetrics } from '../metrics/pricing.metrics';

@Module({
  controllers: [PricesController],
  providers: [PricesService, PricingMetrics],
})
export class PricesModule {}
