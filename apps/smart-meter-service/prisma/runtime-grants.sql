-- What smart-meter-service may do in its database at runtime, and nothing more.
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

-- A reading, once taken, is never changed.
GRANT SELECT, INSERT ON meter_readings TO solargrid_app;

-- The latest status per household, upserted with every newer reading.
GRANT SELECT, INSERT, UPDATE ON household_energy_status TO solargrid_app;

-- Written with the reading, then marked published or failed.
GRANT SELECT, INSERT, UPDATE ON outbox_events TO solargrid_app;

COMMIT;
