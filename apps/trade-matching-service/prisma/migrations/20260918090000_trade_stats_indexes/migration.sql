-- GET /stats/* reads a window of trades across every status, which the
-- (status, createdAt) index cannot serve, and filters household trading by
-- either side of the trade.
CREATE INDEX "trade_matches_createdAt_idx" ON "trade_matches"("createdAt");
CREATE INDEX "trade_matches_sellerHouseholdId_idx" ON "trade_matches"("sellerHouseholdId");
CREATE INDEX "trade_matches_buyerHouseholdId_idx" ON "trade_matches"("buyerHouseholdId");
