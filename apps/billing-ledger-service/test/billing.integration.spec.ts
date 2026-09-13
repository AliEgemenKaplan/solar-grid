import { execSync } from 'node:child_process';
import path from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaClient } from '../generated/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { TradesService } from '../src/trades/trades.service';
import { CreateTradeDto } from '../src/trades/dto/create-trade.dto';

jest.setTimeout(240_000);

const appRoot = path.resolve(__dirname, '..');

function migrate(databaseUrl: string) {
  return execSync('pnpm exec prisma migrate deploy', {
    cwd: appRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
  }).toString();
}

const trade = (overrides: Partial<CreateTradeDto> = {}): CreateTradeDto => ({
  tradeId: 'TRD-001',
  sellerHouseholdId: 'HH-SELLER',
  buyerHouseholdId: 'HH-BUYER',
  energyKwh: '4.000',
  pricePerKwh: '4.0000',
  totalAmount: '16.00',
  currency: 'TRY',
  idempotencyKey: 'TRD-001',
  correlationId: 'cid-1',
  completedAt: '2026-05-27T10:10:00.000Z',
  ...overrides,
});

describe('billing against a real database', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let service: TradesService;
  let databaseUrl: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:15-alpine').start();
    databaseUrl = container.getConnectionUri();
    migrate(databaseUrl);
    prisma = new PrismaClient({ datasourceUrl: databaseUrl });
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  beforeEach(async () => {
    await prisma.ledgerEntry.deleteMany();
    await prisma.idempotencyKey.deleteMany();
    await prisma.completedTrade.deleteMany();
    await prisma.householdBalance.deleteMany();
    service = new TradesService(prisma as unknown as PrismaService);
  });

  describe('migrations', () => {
    it('builds the schema from committed migrations on an empty database', async () => {
      const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' ORDER BY table_name
      `;
      const names = tables.map((row) => row.table_name);

      expect(names).toEqual(
        expect.arrayContaining([
          '_prisma_migrations',
          'completed_trades',
          'household_balances',
          'idempotency_keys',
          'ledger_entries',
        ]),
      );
    });

    it('is a no-op when deployed a second time', () => {
      const output = migrate(databaseUrl);
      expect(output).toMatch(/No pending migrations|already in sync|Applying migration/i);

      // And the schema still works afterwards.
      return expect(prisma.completedTrade.count()).resolves.toBe(0);
    });

    it('stores money as numeric, not as a floating point type', async () => {
      const columns = await prisma.$queryRaw<Array<{ column_name: string; data_type: string }>>`
        SELECT column_name, data_type FROM information_schema.columns
        WHERE table_name = 'completed_trades'
          AND column_name IN ('energyKwh', 'pricePerKwh', 'totalAmount')
      `;

      expect(columns).toHaveLength(3);
      expect(columns.every((column) => column.data_type === 'numeric')).toBe(true);
    });
  });

  describe('settling a trade', () => {
    it('writes one credit, one debit and both balances', async () => {
      const result = await service.createTrade(trade());

      expect(result?.duplicate).toBe(false);
      expect(result?.totalAmount).toBe('16.00');

      const entries = await prisma.ledgerEntry.findMany({ orderBy: { entryType: 'asc' } });
      expect(entries.map((entry) => [entry.householdId, entry.entryType])).toEqual([
        ['HH-SELLER', 'CREDIT'],
        ['HH-BUYER', 'DEBIT'],
      ]);

      const seller = await prisma.householdBalance.findUniqueOrThrow({
        where: { householdId: 'HH-SELLER' },
      });
      const buyer = await prisma.householdBalance.findUniqueOrThrow({
        where: { householdId: 'HH-BUYER' },
      });
      expect(seller.balance.toFixed(2)).toBe('16.00');
      expect(buyer.balance.toFixed(2)).toBe('-16.00');
    });

    it('settles the same trade only once when it is sent twice', async () => {
      await service.createTrade(trade());
      const second = await service.createTrade(trade());

      expect(second?.duplicate).toBe(true);
      expect(await prisma.completedTrade.count()).toBe(1);
      expect(await prisma.ledgerEntry.count()).toBe(2);

      const seller = await prisma.householdBalance.findUniqueOrThrow({
        where: { householdId: 'HH-SELLER' },
      });
      expect(seller.balance.toFixed(2)).toBe('16.00');
    });

    it('settles once when two identical requests arrive together', async () => {
      const [first, second] = await Promise.allSettled([
        service.createTrade(trade()),
        service.createTrade(trade()),
      ]);

      expect([first.status, second.status]).toEqual(['fulfilled', 'fulfilled']);
      expect(await prisma.completedTrade.count()).toBe(1);
      expect(await prisma.ledgerEntry.count()).toBe(2);

      const seller = await prisma.householdBalance.findUniqueOrThrow({
        where: { householdId: 'HH-SELLER' },
      });
      // The decisive check: the money moved once, not twice.
      expect(seller.balance.toFixed(2)).toBe('16.00');
    });

    it('adds up amounts exactly, where floating point would drift', async () => {
      await service.createTrade(
        trade({ tradeId: 'TRD-A', idempotencyKey: 'TRD-A', totalAmount: '0.10' }),
      );
      await service.createTrade(
        trade({ tradeId: 'TRD-B', idempotencyKey: 'TRD-B', totalAmount: '0.20' }),
      );

      const seller = await prisma.householdBalance.findUniqueOrThrow({
        where: { householdId: 'HH-SELLER' },
      });
      // 0.1 + 0.2 is 0.30000000000000004 in binary floating point.
      expect(seller.balance.toFixed(2)).toBe('0.30');
    });
  });

  describe('states the database refuses', () => {
    it('rejects a second pair of ledger entries for the same trade', async () => {
      await service.createTrade(trade());

      await expect(
        prisma.ledgerEntry.create({
          data: {
            tradeId: 'TRD-001',
            householdId: 'HH-SELLER',
            entryType: 'CREDIT',
            amount: '16.00',
            currency: 'TRY',
            correlationId: 'cid-replay',
          },
        }),
      ).rejects.toThrow();

      expect(await prisma.ledgerEntry.count()).toBe(2);
    });

    it('rejects a household trading with itself, in the service and in the schema', async () => {
      await expect(
        service.createTrade(trade({ buyerHouseholdId: 'HH-SELLER' })),
      ).rejects.toBeInstanceOf(BadRequestException);

      await expect(
        prisma.completedTrade.create({
          data: {
            tradeId: 'TRD-SELF',
            sellerHouseholdId: 'HH-SAME',
            buyerHouseholdId: 'HH-SAME',
            energyKwh: '1.000',
            pricePerKwh: '1.0000',
            totalAmount: '1.00',
            currency: 'TRY',
            idempotencyKey: 'TRD-SELF',
            correlationId: 'cid-self',
            completedAt: new Date(),
          },
        }),
      ).rejects.toThrow();
    });

    it.each([
      ['negative energy', { energyKwh: '-1.000' }],
      ['zero energy', { energyKwh: '0.000' }],
      ['negative price', { pricePerKwh: '-4.0000' }],
      ['negative total', { totalAmount: '-16.00' }],
      ['a currency that is not a three letter code', { currency: 'TURKISH' }],
    ])('rejects %s', async (_label, overrides) => {
      await expect(
        prisma.completedTrade.create({
          data: {
            tradeId: `TRD-${Math.random()}`,
            sellerHouseholdId: 'HH-SELLER',
            buyerHouseholdId: 'HH-BUYER',
            energyKwh: '4.000',
            pricePerKwh: '4.0000',
            totalAmount: '16.00',
            currency: 'TRY',
            idempotencyKey: `KEY-${Math.random()}`,
            correlationId: 'cid-invalid',
            completedAt: new Date(),
            ...overrides,
          },
        }),
      ).rejects.toThrow();
    });

    it('rejects a negative ledger amount', async () => {
      await service.createTrade(trade());

      await expect(
        prisma.ledgerEntry.create({
          data: {
            tradeId: 'TRD-001',
            householdId: 'HH-THIRD',
            entryType: 'CREDIT',
            amount: '-5.00',
            currency: 'TRY',
            correlationId: 'cid-negative',
          },
        }),
      ).rejects.toThrow();
    });

    it('rejects a ledger entry for a trade that does not exist', async () => {
      await expect(
        prisma.ledgerEntry.create({
          data: {
            tradeId: 'TRD-GHOST',
            householdId: 'HH-SELLER',
            entryType: 'CREDIT',
            amount: '5.00',
            currency: 'TRY',
            correlationId: 'cid-ghost',
          },
        }),
      ).rejects.toThrow();
    });
  });
});
