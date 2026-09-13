-- An offer can never have more energy left than it started with, and it can
-- never go negative: those two are the database level statement of what the
-- reservation logic promises.

ALTER TABLE "sell_offers"
  ADD CONSTRAINT "sell_offers_original_positive" CHECK ("originalKwh" > 0),
  ADD CONSTRAINT "sell_offers_available_within_original" CHECK ("availableKwh" >= 0 AND "availableKwh" <= "originalKwh");

ALTER TABLE "buy_requests"
  ADD CONSTRAINT "buy_requests_original_positive" CHECK ("originalKwh" > 0),
  ADD CONSTRAINT "buy_requests_requested_within_original" CHECK ("requestedKwh" >= 0 AND "requestedKwh" <= "originalKwh");

-- A household trading with itself is not a trade.
ALTER TABLE "trade_matches"
  ADD CONSTRAINT "trade_matches_energy_positive" CHECK ("energyKwh" > 0),
  ADD CONSTRAINT "trade_matches_price_positive" CHECK ("pricePerKwh" > 0),
  ADD CONSTRAINT "trade_matches_total_non_negative" CHECK ("totalAmount" >= 0),
  ADD CONSTRAINT "trade_matches_parties_differ" CHECK ("sellerHouseholdId" <> "buyerHouseholdId"),
  ADD CONSTRAINT "trade_matches_currency_is_iso_length" CHECK (char_length("currency") = 3),
  ADD CONSTRAINT "trade_matches_attempts_non_negative" CHECK ("billingAttempts" >= 0);
