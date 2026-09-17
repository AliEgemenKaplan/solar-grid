-- What pricing-engine-service may do in its database at runtime, and nothing more.
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

-- Snapshots form the price history and are only ever added. The default rule
-- is inserted at startup when no rule is active.
GRANT SELECT, INSERT ON pricing_rules TO solargrid_app;
GRANT SELECT, INSERT ON price_snapshots TO solargrid_app;

COMMIT;
