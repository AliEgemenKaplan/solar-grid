-- A price is never zero or negative, a band with min above max cannot be
-- clamped into, and a currency is a three letter ISO code.

ALTER TABLE "pricing_rules"
  ADD CONSTRAINT "pricing_rules_prices_positive" CHECK ("basePrice" > 0 AND "minPrice" > 0 AND "maxPrice" > 0),
  ADD CONSTRAINT "pricing_rules_min_not_above_max" CHECK ("minPrice" <= "maxPrice"),
  ADD CONSTRAINT "pricing_rules_currency_is_iso_length" CHECK (char_length("currency") = 3);

ALTER TABLE "price_snapshots"
  ADD CONSTRAINT "price_snapshots_price_positive" CHECK ("calculatedPrice" > 0),
  ADD CONSTRAINT "price_snapshots_supply_non_negative" CHECK ("totalSupplyKwh" >= 0),
  ADD CONSTRAINT "price_snapshots_demand_non_negative" CHECK ("totalDemandKwh" >= 0),
  ADD CONSTRAINT "price_snapshots_currency_is_iso_length" CHECK (char_length("currency") = 3);
