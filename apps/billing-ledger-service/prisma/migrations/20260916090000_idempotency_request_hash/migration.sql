-- The column was reserved for a hash of the response but never written. What
-- idempotency actually needs is a hash of the request, so that a key reused
-- with a different payload can be refused instead of silently answered with
-- the original trade. Renaming keeps any existing rows; a NULL hash belongs to
-- a key recorded before hashing existed and is treated as compatible.
ALTER TABLE "idempotency_keys" RENAME COLUMN "responseHash" TO "requestHash";
