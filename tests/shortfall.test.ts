import { describe, expect, it } from 'vitest';
import { generateDay } from '../src/game/generate';
import { shortItems } from '../src/game/headsup';
import { loadMorning, smallMorning } from '../src/game/morning';
import { supplierPrice } from '../src/game/money';
import { mulberry32 } from '../src/game/random';
import { nextDay, runFromMorning, type DayOutcome, type RunState } from '../src/game/run';
import { decodeRun, encodeRun, SAVE_VERSION } from '../src/game/save';
import { creditFor, deliveredOf, SHORT_CHANCE, shortfallFor, shortNotes } from '../src/game/shortfall';
import type { Short } from '../src/game/types';
import { App } from '../src/ui/app';
import { memoryStore } from '../src/ui/store';
import { fakeEffects, hold, playToSupply, screen, toNextMorning } from './helpers';

const ORDERED = { eggs: 18, pork: 30, chips: 10, peas: 4, ketchup: 12, flour: 7, rice: 2 };
const outcome = (over: Partial<DayOutcome> = {}): DayOutcome => ({ left: {}, ordered: {}, moods: {}, today: {}, promises: [], growth: null, earned: 0, ...over });

/** The first seed from `from` on that leaves something short of the order. */
function seedWithShortfall(ordered: Record<string, number>, from = 0): number {
  for (let seed = from; seed < from + 1000; seed++) if (shortfallFor(ordered, seed).length > 0) return seed;
  throw new Error('no seed leaves anything short');
}

describe('the supplier shortfall', () => {
  it('comes on about one night in four or five, so most nights the whole order arrives', () => {
    const seeds = Array.from({ length: 4000 }, (_, i) => i * 7919 + 3);
    const nights = seeds.filter((seed) => shortfallFor(ORDERED, seed).length > 0).length / seeds.length;
    expect(nights).toBeGreaterThan(0.17);
    expect(nights).toBeLessThan(0.27);
    expect(SHORT_CHANCE).toBeGreaterThan(0.17);
    expect(SHORT_CHANCE).toBeLessThan(0.27);
  });

  it('leaves one or two items short, never more than was ordered, always some of it, and only an item ordered in some number', () => {
    const counts = new Set<number>();
    for (let seed = 0; seed < 3000; seed++) {
      const short = shortfallFor(ORDERED, seed);
      if (short.length > 0) counts.add(short.length);
      expect(short.length).toBeLessThanOrEqual(2);
      expect(new Set(short.map((s) => s.item)).size).toBe(short.length);
      for (const s of short) {
        expect(s.ordered).toBe(ORDERED[s.item as keyof typeof ORDERED]);
        expect(s.ordered).toBeGreaterThanOrEqual(6);
        expect(s.came).toBeGreaterThanOrEqual(1);
        expect(s.came).toBeLessThan(s.ordered);
      }
    }
    expect([...counts].sort()).toEqual([1, 2]);
  });

  it('is nothing when nothing was ordered, and the same night for the same seed', () => {
    for (let seed = 0; seed < 200; seed++) expect(shortfallFor({}, seed)).toEqual([]);
    for (let seed = 0; seed < 200; seed++) expect(shortfallFor(ORDERED, seed)).toEqual(shortfallFor({ ...ORDERED }, seed));
  });

  it('does not touch the first morning, small or big, whatever the seed', () => {
    for (const id of ['small', 'big'] as const) {
      expect(loadMorning(id).short).toBeUndefined();
      expect(runFromMorning(loadMorning(id)).short).toEqual([]);
      expect(loadMorning(id).messages.some((m) => m.kind === 'supplier' && /came;/.test(m.text))).toBe(false);
    }
    const app = new App(fakeEffects([], () => 0.5, memoryStore()), () => {}, 'small');
    expect(app.run.day).toBe(1);
    expect(app.run.short).toEqual([]);
    expect(app.morning.short).toBeUndefined();
  });

  it('delivers less of the item and takes less for it: the stock holds what came, the rest is not charged for', () => {
    const run: RunState = { ...runFromMorning(smallMorning()), day: 2, cash: 500, stock: {} };
    const ordered = { eggs: 18, pork: 12, flour: 3 };
    const seed = seedWithShortfall(ordered);
    const short = shortfallFor(ordered, seed);
    const whole = nextDay(run, outcome({ ordered, earned: 100 }));
    const next = nextDay(run, outcome({ ordered, earned: 100 }), seed);
    expect(whole.short).toEqual([]);
    expect(next.short).toEqual(short);
    for (const [item, amount] of Object.entries(deliveredOf(ordered, short))) expect(next.stock[item]).toBe(amount);
    expect(whole.stock.eggs).toBe(18);
    expect(creditFor(short)).toBeGreaterThan(0);
    expect(next.cash).toBe(whole.cash + creditFor(short));
    expect(creditFor(short)).toBe(short.reduce((sum, s) => sum + (s.ordered - s.came) * supplierPrice(s.item), 0));
    expect(next.delivery.units).toBe(whole.delivery.units - short.reduce((sum, s) => sum + s.ordered - s.came, 0));
  });

  it('gives the next day nothing short when the delivery is whole, and forgets it a day later', () => {
    const run: RunState = { ...runFromMorning(smallMorning()), day: 2, short: [{ item: 'eggs', ordered: 10, came: 5 }] };
    const calm = seedWithNone({ pork: 10 });
    const next = nextDay(run, outcome({ ordered: { pork: 10 } }), calm);
    expect(next.short).toEqual([]);
  });

  it('says so overnight, in the voice of the supplier that brings the item, with what came and what is not charged for', () => {
    const short: Short[] = [{ item: 'eggs', ordered: 18, came: 10 }];
    const run: RunState = { ...runFromMorning(smallMorning()), day: 2, short };
    const day = generateDay(run, mulberry32(11));
    const notes = day.messages.flatMap((m) => (m.kind === 'supplier' && m.text.startsWith('Only') ? [m] : []));
    expect(notes).toHaveLength(1);
    expect(notes[0]!.from).toBe('Grange Farm');
    expect(notes[0]!.text).toContain('Only 10 of 18 eggs came; the rest next time.');
    expect(notes[0]!.text).toContain('not charged');
    expect(notes[0]!.text).toContain('£40');
    // It is among the overnight notes, before the loading crew is in, and the same supplier does not also say all is well.
    expect(notes[0]!.at).toBeLessThanOrEqual(24 * 60 + 5 * 60 + 15);
    expect(day.messages.filter((m) => m.kind === 'supplier' && m.from === 'Grange Farm')).toHaveLength(1);
    expect(day.short).toEqual(short);
  });

  it('puts the items of one supplier in a single note', () => {
    const notes = shortNotes([
      { item: 'eggs', ordered: 18, came: 10 },
      { item: 'potatoes', ordered: 8, came: 5 },
      { item: 'chips', ordered: 12, came: 6 },
    ]);
    expect(notes.map((n) => n.from)).toEqual(['Grange Farm', 'Northfrost']);
    expect(notes[0]!.text).toContain('Only 10 of 18 eggs and 5 of 8 potatoes came');
  });

  it('keeps an ordinary morning as it was: the same orders, notes and calls, whether or not the night before was short', () => {
    const base: RunState = { ...runFromMorning(smallMorning()), day: 2 };
    const plain = generateDay(base, mulberry32(5));
    const again = generateDay({ ...base, short: [] }, mulberry32(5));
    expect(again).toEqual(plain);
    expect(plain.short).toBeUndefined();
    const hit = generateDay({ ...base, short: [{ item: 'pork', ordered: 20, came: 9 }] }, mulberry32(5));
    expect(hit.orders).toEqual(plain.orders);
    expect(hit.callKinds).toEqual(plain.callKinds);
  });

  it('shows the scarce item on the order desk, with what the supplier sent, and still adds up', () => {
    const run: RunState = {
      ...runFromMorning(smallMorning()),
      day: 2,
      stock: { ...runFromMorning(smallMorning()).stock, eggs: 3 },
      short: [{ item: 'eggs', ordered: 18, came: 10 }],
    };
    const day = generateDay(run, mulberry32(21));
    const eggs = shortItems(day).find((s) => s.item === 'eggs');
    expect(eggs?.sent).toEqual({ came: 10, ordered: 18 });
    expect(shortItems(day)[0]!.item).toBe('eggs');
    const app = new App(fakeEffects([], () => 0.5, memoryStore({ 'promitheftis.run': encodeRun(run, 21) })), () => {}, 'small');
    app.press({ key: 'c' });
    app.press({ key: ' ' });
    expect(app.screen).toBe('desk');
    const text = screen(app).join('\n');
    expect(text).toContain('HEADS UP');
    expect(text).toContain('eggs: ');
    expect(text).toContain('supplier sent 10 of 18');
  });
});

/** The first seed from 0 on that leaves nothing short of the order. */
function seedWithNone(ordered: Record<string, number>): number {
  let seed = 0;
  while (shortfallFor(ordered, seed).length > 0) seed++;
  return seed;
}

describe('the supplier shortfall in a run', () => {
  /** A random source whose first day gets `seed` as its seed, and everything else zero. */
  const drawing = (seed: number) => {
    let n = 0;
    return () => (++n === 2 ? seed / 4294967296 : 0);
  };

  /** The first seed that, with the order the A key makes, leaves something short on day 2. */
  function runWithShortfall() {
    for (let seed = 0; seed < 300; seed++) {
      const store = memoryStore();
      const day = toNextMorning('1', 'small', 0, drawing(seed), store);
      if (day.app.run.short.length > 0) return { ...day, store, seed };
    }
    throw new Error('no seed gave a short day 2');
  }

  it('makes day 2 begin with the shortfall in the run, the notes, the stock and the cash', () => {
    const { app } = runWithShortfall();
    const short = app.run.short;
    expect(short.length).toBeGreaterThan(0);
    expect(app.morning.short).toEqual(short);
    for (const s of short) {
      const note = app.morning.messages.find((m) => m.kind === 'supplier' && m.text.includes(`${s.came} of ${s.ordered}`));
      expect(note).toBeDefined();
    }
    const text = screen(app).join('\n');
    expect(text).toContain('OVERNIGHT MESSAGES');
  });

  it('plays the same short day again with R', () => {
    const { app, press } = runWithShortfall();
    const before = JSON.stringify({ short: app.morning.short, stock: app.morning.stock, messages: app.morning.messages, orders: app.morning.orders });
    const cash = app.run.cash;
    playToSupply(app, press);
    press('Escape');
    hold(app, 'r');
    expect(app.screen).toBe('messages');
    expect(JSON.stringify({ short: app.morning.short, stock: app.morning.stock, messages: app.morning.messages, orders: app.morning.orders })).toBe(before);
    expect(app.run.cash).toBe(cash);
    expect(app.run.short.length).toBeGreaterThan(0);
  });

  it('keeps the shortfall in a save made mid-run, and the same day comes back from it', () => {
    const { app, store } = runWithShortfall();
    const saved = decodeRun(store.data.get('promitheftis.run') ?? '');
    expect(saved?.run.short).toEqual(app.run.short);
    expect(JSON.parse(store.data.get('promitheftis.run') ?? '{}').version).toBe(SAVE_VERSION);
    const again = new App(fakeEffects([], () => 0.5, store), () => {}, 'small');
    again.press({ key: 'c' });
    expect(again.run.short).toEqual(app.run.short);
    expect(again.morning.short).toEqual(app.morning.short);
    expect(again.morning.stock).toEqual(app.morning.stock);
    expect(JSON.stringify(again.morning.messages)).toBe(JSON.stringify(app.morning.messages));
  });
});

describe('a save from before the supplier could leave part of an order behind', () => {
  it('still loads, with nothing left behind', () => {
    const run = { ...runFromMorning(smallMorning()), day: 3, cash: 700 };
    const { short, ...before } = run;
    expect(short).toEqual([]);
    const decoded = decodeRun(JSON.stringify({ version: 4, daySeed: 9, run: before }));
    expect(decoded).toEqual({ run: { ...before, short: [] }, daySeed: 9 });
  });

  it('round-trips a short delivery, and refuses one that is not what the supplier could leave', () => {
    const short: Short[] = [{ item: 'eggs', ordered: 18, came: 10 }];
    const run: RunState = { ...runFromMorning(smallMorning()), day: 2, short };
    expect(decodeRun(encodeRun(run, 3))?.run.short).toEqual(short);
    for (const bad of [
      [{ item: 'eggs', ordered: 18, came: 18 }],
      [{ item: 'eggs', ordered: 18, came: 20 }],
      [{ item: 'tea', ordered: 18, came: 10 }],
      [{ item: 'eggs', ordered: 18 }],
      [{ item: 'eggs', ordered: 18, came: -1 }],
      'eggs',
    ]) {
      expect(decodeRun(JSON.stringify({ version: SAVE_VERSION, daySeed: 3, run: { ...run, short: bad } }))).toBeNull();
    }
    expect(decodeRun(JSON.stringify({ version: SAVE_VERSION, daySeed: 3, run: { ...run, short: undefined } }))).toBeNull();
  });
});
