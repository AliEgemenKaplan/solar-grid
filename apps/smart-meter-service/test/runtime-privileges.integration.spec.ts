import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  DATABASE_ROLE_QUERY,
  DatabaseRoleFacts,
  UnsafeConfigurationError,
  verifyRuntimeDatabaseRole,
} from '@solar-grid/nest-common';
import { PrismaClient } from '../generated/client';
import { AppModule } from '../src/app.module';
import { OutboxPublisherService } from '../src/messaging/outbox-publisher.service';
import { ReadingsService } from '../src/readings/readings.service';
import { HouseholdsService } from '../src/households/households.service';
import {
  RUNTIME_ROLE,
  RuntimeDatabase,
  SCHEMA_CHANGES,
  startRuntimeDatabase,
  TABLES_WITHOUT_RUNTIME_GRANT,
} from './support/runtime-database';

jest.setTimeout(300_000);

const ORIGINAL_ENV = { ...process.env };

describe('smart-meter runtime database privileges', () => {
  let database: RuntimeDatabase;
  let runtime: PrismaClient;
  let owner: PrismaClient;
  let app: INestApplication;

  beforeAll(async () => {
    database = await startRuntimeDatabase();
    runtime = new PrismaClient({ datasourceUrl: database.runtimeUrl });
    owner = new PrismaClient({ datasourceUrl: database.ownerUrl });

    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      DATABASE_URL: database.runtimeUrl,
      // Nothing listens here: publishing fails, which is the path that
      // updates an outbox row, and readings are still accepted.
      RABBITMQ_URL: 'amqp://solargrid:unreachable-broker-password-0123@127.0.0.1:1',
      OUTBOX_POLL_INTERVAL_MS: '3600000',
      OUTBOX_PUBLISH_TIMEOUT_MS: '300',
      RATE_LIMIT_ENABLED: 'false',
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await runtime?.$disconnect();
    await owner?.$disconnect();
    await database?.container.stop();
    process.env = ORIGINAL_ENV;
  });

  it('stores readings, updates household status and records publish attempts as the runtime role', async () => {
    const readings = app.get(ReadingsService);
    const first = await readings.createReading(
      {
        householdId: 'HH-PRIV',
        productionKwh: 8.5,
        consumptionKwh: 3.2,
        timestamp: '2026-05-27T10:00:00.000Z',
      },
      'cid-privileges-1',
    );
    expect(first.duplicate).toBe(false);

    // A later reading for the same household updates its status row.
    await readings.createReading(
      {
        householdId: 'HH-PRIV',
        productionKwh: 1,
        consumptionKwh: 4,
        timestamp: '2026-05-27T10:15:00.000Z',
      },
      'cid-privileges-2',
    );
    const status = await app.get(HouseholdsService).getStatus('HH-PRIV');
    expect(status.currentStatus).toBe('DEMAND');

    // The broker is unreachable, so the publisher records the failed attempt -
    // an UPDATE on outbox_events. Each reading already started a drain in the
    // background, and overlapping drains are skipped, so keep asking.
    const publisher = app.get(OutboxPublisherService);
    const deadline = Date.now() + 15_000;
    let attempted = false;
    while (!attempted && Date.now() < deadline) {
      await publisher.drain();
      attempted = (await owner.outboxEvent.count({ where: { attempts: { gt: 0 } } })) > 0;
      if (!attempted) await new Promise((resolve) => setTimeout(resolve, 200));
    }
    expect(attempted).toBe(true);

    const events = await owner.outboxEvent.findMany();
    expect(events.length).toBe(2);
    expect(events.every((event) => event.status === 'PENDING')).toBe(true);
  });

  it('connects as a role that is neither a superuser nor an owner', async () => {
    const [facts] = await runtime.$queryRawUnsafe<DatabaseRoleFacts[]>(DATABASE_ROLE_QUERY);
    expect(facts).toEqual({
      user: RUNTIME_ROLE,
      superuser: false,
      ownsDatabase: false,
      ownsTables: false,
    });
  });

  it.each([
    ['rewrite a meter reading', `UPDATE meter_readings SET "productionKwh" = 0`],
    ['delete a meter reading', `DELETE FROM meter_readings`],
    ['delete an outbox event', `DELETE FROM outbox_events`],
    ['wipe household status', `TRUNCATE household_energy_status`],
    ['drop the outbox', `DROP TABLE outbox_events`],
    ...SCHEMA_CHANGES.map((sql) => [sql, sql]),
  ])('cannot %s', async (_what, sql) => {
    await expect(runtime.$executeRawUnsafe(sql)).rejects.toThrow(/permission denied|must be owner/);
  });

  it('can read every table the migrations created', async () => {
    expect(await owner.$queryRawUnsafe(TABLES_WITHOUT_RUNTIME_GRANT)).toEqual([]);
  });

  it('refuses the owner role in production', async () => {
    await expect(
      verifyRuntimeDatabaseRole(
        (sql) => owner.$queryRawUnsafe<DatabaseRoleFacts[]>(sql),
        'production',
      ),
    ).rejects.toThrow(UnsafeConfigurationError);
  });
});
