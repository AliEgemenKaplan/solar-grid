import { Module } from '@nestjs/common';
import { TradesController } from './trades.controller';
import { TradesService } from './trades.service';
import { LedgerMetrics } from '../metrics/ledger.metrics';

@Module({
  controllers: [TradesController],
  providers: [TradesService, LedgerMetrics],
  exports: [TradesService],
})
export class TradesModule {}
