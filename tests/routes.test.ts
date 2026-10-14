import { describe, expect, it } from 'vitest';
import { planRoute, STOP_MINUTES, type Stop } from '../src/game/routes';

const stops = (...places: Array<Stop['place']>): Stop[] => places.map((place, i) => ({ orderId: i, place }));

describe('planRoute', () => {
  it('has nothing to do for a truck with no stops', () => {
    expect(planRoute([], 420)).toEqual({ visits: [], backAt: 420 });
  });

  it('keeps a Town-only truck close to the depot', () => {
    const plan = planRoute(stops('town', 'town', 'town', 'town'), 420);
    expect(plan.backAt).toBe(420 + 4 * STOP_MINUTES);
    expect(plan.visits).toHaveLength(1);
    expect(plan.visits[0]?.stops.map((s) => s.arriveAt)).toEqual([420, 445, 470, 495]);
  });

  it('serves several orders for the same place in one visit', () => {
    const plan = planRoute(stops('docks', 'docks'), 420);
    expect(plan.visits).toHaveLength(1);
    expect(plan.visits[0]?.arriveAt).toBe(440);
    expect(plan.backAt).toBe(420 + 20 + 2 * STOP_MINUTES + 20);
  });

  it('gets back later when the places are far apart than when they touch', () => {
    const near = planRoute(stops('docks', 'ashby'), 420);
    const far = planRoute(stops('oakley', 'ashby'), 420);
    expect(far.backAt).toBeGreaterThan(near.backAt);
  });

  it('gets back later with two trucks to one place than with one truck', () => {
    const together = planRoute(stops('hollin', 'hollin'), 420);
    const apart = planRoute(stops('hollin'), 420);
    // Each of two trucks drives the same 2 × 20 minutes to Hollin and back.
    expect(apart.backAt - 420).toBe(2 * 20 + STOP_MINUTES);
    expect(together.backAt - 420).toBe(2 * 20 + 2 * STOP_MINUTES);
  });

  it('drives round the edge rather than back through Town twice', () => {
    const plan = planRoute(stops('oakley', 'hollin', 'rushmere'), 420);
    expect(plan.visits.map((v) => v.place)).toEqual(['oakley', 'hollin', 'rushmere']);
    expect(plan.backAt - 420).toBe(25 + 20 + 20 + 25 + 3 * STOP_MINUTES);
  });

  it('gives the same plan however the stops are listed', () => {
    const a = planRoute(stops('ashby', 'oakley', 'docks'), 420);
    const b = planRoute(stops('docks', 'ashby', 'oakley'), 420);
    expect(a.visits.map((v) => v.place)).toEqual(b.visits.map((v) => v.place));
    expect(a.backAt).toBe(b.backAt);
  });
});
