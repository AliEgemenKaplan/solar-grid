import { Module } from '@nestjs/common';
import { OffersController } from './offers.controller';
import { MatchingModule } from '../matching/matching.module';

@Module({
  imports: [MatchingModule],
  controllers: [OffersController],
})
export class OffersModule {}
