-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('OPEN', 'PARTIALLY_MATCHED', 'MATCHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('OPEN', 'PARTIALLY_MATCHED', 'MATCHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TradeStatus" AS ENUM ('PENDING_BILLING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "sell_offers" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "sourceEventId" TEXT,
    "availableKwh" DECIMAL(12,3) NOT NULL,
    "originalKwh" DECIMAL(12,3) NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'OPEN',
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sell_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buy_requests" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "sourceEventId" TEXT,
    "requestedKwh" DECIMAL(12,3) NOT NULL,
    "originalKwh" DECIMAL(12,3) NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'OPEN',
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buy_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_matches" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "sellerHouseholdId" TEXT NOT NULL,
    "buyerHouseholdId" TEXT NOT NULL,
    "energyKwh" DECIMAL(12,3) NOT NULL,
    "pricePerKwh" DECIMAL(10,4) NOT NULL,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "TradeStatus" NOT NULL DEFAULT 'PENDING_BILLING',
    "billingTradeId" TEXT,
    "offerId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "billingAttempts" INTEGER NOT NULL DEFAULT 0,
    "correlationId" TEXT NOT NULL,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trade_matches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sell_offers_sourceEventId_key" ON "sell_offers"("sourceEventId");

-- CreateIndex
CREATE INDEX "sell_offers_status_createdAt_idx" ON "sell_offers"("status", "createdAt");

-- CreateIndex
CREATE INDEX "sell_offers_householdId_idx" ON "sell_offers"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "buy_requests_sourceEventId_key" ON "buy_requests"("sourceEventId");

-- CreateIndex
CREATE INDEX "buy_requests_status_createdAt_idx" ON "buy_requests"("status", "createdAt");

-- CreateIndex
CREATE INDEX "buy_requests_householdId_idx" ON "buy_requests"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "trade_matches_tradeId_key" ON "trade_matches"("tradeId");

-- CreateIndex
CREATE UNIQUE INDEX "trade_matches_idempotencyKey_key" ON "trade_matches"("idempotencyKey");

-- CreateIndex
CREATE INDEX "trade_matches_status_createdAt_idx" ON "trade_matches"("status", "createdAt");

-- CreateIndex
CREATE INDEX "trade_matches_offerId_idx" ON "trade_matches"("offerId");

-- CreateIndex
CREATE INDEX "trade_matches_requestId_idx" ON "trade_matches"("requestId");

-- CreateIndex
CREATE INDEX "trade_matches_correlationId_idx" ON "trade_matches"("correlationId");

-- AddForeignKey
ALTER TABLE "trade_matches" ADD CONSTRAINT "trade_matches_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "sell_offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_matches" ADD CONSTRAINT "trade_matches_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "buy_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

