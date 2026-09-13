-- Rules the Prisma schema cannot express. A meter cannot report negative
-- energy, and netKwh is derived, so the database checks that it agrees with
-- the two numbers it came from instead of trusting the caller.

ALTER TABLE "meter_readings"
  ADD CONSTRAINT "meter_readings_production_non_negative" CHECK ("productionKwh" >= 0),
  ADD CONSTRAINT "meter_readings_consumption_non_negative" CHECK ("consumptionKwh" >= 0),
  ADD CONSTRAINT "meter_readings_net_matches_reading" CHECK ("netKwh" = "productionKwh" - "consumptionKwh");

ALTER TABLE "household_energy_status"
  ADD CONSTRAINT "household_energy_status_surplus_non_negative" CHECK ("currentSurplusKwh" >= 0),
  ADD CONSTRAINT "household_energy_status_demand_non_negative" CHECK ("currentDemandKwh" >= 0);

ALTER TABLE "outbox_events"
  ADD CONSTRAINT "outbox_events_attempts_non_negative" CHECK ("attempts" >= 0);
