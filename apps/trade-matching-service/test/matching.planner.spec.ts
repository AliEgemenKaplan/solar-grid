import { planTrades, OfferSnapshot, RequestSnapshot } from '../src/matching/matching.planner';

const offer = (id: string, householdId: string, availableKwh: number): OfferSnapshot => ({
  id,
  householdId,
  availableKwh,
});

const request = (id: string, householdId: string, requestedKwh: number): RequestSnapshot => ({
  id,
  householdId,
  requestedKwh,
});

describe('planTrades', () => {
  it('pairs one seller with one buyer when the amounts match exactly', () => {
    const plan = planTrades([offer('s1', 'HH-SELLER', 4)], [request('b1', 'HH-BUYER', 4)]);

    expect(plan.trades).toEqual([
      {
        offerId: 's1',
        requestId: 'b1',
        sellerHouseholdId: 'HH-SELLER',
        buyerHouseholdId: 'HH-BUYER',
        energyKwh: 4,
      },
    ]);
  });

  it('fills partially and leaves the rest of the offer for later', () => {
    const plan = planTrades([offer('s1', 'HH-SELLER', 10)], [request('b1', 'HH-BUYER', 4)]);

    expect(plan.trades).toHaveLength(1);
    expect(plan.trades[0].energyKwh).toBe(4);
  });

  it('spreads one offer across several buyers in arrival order', () => {
    const plan = planTrades(
      [offer('s1', 'HH-SELLER', 10)],
      [request('b1', 'HH-A', 4), request('b2', 'HH-B', 3), request('b3', 'HH-C', 5)],
    );

    expect(plan.trades.map((trade) => [trade.requestId, trade.energyKwh])).toEqual([
      ['b1', 4],
      ['b2', 3],
      // Only 3 kWh of the 5 requested are left on the offer.
      ['b3', 3],
    ]);
  });

  it('serves the oldest offer first', () => {
    const plan = planTrades(
      [offer('older', 'HH-FIRST', 4), offer('newer', 'HH-SECOND', 4)],
      [request('b1', 'HH-BUYER', 4)],
    );

    expect(plan.trades).toHaveLength(1);
    expect(plan.trades[0].offerId).toBe('older');
  });

  it('never matches a household with itself', () => {
    const plan = planTrades([offer('s1', 'HH-SAME', 10)], [request('b1', 'HH-SAME', 4)]);

    expect(plan.trades).toHaveLength(0);
    expect(plan.skippedSelfMatches).toBe(1);
  });

  it('still serves other buyers after skipping the seller itself', () => {
    const plan = planTrades(
      [offer('s1', 'HH-SAME', 6)],
      [request('b1', 'HH-SAME', 4), request('b2', 'HH-OTHER', 6)],
    );

    expect(plan.skippedSelfMatches).toBe(1);
    expect(plan.trades).toEqual([
      {
        offerId: 's1',
        requestId: 'b2',
        sellerHouseholdId: 'HH-SAME',
        buyerHouseholdId: 'HH-OTHER',
        energyKwh: 6,
      },
    ]);
  });

  it('plans nothing when one side is empty', () => {
    expect(planTrades([], [request('b1', 'HH-BUYER', 4)]).trades).toHaveLength(0);
    expect(planTrades([offer('s1', 'HH-SELLER', 4)], []).trades).toHaveLength(0);
  });

  it('does not plan dust trades left behind by floating point arithmetic', () => {
    // 0.3 - 0.1 - 0.2 lands a hair above zero in binary floating point.
    const plan = planTrades(
      [offer('s1', 'HH-SELLER', 0.3)],
      [request('b1', 'HH-A', 0.1), request('b2', 'HH-B', 0.2), request('b3', 'HH-C', 5)],
    );

    expect(plan.trades).toHaveLength(2);
    expect(plan.trades.map((trade) => trade.requestId)).toEqual(['b1', 'b2']);
  });

  it('leaves the inputs untouched', () => {
    const offers = [offer('s1', 'HH-SELLER', 10)];
    const requests = [request('b1', 'HH-BUYER', 4)];

    planTrades(offers, requests);

    expect(offers[0].availableKwh).toBe(10);
    expect(requests[0].requestedKwh).toBe(4);
  });
});
