import Decimal from 'decimal.js';
import { DecimalLike, formatEnergy } from '@solar-grid/shared-utils';

/**
 * The matching algorithm, with no database and no network in sight.
 *
 * It answers one question: given the offers and requests that are currently
 * open, which trades should we attempt? Everything about reserving energy,
 * billing and compensation lives in MatchingService, so the rules here can be
 * tested directly.
 *
 * Amounts are decimals throughout. Subtracting a running balance over and
 * over is exactly where binary floating point leaves dust behind, which used
 * to force an epsilon comparison; with decimals, exhausted means zero.
 */

export interface OfferSnapshot {
  id: string;
  householdId: string;
  availableKwh: DecimalLike;
}

export interface RequestSnapshot {
  id: string;
  householdId: string;
  requestedKwh: DecimalLike;
}

export interface PlannedTrade {
  offerId: string;
  requestId: string;
  sellerHouseholdId: string;
  buyerHouseholdId: string;
  /** kWh, fixed-scale decimal string. */
  energyKwh: string;
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
  const remainingOffers = offers.map((offer) => ({
    ...offer,
    remaining: new Decimal(String(offer.availableKwh)),
  }));
  const remainingRequests = requests.map((request) => ({
    ...request,
    remaining: new Decimal(String(request.requestedKwh)),
  }));

  const trades: PlannedTrade[] = [];
  let skippedSelfMatches = 0;

  for (const offer of remainingOffers) {
    for (const request of remainingRequests) {
      if (offer.remaining.lte(0)) break;
      if (request.remaining.lte(0)) continue;

      if (offer.householdId === request.householdId) {
        skippedSelfMatches++;
        continue;
      }

      const energy = Decimal.min(offer.remaining, request.remaining);
      trades.push({
        offerId: offer.id,
        requestId: request.id,
        sellerHouseholdId: offer.householdId,
        buyerHouseholdId: request.householdId,
        energyKwh: formatEnergy(energy),
      });

      offer.remaining = offer.remaining.minus(energy);
      request.remaining = request.remaining.minus(energy);
    }
  }

  return { trades, skippedSelfMatches };
}
