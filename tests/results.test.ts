import { describe, expect, it } from 'vitest';
import { DEPART_MINUTE } from '../src/game/clock';
import { Desk } from '../src/game/desk';
import { plainName, shortItems } from '../src/game/headsup';
import { smallMorning } from '../src/game/morning';
import { buildResult } from '../src/game/results';
import { STOP_MINUTES } from '../src/game/routes';

const idx = (d: Desk, client: string) => d.morning.orders.findIndex((o) => o.client === client);

function handOut(d: Desk, client: string, truck: number) {
  const o = idx(d, client);
  d.morning.orders[o]!.lines.forEach((_, l) => d.acceptLine(o, l));
  d.assignTruck(o, truck);
  d.finishOrder(o);
  return o;
}

describe('headsUp', () => {
  it('lists the items asked for in total beyond what is on hand, worst first', () => {
    const items = shortItems(smallMorning());
    expect(items.map((s) => s.name)).toEqual(['Ketchup, bottle', 'Frozen chips, 10 kg']);
    expect(plainName(items[0]!.name)).toBe('ketchup');
  });

  it('lists nothing when the stock covers every order', () => {
    const m = smallMorning();
    for (const k of Object.keys(m.stock)) m.stock[k] = 1000;
    expect(shortItems(m)).toEqual([]);
  });
});

describe('buildResult', () => {
  it('delivers all of an order that got everything it asked for', () => {
    const d = new Desk(smallMorning());
    handOut(d, 'Golden Dragon', 1);
    const r = buildResult(d, DEPART_MINUTE);
    const dragon = r.orders[idx(d, 'Golden Dragon')]!;
    expect(dragon.percent).toBe(100);
    expect(dragon.shortLines).toEqual([]);
    expect(dragon.truckId).toBe(1);
    expect(r.inFull).toBe(1);
  });

  it('counts each line equally when working out the share delivered', () => {
    const d = new Desk(smallMorning());
    const o = idx(d, 'Golden Dragon');
    d.setGive(o, 0, 0);
    d.setGive(o, 1, 3);
    d.setGive(o, 2, 1);
    d.assignTruck(o, 1);
    const r = buildResult(d, DEPART_MINUTE).orders[o]!;
    // Lines asked 4, 3 and 2: shares 0, 1 and 1/2.
    expect(r.percent).toBe(50);
    expect(r.shortLines).toEqual([
      { item: 'rice', asked: 4, given: 0 },
      { item: 'peas', asked: 2, given: 1 },
    ]);
  });

  it('delivers nothing for an order with no truck, and lists who got less, smallest share first', () => {
    const d = new Desk(smallMorning());
    handOut(d, 'Golden Dragon', 1);
    const o = idx(d, 'Burger Shack');
    d.morning.orders[o]!.lines.forEach((_, l) => d.acceptLine(o, l));
    const r = buildResult(d, DEPART_MINUTE);
    expect(r.orders[o]?.percent).toBe(0);
    expect(r.orders[o]?.truckId).toBeNull();
    expect(r.gotLess[0]?.percent).toBe(0);
    const shares = r.gotLess.map((x) => x.percent);
    expect(shares).toEqual([...shares].sort((a, b) => a - b));
    expect(r.gotLess.some((x) => x.client === 'Golden Dragon')).toBe(false);
  });

  it('shows ketchup running out for the last order that asks for it', () => {
    const d = new Desk(smallMorning());
    handOut(d, 'Burger Shack', 1);
    handOut(d, 'The Anchor', 2);
    handOut(d, 'The Plough', 2);
    const r = buildResult(d, DEPART_MINUTE);
    const plough = r.orders[idx(d, 'The Plough')]!;
    expect(plough.shortLines).toEqual([{ item: 'ketchup', asked: 4, given: 0 }]);
    expect(plough.percent).toBe(83);
  });

  it('times each truck from when it leaves, and leaves unused trucks without a return', () => {
    const d = new Desk(smallMorning());
    handOut(d, 'Café Lumen', 1);
    handOut(d, 'Hotel Bellevue', 1);
    const r = buildResult(d, DEPART_MINUTE);
    expect(r.trucks[0]?.stops).toBe(2);
    expect(r.trucks[0]?.places).toEqual(['town']);
    expect(r.trucks[0]?.backAt).toBe(DEPART_MINUTE + 2 * STOP_MINUTES);
    expect(r.trucks[1]?.backAt).toBeNull();
    expect(r.lastBack).toBe(DEPART_MINUTE + 2 * STOP_MINUTES);
  });

  it('notes when a client who asked for a time was reached after it', () => {
    const d = new Desk(smallMorning());
    // Rosa's asked for before 09:00. Leaving at 08:50 the truck is there at 09:10.
    handOut(d, "Rosa's", 1);
    const late = buildResult(d, 8 * 60 + 50).orders[idx(d, "Rosa's")]!;
    expect(late.before).toBe(9 * 60);
    expect(late.lateForAsk).toBe(true);
    const early = buildResult(d, DEPART_MINUTE).orders[idx(d, "Rosa's")]!;
    expect(early.arriveAt).toBe(DEPART_MINUTE + 20);
    expect(early.lateForAsk).toBe(false);
  });

  it('sends trucks later when the desk ran past seven o clock', () => {
    const d = new Desk(smallMorning());
    handOut(d, 'Café Lumen', 1);
    const onTime = buildResult(d, DEPART_MINUTE).trucks[0]?.backAt ?? 0;
    const late = buildResult(d, DEPART_MINUTE + 15).trucks[0]?.backAt ?? 0;
    expect(late - onTime).toBe(15);
  });
});
