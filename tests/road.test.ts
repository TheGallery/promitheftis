import { describe, expect, it } from 'vitest';
import { DEPART_MINUTE, formatTime } from '../src/game/clock';
import { Desk } from '../src/game/desk';
import { bigMorning, smallMorning } from '../src/game/morning';
import { buildResult } from '../src/game/results';
import { buildRoad, happened, truckState } from '../src/game/road';
import { STOP_MINUTES } from '../src/game/routes';

const idx = (d: Desk, client: string) => d.morning.orders.findIndex((o) => o.client === client);

function handOut(d: Desk, client: string, truck: number) {
  const o = idx(d, client);
  d.morning.orders[o]!.lines.forEach((_, l) => d.acceptLine(o, l));
  d.assignTruck(o, truck);
  d.finishOrder(o);
}

/** The small morning as the app tests play it: truck 1 to Saltmarket and Docks, truck 2 to Fenwick and Millford. */
function smallDay() {
  const d = new Desk(smallMorning());
  const trucks: Record<string, number> = {
    'Café Lumen': 1, "Rosa's": 2, 'The Anchor': 2, 'Golden Dragon': 1, 'Hotel Bellevue': 1, 'Burger Shack': 1, 'The Plough': 2,
  };
  for (const [client, truck] of Object.entries(trucks)) handOut(d, client, truck);
  const result = buildResult(d, DEPART_MINUTE);
  return { d, result, road: buildRoad(d, result) };
}

describe('buildRoad', () => {
  it('has each truck leave at 07:00 and come back when the result says', () => {
    const { result, road } = smallDay();
    for (const t of result.trucks) {
      const leave = road.events.find((e) => e.truckId === t.truckId && e.kind === 'leave');
      const back = road.events.find((e) => e.truckId === t.truckId && e.kind === 'back');
      expect(leave?.at).toBe(DEPART_MINUTE);
      expect(back?.at).toBe(t.backAt);
    }
    expect(road.end).toBe(result.lastBack);
  });

  it('delivers to every client at the time the route reaches them, with the items given', () => {
    const { d, result, road } = smallDay();
    const deliveries = road.events.filter((e) => e.kind === 'deliver');
    expect(deliveries).toHaveLength(7);
    for (const e of deliveries) {
      if (e.kind !== 'deliver') continue;
      expect(e.at).toBe(result.orders[e.orderIndex]!.arriveAt);
      expect(e.items).toBe(d.unitsGiven(e.orderIndex));
      expect(e.client).toBe(d.order(e.orderIndex).client);
    }
  });

  it('keeps the events in time order, a short note straight after its delivery, and a truck back last', () => {
    const { road } = smallDay();
    const times = road.events.map((e) => e.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    road.events.forEach((e, i) => {
      if (e.kind === 'short') expect(road.events[i - 1]).toMatchObject({ kind: 'deliver', truckId: e.truckId, at: e.at });
    });
    for (const t of road.trucks) {
      const mine = road.events.filter((e) => e.truckId === t.truckId);
      expect(mine[0]?.kind).toBe('leave');
      expect(mine[mine.length - 1]?.kind).toBe('back');
    }
  });

  it('notes a short delivery gently, and only for clients who got less', () => {
    const { d, road } = smallDay();
    const shorts = road.events.filter((e) => e.kind === 'short');
    const plough = idx(d, 'The Plough');
    const after = road.events.findIndex((e) => e.kind === 'deliver' && e.orderIndex === plough) + 1;
    expect(road.events[after]).toMatchObject({ kind: 'short' });
    expect(shorts.length).toBeGreaterThan(0);
    expect(shorts.length).toBeLessThan(7);
  });

  it('leaves a truck with nothing on it in the yard', () => {
    const d = new Desk(smallMorning());
    handOut(d, 'Golden Dragon', 1);
    const road = buildRoad(d, buildResult(d, DEPART_MINUTE));
    expect(road.trucks.map((t) => t.truckId)).toEqual([1]);
    expect(road.events.every((e) => e.truckId === 1)).toBe(true);
  });

  it('follows the stop time between clients of the same place', () => {
    const { road } = smallDay();
    for (const t of road.trucks) {
      for (let i = 1; i < t.stops.length; i++) {
        const [a, b] = [t.stops[i - 1]!, t.stops[i]!];
        if (a.place === b.place) expect(b.arriveAt - a.arriveAt).toBe(STOP_MINUTES);
      }
    }
  });

  it('works for the big morning with every truck', () => {
    const d = new Desk(bigMorning());
    d.morning.orders.forEach((order, o) => {
      order.lines.forEach((_, l) => d.acceptLine(o, l));
      for (const t of d.morning.trucks) if (d.assignTruck(o, t.id).ok) break;
      d.finishOrder(o);
    });
    const result = buildResult(d, DEPART_MINUTE);
    const road = buildRoad(d, result);
    expect(road.trucks).toHaveLength(result.trucks.filter((t) => t.backAt != null).length);
    for (const t of road.trucks) expect(t.backAt).toBe(result.trucks.find((x) => x.truckId === t.truckId)?.backAt);
    expect(road.events.filter((e) => e.kind === 'deliver')).toHaveLength(result.orders.filter((o) => o.arriveAt != null).length);
  });
});

describe('the road clock', () => {
  it('shows only what has happened by the clock', () => {
    const { road } = smallDay();
    // At 07:00 the trucks leave (and a client in Saltmarket is reached at once); nothing is back yet.
    const first = happened(road, DEPART_MINUTE);
    expect(first.slice(0, road.trucks.length).every((e) => e.kind === 'leave')).toBe(true);
    expect(first.some((e) => e.kind === 'back')).toBe(false);
    expect(happened(road, road.end)).toHaveLength(road.events.length);
  });

  it('tells a truck that is out, at a client, and back', () => {
    const { road } = smallDay();
    const t = road.trucks[0]!;
    const first = t.stops[0]!;
    expect(truckState(t, DEPART_MINUTE)).toEqual(first.arriveAt > DEPART_MINUTE ? { kind: 'out' } : { kind: 'stop', place: first.place });
    expect(truckState(t, first.arriveAt)).toEqual({ kind: 'stop', place: first.place });
    expect(truckState(t, t.backAt)).toEqual({ kind: 'back', at: t.backAt });
    expect(formatTime(t.backAt)).toMatch(/^\d\d:\d\d$/);
  });
});
