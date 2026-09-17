-- What billing-ledger-service may do in its database at runtime, and nothing more.
--
-- Applied by the migration job, as the database owner, straight after
-- `prisma migrate deploy`. Everything is revoked first, so this file is the
-- whole truth: a privilege removed here is removed from the database on the
-- next deploy. A new table stays out of reach until it is listed here, and the
-- runtime-privileges integration test fails until it is.
--
-- solargrid_app itself is created by infrastructure/postgres/create-app-role.sh.
BEGIN;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM solargrid_app;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM solargrid_app;

-- The ledger is append-only, and here the database holds the service to it:
-- no UPDATE or DELETE on a recorded trade, a ledger entry or a used key.
GRANT SELECT, INSERT ON completed_trades TO solargrid_app;
GRANT SELECT, INSERT ON ledger_entries TO solargrid_app;
GRANT SELECT, INSERT ON idempotency_keys TO solargrid_app;

-- A balance is the one running total, moved on every trade.
GRANT SELECT, INSERT, UPDATE ON household_balances TO solargrid_app;

COMMIT;
