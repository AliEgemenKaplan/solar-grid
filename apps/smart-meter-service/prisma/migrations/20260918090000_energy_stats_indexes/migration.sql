-- GET /stats/* filters and buckets readings by their timestamp across every
-- household. The (householdId, timestamp) unique index cannot serve that: its
-- leading column is the household, so a window over the whole neighbourhood
-- would be a sequential scan.
CREATE INDEX "meter_readings_timestamp_idx" ON "meter_readings"("timestamp");
