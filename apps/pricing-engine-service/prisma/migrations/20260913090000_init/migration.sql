-- CreateTable
CREATE TABLE "pricing_rules" (
    "id" TEXT NOT NULL,
    "basePrice" DECIMAL(10,4) NOT NULL,
    "minPrice" DECIMAL(10,4) NOT NULL,
    "maxPrice" DECIMAL(10,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_snapshots" (
    "id" TEXT NOT NULL,
    "totalSupplyKwh" DECIMAL(12,3) NOT NULL,
    "totalDemandKwh" DECIMAL(12,3) NOT NULL,
    "calculatedPrice" DECIMAL(10,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "price_snapshots_createdAt_idx" ON "price_snapshots"("createdAt");

