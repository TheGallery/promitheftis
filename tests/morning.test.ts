import { describe, expect, it } from 'vitest';
import { bigMorning, smallMorning } from '../src/game/morning';
import { shortItems } from '../src/game/headsup';
import type { Morning } from '../src/game/types';

function totalSpace(m: Morning): number {
  const size = new Map(m.items.map((i) => [i.id, i.size]));
  return m.orders.reduce((sum, o) => sum + o.lines.reduce((s, l) => s + l.asked * (size.get(l.item) ?? 0), 0), 0);
}

describe.each([
  ['small', smallMorning],
  ['big', bigMorning],
])('the %s morning', (_name, load) => {
  const m = load();

  it('only asks for items in the catalogue, once per order, in amounts above zero', () => {
    const ids = new Set(m.items.map((i) => i.id));
    for (const o of m.orders) {
      expect(o.lines.length).toBeGreaterThanOrEqual(3);
      expect(new Set(o.lines.map((l) => l.item)).size).toBe(o.lines.length);
      for (const l of o.lines) {
        expect(ids.has(l.item)).toBe(true);
        expect(l.asked).toBeGreaterThan(0);
      }
    }
  });

  it('has item names that fit the lines pane', () => {
    for (const i of m.items) expect(i.name.length).toBeLessThanOrEqual(19);
  });

  it('has one message per order, in the order the orders arrived', () => {
    const orderMessages = m.messages.filter((x) => x.kind === 'order');
    expect(orderMessages.map((x) => (x.kind === 'order' ? x.orderId : 0))).toEqual(m.orders.map((o) => o.id));
    const times = m.messages.map((x) => x.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('gives every truck room for any single order and leaves some slack overall', () => {
    const smallest = Math.min(...m.trucks.map((t) => t.capacity));
    const size = new Map(m.items.map((i) => [i.id, i.size]));
    for (const o of m.orders) {
      const space = o.lines.reduce((s, l) => s + l.asked * (size.get(l.item) ?? 0), 0);
      expect(space).toBeLessThan(smallest);
    }
    const capacity = m.trucks.reduce((s, t) => s + t.capacity, 0);
    const use = totalSpace(m) / capacity;
    expect(use).toBeGreaterThan(0.4);
    expect(use).toBeLessThan(0.8);
  });
});

describe('the small morning', () => {
  const m = smallMorning();
  it('has 2 trucks and 7 clients', () => {
    expect(m.trucks).toHaveLength(2);
    expect(m.orders).toHaveLength(7);
  });
  it('is short of ketchup and frozen chips only', () => {
    expect(shortItems(m).map((s) => [s.item, s.asked, s.onHand])).toEqual([
      ['ketchup', 16, 12],
      ['chips', 18, 14],
    ]);
  });
  it('is made of clients who also appear in the big morning', () => {
    const big = bigMorning();
    for (const o of m.orders) {
      const same = big.orders.find((b) => b.client === o.client);
      expect(same?.place).toBe(o.place);
      expect(same?.lines).toEqual(o.lines);
    }
  });
});

describe('the big morning', () => {
  const m = bigMorning();
  it('has 9 trucks and 38 orders', () => {
    expect(m.trucks).toHaveLength(9);
    expect(m.orders).toHaveLength(38);
  });
  it('has the same orders every time it is loaded', () => {
    expect(bigMorning()).toEqual(m);
  });
  it('has clients in every one of the nine places', () => {
    expect(new Set(m.orders.map((o) => o.place)).size).toBe(9);
  });
  it('is short of ketchup and frozen chips', () => {
    const short = shortItems(m).map((s) => s.item);
    expect(short).toContain('ketchup');
    expect(short).toContain('chips');
  });
  it('has the same client only once', () => {
    expect(new Set(m.orders.map((o) => o.client)).size).toBe(38);
  });
});
