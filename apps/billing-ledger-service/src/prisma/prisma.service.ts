import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { DatabaseRoleFacts, verifyRuntimeDatabaseRole } from '@solar-grid/nest-common';
import { PrismaClient } from '../../generated/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  async onModuleInit() {
    await this.$connect();
    // Refuses, in production, to run as a superuser or as the owner of the
    // database: grants mean nothing to either.
    await verifyRuntimeDatabaseRole((sql) => this.$queryRawUnsafe<DatabaseRoleFacts[]>(sql));
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
