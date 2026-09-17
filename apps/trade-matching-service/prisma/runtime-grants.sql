-- What trade-matching-service may do in its database at runtime, and nothing more.
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

-- Offers and requests are created from events and drawn down as they match;
-- trades move from PENDING_BILLING to COMPLETED or FAILED. Nothing is deleted.
GRANT SELECT, INSERT, UPDATE ON sell_offers TO solargrid_app;
GRANT SELECT, INSERT, UPDATE ON buy_requests TO solargrid_app;
GRANT SELECT, INSERT, UPDATE ON trade_matches TO solargrid_app;

COMMIT;
