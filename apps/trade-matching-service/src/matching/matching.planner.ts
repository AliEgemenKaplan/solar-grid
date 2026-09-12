/**
 * The matching algorithm, with no database and no network in sight.
 *
 * It answers one question: given the offers and requests that are currently
 * open, which trades should we attempt? Everything about reserving energy,
 * billing and compensation lives in MatchingService, so the rules here can be
 * tested directly.
 */

/** Two floats that differ by less than this are the same amount of energy. */
export const ENERGY_EPSILON = 1e-9;

export interface OfferSnapshot {
  id: string;
  householdId: string;
  availableKwh: number;
}

export interface RequestSnapshot {
  id: string;
  householdId: string;
  requestedKwh: number;
}

export interface PlannedTrade {
  offerId: string;
  requestId: string;
  sellerHouseholdId: string;
  buyerHouseholdId: string;
  energyKwh: number;
}

export interface MatchPlan {
  trades: PlannedTrade[];
  skippedSelfMatches: number;
}

/**
 * Pairs sellers with buyers first-come-first-served, filling partially when
 * the two sides do not match exactly. A household never trades with itself.
 *
 * Callers pass both sides oldest-first; that ordering is the FIFO guarantee.
 */
export function planTrades(offers: OfferSnapshot[], requests: RequestSnapshot[]): MatchPlan {
  const remainingOffers = offers.map((offer) => ({ ...offer }));
  const remainingRequests = requests.map((request) => ({ ...request }));

  const trades: PlannedTrade[] = [];
  let skippedSelfMatches = 0;

  for (const offer of remainingOffers) {
    for (const request of remainingRequests) {
      if (offer.availableKwh <= ENERGY_EPSILON) break;
      if (request.requestedKwh <= ENERGY_EPSILON) continue;

      if (offer.householdId === request.householdId) {
        skippedSelfMatches++;
        continue;
      }

      const energyKwh = Math.min(offer.availableKwh, request.requestedKwh);
      trades.push({
        offerId: offer.id,
        requestId: request.id,
        sellerHouseholdId: offer.householdId,
        buyerHouseholdId: request.householdId,
        energyKwh,
      });

      offer.availableKwh -= energyKwh;
      request.requestedKwh -= energyKwh;
    }
  }

  return { trades, skippedSelfMatches };
}
