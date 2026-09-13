-- CreateEnum
CREATE TYPE "EntryType" AS ENUM ('CREDIT', 'DEBIT');

-- CreateTable
CREATE TABLE "completed_trades" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "sellerHouseholdId" TEXT NOT NULL,
    "buyerHouseholdId" TEXT NOT NULL,
    "energyKwh" DECIMAL(12,3) NOT NULL,
    "pricePerKwh" DECIMAL(10,4) NOT NULL,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "completed_trades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "entryType" "EntryType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "household_balances" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "household_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "responseHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "completed_trades_tradeId_key" ON "completed_trades"("tradeId");

-- CreateIndex
CREATE UNIQUE INDEX "completed_trades_idempotencyKey_key" ON "completed_trades"("idempotencyKey");

-- CreateIndex
CREATE INDEX "completed_trades_sellerHouseholdId_idx" ON "completed_trades"("sellerHouseholdId");

-- CreateIndex
CREATE INDEX "completed_trades_buyerHouseholdId_idx" ON "completed_trades"("buyerHouseholdId");

-- CreateIndex
CREATE INDEX "completed_trades_correlationId_idx" ON "completed_trades"("correlationId");

-- CreateIndex
CREATE INDEX "ledger_entries_householdId_createdAt_idx" ON "ledger_entries"("householdId", "createdAt");

-- CreateIndex
CREATE INDEX "ledger_entries_tradeId_idx" ON "ledger_entries"("tradeId");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_tradeId_householdId_entryType_key" ON "ledger_entries"("tradeId", "householdId", "entryType");

-- CreateIndex
CREATE UNIQUE INDEX "household_balances_householdId_key" ON "household_balances"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_key_key" ON "idempotency_keys"("key");

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "completed_trades"("tradeId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "completed_trades"("tradeId") ON DELETE RESTRICT ON UPDATE CASCADE;

