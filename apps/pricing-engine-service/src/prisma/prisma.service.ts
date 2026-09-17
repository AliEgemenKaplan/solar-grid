import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '../../generated/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  async onModuleInit() {
    await this.$connect();
  }

  /**
   * The last thing to close. Consumers and the outbox stop in
   * beforeApplicationShutdown and the HTTP server closes after that, so
   * everything that could still be writing has finished by now.
   */
  async onApplicationShutdown() {
    await this.$disconnect();
  }
}
