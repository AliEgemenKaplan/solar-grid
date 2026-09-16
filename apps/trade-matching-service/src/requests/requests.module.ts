import { Module } from '@nestjs/common';
import { RequestsController } from './requests.controller';
import { MatchingModule } from '../matching/matching.module';

@Module({
  imports: [MatchingModule],
  controllers: [RequestsController],
})
export class RequestsModule {}
