-- GET /stats/* reads windows of settled trades and of ledger entries. The
-- ledger's (householdId, createdAt) index starts with the household, so a
-- window over every household would be a sequential scan.
CREATE INDEX "completed_trades_completedAt_idx" ON "completed_trades"("completedAt");
CREATE INDEX "ledger_entries_createdAt_idx" ON "ledger_entries"("createdAt");
