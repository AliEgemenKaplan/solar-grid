-- The ledger is the financial record, so the impossible states are refused
-- here rather than relying on the caller. The direction of money is carried
-- by entryType, so the amount itself is never negative.

ALTER TABLE "completed_trades"
  ADD CONSTRAINT "completed_trades_energy_positive" CHECK ("energyKwh" > 0),
  ADD CONSTRAINT "completed_trades_price_positive" CHECK ("pricePerKwh" > 0),
  ADD CONSTRAINT "completed_trades_total_non_negative" CHECK ("totalAmount" >= 0),
  ADD CONSTRAINT "completed_trades_parties_differ" CHECK ("sellerHouseholdId" <> "buyerHouseholdId"),
  ADD CONSTRAINT "completed_trades_currency_is_iso_length" CHECK (char_length("currency") = 3);

ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_entries_amount_non_negative" CHECK ("amount" >= 0),
  ADD CONSTRAINT "ledger_entries_currency_is_iso_length" CHECK (char_length("currency") = 3);

ALTER TABLE "household_balances"
  ADD CONSTRAINT "household_balances_currency_is_iso_length" CHECK (char_length("currency") = 3);
