import { describe, expect, it } from 'vitest';
import { START_MINUTE } from '../src/game/clock';
import { Desk } from '../src/game/desk';
import { smallMorning } from '../src/game/morning';
import type { Morning } from '../src/game/types';

const idx = (m: Morning, client: string) => m.orders.findIndex((o) => o.client === client);
const lineIdx = (m: Morning, o: number, item: string) => m.orders[o]?.lines.findIndex((l) => l.item === item) ?? -1;

function fresh() {
  const m = smallMorning();
  return { m, desk: new Desk(m) };
}

describe('stock and shortages', () => {
  it('starts with nothing given and the whole stock on hand', () => {
    const { m, desk } = fresh();
    const anchor = idx(m, 'The Anchor');
    const ketchup = lineIdx(m, anchor, 'ketchup');
    expect(desk.given(anchor, ketchup)).toBeNull();
    expect(desk.onHand(anchor, ketchup)).toBe(12);
  });

  it('takes what is given on one order off what the next order can have', () => {
    const { m, desk } = fresh();
    const shack = idx(m, 'Burger Shack');
    const plough = idx(m, 'The Plough');
    desk.setGive(shack, lineIdx(m, shack, 'ketchup'), 9);
    const l = lineIdx(m, plough, 'ketchup');
    expect(desk.onHand(plough, l)).toBe(3);
    expect(desk.maxGive(plough, l)).toBe(3);
    expect(desk.setGive(plough, l, 4)).toBe(3);
  });

  it('does not count a line against its own stock', () => {
    const { m, desk } = fresh();
    const shack = idx(m, 'Burger Shack');
    const l = lineIdx(m, shack, 'ketchup');
    desk.setGive(shack, l, 9);
    expect(desk.onHand(shack, l)).toBe(12);
  });

  it('never gives more than was asked, or less than nothing', () => {
    const { m, desk } = fresh();
    const lumen = idx(m, 'Café Lumen');
    const l = lineIdx(m, lumen, 'eggs');
    expect(desk.setGive(lumen, l, 99)).toBe(6);
    expect(desk.setGive(lumen, l, -4)).toBe(0);
  });

  it('starts one more or one less from the most that can be given', () => {
    const { m, desk } = fresh();
    const plough = idx(m, 'The Plough');
    const l = lineIdx(m, plough, 'pork');
    expect(desk.nudgeGive(plough, l, -1)).toBe(9);
    expect(desk.nudgeGive(plough, l, -1)).toBe(8);
    expect(desk.nudgeGive(plough, l, 1)).toBe(9);
    expect(desk.nudgeGive(plough, l, 5)).toBe(10);
  });

  it('accepts a line at the most that can be given, and leaves a decided line alone', () => {
    const { m, desk } = fresh();
    const plough = idx(m, 'The Plough');
    const l = lineIdx(m, plough, 'pork');
    expect(desk.acceptLine(plough, l)).toBe(10);
    desk.setGive(plough, l, 4);
    expect(desk.acceptLine(plough, l)).toBe(4);
  });
});

describe('trucks and how full they are', () => {
  it('counts what is given on an order towards its truck', () => {
    const { m, desk } = fresh();
    const lumen = idx(m, 'Café Lumen');
    desk.assignTruck(lumen, 1);
    expect(desk.fullness(1)).toBe(0);
    desk.setGive(lumen, lineIdx(m, lumen, 'potatoes'), 3);
    expect(desk.load(1)).toBe(3 * 6);
    expect(desk.fullness(1)).toBeCloseTo(18 / 330);
    expect(desk.fullness(2)).toBe(0);
  });

  it('counts lines given before the truck was chosen', () => {
    const { m, desk } = fresh();
    const lumen = idx(m, 'Café Lumen');
    desk.setGive(lumen, lineIdx(m, lumen, 'flour'), 2);
    desk.assignTruck(lumen, 2);
    expect(desk.load(2)).toBe(12);
  });

  it('frees the room on a truck when an order moves to another truck', () => {
    const { m, desk } = fresh();
    const lumen = idx(m, 'Café Lumen');
    m.orders[lumen]!.lines.forEach((_, l) => desk.acceptLine(lumen, l));
    desk.assignTruck(lumen, 1);
    expect(desk.load(1)).toBeGreaterThan(0);
    desk.assignTruck(lumen, 2);
    expect(desk.load(1)).toBe(0);
    expect(desk.load(2)).toBeGreaterThan(0);
    expect(desk.truckFor(lumen)).toBe(2);
  });

  it('refuses an order that does not fit and does not move the clock', () => {
    const { m } = fresh();
    const tight: Morning = { ...m, trucks: [{ id: 1, driver: 'Sam', kind: 'van', capacity: 20 }, ...m.trucks.slice(1)] };
    const d = new Desk(tight);
    const lumen = idx(tight, 'Café Lumen');
    d.acceptLine(lumen, lineIdx(tight, lumen, 'potatoes'));
    d.acceptLine(lumen, lineIdx(tight, lumen, 'flour'));
    const before = d.clock;
    expect(d.assignTruck(lumen, 1)).toEqual({ ok: false, reason: 'full' });
    expect(d.truckFor(lumen)).toBeNull();
    expect(d.clock).toBe(before);
  });

  it('stops a line growing past what the truck can carry', () => {
    const { m } = fresh();
    const tight: Morning = { ...m, trucks: [{ id: 1, driver: 'Sam', kind: 'van', capacity: 20 }, ...m.trucks.slice(1)] };
    const d = new Desk(tight);
    const lumen = idx(tight, 'Café Lumen');
    d.assignTruck(lumen, 1);
    const potatoes = lineIdx(tight, lumen, 'potatoes');
    expect(d.maxGive(lumen, potatoes)).toBe(3);
    expect(d.setGive(lumen, potatoes, 3)).toBe(3);
    const eggs = lineIdx(tight, lumen, 'eggs');
    // 18 of 20 space used, one tray of eggs is 2.
    expect(d.maxGive(lumen, eggs)).toBe(1);
  });

  it('knows nothing of a truck that is not there', () => {
    const { desk } = fresh();
    expect(desk.assignTruck(0, 7)).toEqual({ ok: false, reason: 'no-such-truck' });
  });
});

describe('the places a truck goes to', () => {
  it('lists each place once, however many orders go there', () => {
    const { m, desk } = fresh();
    desk.assignTruck(idx(m, 'Golden Dragon'), 1);
    desk.assignTruck(idx(m, 'Burger Shack'), 1);
    desk.assignTruck(idx(m, 'Café Lumen'), 1);
    expect(desk.placesOf(1)).toEqual(['town', 'docks']);
    expect(desk.placesOf(2)).toEqual([]);
  });

  it('leaves out orders with nothing to deliver when asked to', () => {
    const { m, desk } = fresh();
    const dragon = idx(m, 'Golden Dragon');
    desk.assignTruck(dragon, 1);
    expect(desk.placesOf(1, true)).toEqual([]);
    desk.acceptLine(dragon, 0);
    expect(desk.placesOf(1, true)).toEqual(['docks']);
    expect(desk.stopsOf(1)).toEqual([dragon]);
  });
});

describe('finishing orders and the clock', () => {
  it('only finishes an order that has every line decided and a truck', () => {
    const { m, desk } = fresh();
    const dragon = idx(m, 'Golden Dragon');
    expect(desk.finishOrder(dragon)).toBe(false);
    m.orders[dragon]!.lines.forEach((_, l) => desk.acceptLine(dragon, l));
    expect(desk.finishOrder(dragon)).toBe(false);
    desk.assignTruck(dragon, 1);
    expect(desk.isComplete(dragon)).toBe(true);
    expect(desk.finishOrder(dragon)).toBe(true);
    expect(desk.isFinished(dragon)).toBe(true);
  });

  it('moves the clock one minute for choosing a truck and one for finishing an order', () => {
    const { m, desk } = fresh();
    const dragon = idx(m, 'Golden Dragon');
    m.orders[dragon]!.lines.forEach((_, l) => desk.acceptLine(dragon, l));
    expect(desk.clock).toBe(START_MINUTE);
    desk.assignTruck(dragon, 1);
    expect(desk.clock).toBe(START_MINUTE + 1);
    desk.finishOrder(dragon);
    expect(desk.clock).toBe(START_MINUTE + 2);
    desk.finishOrder(dragon);
    expect(desk.clock).toBe(START_MINUTE + 2);
  });

  it('does not move the clock for typing amounts', () => {
    const { m, desk } = fresh();
    desk.setGive(0, 0, 1);
    desk.nudgeGive(0, 1, -1);
    desk.acceptLine(0, 2);
    expect(desk.clock).toBe(START_MINUTE);
    expect(m.orders).toHaveLength(7);
  });

  it('finds the next order that is not finished, wrapping round', () => {
    const m = smallMorning();
    m.trucks.forEach((tr) => (tr.capacity = 9999));
    const desk = new Desk(m);
    expect(desk.nextUnfinished(0)).toBe(1);
    const last = m.orders.length - 1;
    expect(desk.nextUnfinished(last)).toBe(0);
    for (let o = 0; o < m.orders.length; o++) {
      m.orders[o]!.lines.forEach((_, l) => desk.acceptLine(o, l));
      desk.assignTruck(o, 1 + (o % 2));
      desk.finishOrder(o);
    }
    expect(desk.nextUnfinished(2)).toBe(-1);
    expect(desk.unfinishedCount()).toBe(0);
  });

  it('points at the first line not yet decided', () => {
    const { desk } = fresh();
    expect(desk.firstUndecidedLine(0)).toBe(0);
    desk.setGive(0, 0, 1);
    expect(desk.firstUndecidedLine(0)).toBe(1);
  });
});
