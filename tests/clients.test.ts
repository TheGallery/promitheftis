import { describe, expect, it } from 'vitest';
import { clientWeight, distanceFromDepot, itemWeight, newClientFor, randomFrom, shapeText, sizeOf, usualWith, type NewClient } from '../src/game/clients';
import { bigMorning, ITEM_LIST, smallMorning } from '../src/game/morning';
import { mulberry32 } from '../src/game/random';
import { PLACES } from '../src/game/places';

const morningClients = [...smallMorning().orders, ...bigMorning().orders].map((o) => o.client);

/** `count` made-up clients in a row, each a client of the next. */
function joined(count: number, seed = 1): NewClient[] {
  const random = mulberry32(seed);
  const taken = [...morningClients];
  const out: NewClient[] = [];
  for (let i = 0; i < count; i++) {
    const c = newClientFor(taken, random);
    taken.push(c.name);
    out.push(c);
  }
  return out;
}

describe('a made-up client', () => {
  it('is never one that is a client already, however many have joined', () => {
    const made = joined(400);
    const names = made.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(morningClients).not.toContain(name);
  });

  it('keeps going after the twenty a fixed list would have held', () => {
    const made = joined(60, 7);
    expect(made).toHaveLength(60);
    expect(new Set(made.map((c) => c.name)).size).toBe(60);
  });

  it('has a name and a contact that fit the screens, and sits on the nine squares', () => {
    const ids = PLACES.map((p) => p.id);
    for (const c of joined(300, 3)) {
      expect([...c.name].length).toBeGreaterThan(3);
      expect([...c.name].length).toBeLessThanOrEqual(20);
      expect(c.name).toBe(c.name.trim());
      expect(c.contact.length).toBeGreaterThan(0);
      expect(ids).toContain(c.place);
    }
  });

  it('reaches every one of the nine squares', () => {
    expect(new Set(joined(300, 5).map((c) => c.place)).size).toBe(9);
  });

  it('is the same for the same random numbers, and differs from game to game', () => {
    expect(newClientFor([], mulberry32(9))).toEqual(newClientFor([], mulberry32(9)));
    expect(newClientFor([], randomFrom(0.25))).toEqual(newClientFor([], randomFrom(0.25)));
    const seen = new Set(Array.from({ length: 40 }, (_, i) => newClientFor([], randomFrom(i / 40)).name));
    expect(seen.size).toBeGreaterThan(20);
  });

  it('still names someone, and ends a name search, when the random source never changes', () => {
    const taken: string[] = [];
    for (let i = 0; i < 50; i++) taken.push(newClientFor(taken, () => 0).name);
    expect(new Set(taken).size).toBe(50);
    expect(newClientFor(taken, () => 0.999999).name).not.toBe('');
  });
});

describe('a place that has run out of names', () => {
  it('numbers the name rather than repeat one, and keeps it short enough to show whole', () => {
    const taken: string[] = [];
    for (let i = 0; i < 1500; i++) taken.push(newClientFor(taken, () => 0).name);
    expect(new Set(taken).size).toBe(1500);
    const numbered = taken.filter((n) => /\d$/.test(n));
    expect(numbered.length).toBeGreaterThan(0);
    for (const n of taken) expect([...n].length).toBeLessThanOrEqual(20);
  });
});

describe('the shape of a client', () => {
  const made = joined(400, 11);
  const big = made.filter((c) => c.shape.size > 1);
  const small = made.filter((c) => c.shape.size < 1);
  const early = made.filter((c) => c.shape.before != null);
  const heavy = made.filter((c) => c.shape.heavy != null);

  it('comes in four kinds, each of which turns up', () => {
    for (const kind of [big, small, early, heavy]) expect(kind.length).toBeGreaterThan(40);
    expect(big.length + small.length + early.length + heavy.length).toBe(made.length);
  });

  it('is big when the client is far away, and small when it is near', () => {
    for (const c of big) expect(distanceFromDepot(c.place)).toBe(2);
    for (const c of small) expect(distanceFromDepot(c.place)).toBeLessThanOrEqual(1);
    expect(big.every((c) => c.shape.size === 2)).toBe(true);
    expect(small.every((c) => c.shape.size === 0.5)).toBe(true);
  });

  it('asks for 08:00 or 09:00 when it is always early, and has an ordinary size', () => {
    for (const c of early) {
      expect([8 * 60, 9 * 60]).toContain(c.shape.before);
      expect(c.shape.size).toBe(1);
    }
    expect(new Set(early.map((c) => c.shape.before)).size).toBe(2);
  });

  it('is heavy on one of the three rooms, each of which turns up', () => {
    expect(new Set(heavy.map((c) => c.shape.heavy))).toEqual(new Set(['freezer', 'fridge', 'dry']));
  });

  it('is told in a line: the size, the square, how far, and what else it asks', () => {
    const rushmere: NewClient = { name: 'X', place: 'rushmere', contact: 'Y', shape: { size: 2, before: 9 * 60 } };
    expect(shapeText(rushmere)).toBe('Big orders, Rushmere: far from the depot; always before 09:00');
    expect(shapeText({ place: 'docks', shape: { size: 0.5 } })).toBe('Small orders, Docks: close to the depot');
    expect(shapeText({ place: 'saltmarket', shape: { size: 1, heavy: 'dry' } })).toBe('Ordinary orders, Saltmarket: at the depot; mostly dry goods');
    expect(shapeText({ place: 'ashby', shape: { size: 1, heavy: 'freezer', before: 8 * 60 } })).toBe(
      'Ordinary orders, Ashby: far from the depot; always before 08:00; mostly freezer stock',
    );
  });
});

describe('what a client of a shape takes', () => {
  it('counts a big client as two ordinary ones, a small one as half, and an unshaped one as one', () => {
    expect(sizeOf({})).toBe(1);
    expect(clientWeight([{}, { size: 2 }, { size: 0.5 }])).toBe(3.5);
  });

  it('takes more of its heavy room than of the others, and nothing special when it has none', () => {
    const c = { size: 1, heavy: 'freezer' } as const;
    expect(itemWeight(c, 'freezer')).toBeGreaterThan(itemWeight(c, 'fridge'));
    expect(itemWeight(c, 'fridge')).toBe(itemWeight(c, 'dry'));
    expect(itemWeight({}, 'dry')).toBe(1);
    expect(itemWeight({ size: 2 }, 'fridge')).toBe(2);
  });

  it('adds to the usual amounts by its share of the whole: a big client twice a normal one, a small one half', () => {
    const usual = Object.fromEntries(ITEM_LIST.map((i) => [i.id, 100]));
    const clients = [{}, {}, {}, {}];
    expect(usualWith(usual, clients, {}).chips).toBe(125);
    expect(usualWith(usual, clients, { size: 2 }).chips).toBe(150);
    expect(usualWith(usual, clients, { size: 0.5 }).chips).toBe(113);
    expect(usual.chips).toBe(100);
  });

  it('puts most of what a heavy client adds on its own room\'s items', () => {
    const usual = Object.fromEntries(ITEM_LIST.map((i) => [i.id, 100]));
    const after = usualWith(usual, [{}, {}, {}, {}], { size: 1, heavy: 'fridge' });
    expect(after.pork).toBeGreaterThan(after.chips!);
    expect(after.pork).toBeGreaterThan(after.flour!);
    expect(after.chips).toBe(after.flour);
  });

  it('leaves the amounts alone when there are no clients to share them with', () => {
    expect(usualWith({ chips: 10 }, [], { size: 2 })).toEqual({ chips: 10 });
  });
});
