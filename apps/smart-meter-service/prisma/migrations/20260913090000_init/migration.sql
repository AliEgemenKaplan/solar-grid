-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "EnergyStatus" AS ENUM ('SURPLUS', 'DEMAND', 'BALANCED');

-- CreateTable
CREATE TABLE "meter_readings" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "productionKwh" DECIMAL(12,3) NOT NULL,
    "consumptionKwh" DECIMAL(12,3) NOT NULL,
    "netKwh" DECIMAL(12,3) NOT NULL,
    "status" "EnergyStatus" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meter_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "household_energy_status" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "currentStatus" "EnergyStatus" NOT NULL,
    "currentSurplusKwh" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "currentDemandKwh" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "lastReadingAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "household_energy_status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "routingKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "correlationId" TEXT NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "meter_readings_householdId_timestamp_key" ON "meter_readings"("householdId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "household_energy_status_householdId_key" ON "household_energy_status"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_eventId_key" ON "outbox_events"("eventId");

-- CreateIndex
CREATE INDEX "outbox_events_status_createdAt_idx" ON "outbox_events"("status", "createdAt");

