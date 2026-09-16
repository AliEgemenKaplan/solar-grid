-- GET /offers and GET /requests can be filtered by correlation id, so a
-- reading can be traced to the offer or request it produced without scanning.
CREATE INDEX "sell_offers_correlationId_idx" ON "sell_offers"("correlationId");
CREATE INDEX "buy_requests_correlationId_idx" ON "buy_requests"("correlationId");
