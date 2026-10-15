import { describe, expect, it } from 'vitest';
import { announcedBy, EVENTS, eventById, hintsFor, swings, swingUnits } from '../src/game/demand';
import { generateDay } from '../src/game/generate';
import { bigMorning, smallMorning } from '../src/game/morning';
import { mulberry32 } from '../src/game/random';
import { nextDay, runFromMorning, type DayOutcome, type RunState } from '../src/game/run';
import { Supply } from '../src/game/supply';
import type { Morning } from '../src/game/types';
import { playToSupply, screen, fakeEffects } from './helpers';
import { App } from '../src/ui/app';

const outcome = (over: Partial<DayOutcome> = {}): DayOutcome => ({ left: {}, ordered: {}, moods: {}, today: {}, promises: [], growth: null, earned: 0, ...over });
const asked = (m: Morning, item: string) => m.orders.reduce((sum, o) => sum + o.lines.filter((l) => l.item === item).reduce((s, l) => s + l.asked, 0), 0);
const lineOf = (m: Morning, client: string, item: string) => m.orders.find((o) => o.client === client)?.lines.find((l) => l.item === item)?.asked ?? 0;

describe('what a note announces', () => {
  it('names the event a note speaks of, in any case, and nothing for a note that says nothing about tomorrow', () => {
    expect(announcedBy([{ client: 'A', note: 'A wedding party this weekend.' }])).toEqual([{ client: 'A', event: 'wedding' }]);
    expect(announcedBy([{ client: 'A', note: 'QUIZ NIGHT on Friday.' }])).toEqual([{ client: 'A', event: 'quiz' }]);
    expect(announcedBy([{ client: 'A', note: 'Chef is away, so keep it simple.' }])).toEqual([{ client: 'A', event: 'simple' }]);
    expect(announcedBy([{ client: 'A', note: 'Same as last week, please.' }, { client: 'B' }])).toEqual([]);
  });

  it('is read from the notes already in the game, written by hand or made up', () => {
    const small = announcedBy(smallMorning().orders);
    expect(small.map((a) => [a.client, a.event])).toEqual([['The Anchor', 'birthday'], ['Hotel Bellevue', 'wedding'], ['The Plough', 'quiz']]);
    expect(announcedBy(bigMorning().orders).map((a) => a.client)).toContain('Fenwick Village Hall');
  });

  it('gives every event a phrase to find, items to move and words for the supplier order', () => {
    expect(new Set(EVENTS.map((e) => e.id)).size).toBe(EVENTS.length);
    for (const e of EVENTS) {
      expect(e.phrase).toBe(e.phrase.toLowerCase());
      expect(e.items.length).toBeGreaterThan(0);
      expect(e.word.length).toBeGreaterThan(0);
      expect(eventById(e.id)).toBe(e);
    }
  });
});

describe('how far an event moves an item', () => {
  const usual = { pork: 40, eggs: 18, chips: 16 };

  it('adds for a busy day and takes away for a quiet one, less the bigger the business', () => {
    const busy = eventById('wedding')!;
    const quiet = eventById('simple')!;
    expect(swingUnits(busy, 40, 7)).toBeGreaterThan(0);
    expect(swingUnits(quiet, 40, 7)).toBeLessThan(0);
    expect(swingUnits(busy, 40, 7)).toBeGreaterThan(swingUnits(busy, 40, 38));
    expect(swingUnits(busy, 1, 100)).toBe(1);
  });

  it('is per item the event names, for the client the note came from', () => {
    const list = swings([{ client: 'Hotel Bellevue', event: 'wedding' }], usual, 7);
    expect(list.map((s) => s.item)).toEqual(['pork', 'eggs', 'mozzarella']);
    expect(list.every((s) => s.client === 'Hotel Bellevue' && s.units !== 0)).toBe(true);
  });

  it('never moves an item by more than a third of its usual amount, however many events name it', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ client: `C${i}`, event: 'wedding' }));
    const total = swings(many, usual, 7).filter((s) => s.item === 'pork').reduce((sum, s) => sum + s.units, 0);
    expect(total).toBeLessThanOrEqual(Math.ceil(40 * 0.3) + many.length / 2);
    expect(total).toBeGreaterThan(0);
    const quiet = swings(many.map((m) => ({ ...m, event: 'simple' })), { ...usual, rice: 6, oil: 6, mozzarella: 10 }, 7);
    expect(quiet.filter((s) => s.item === 'pork').reduce((sum, s) => sum + s.units, 0)).toBeGreaterThanOrEqual(-Math.ceil(40 * 0.3) - many.length / 2);
  });

  it('ignores an event it does not know, as a damaged save may carry', () => {
    expect(swings([{ client: 'A', event: 'eclipse' }], usual, 7)).toEqual([]);
  });

  it('is what the supplier order says about an item: busy or quiet, and who said so', () => {
    const ahead = [{ client: 'A', event: 'wedding' }, { client: 'B', event: 'simple' }];
    expect(hintsFor(ahead, 'pork')).toEqual([
      { client: 'A', word: 'a wedding', busy: true },
      { client: 'B', word: 'a simple menu', busy: false },
    ]);
    expect(hintsFor(ahead, 'ketchup')).toEqual([]);
  });
});

describe('a made-up day', () => {
  const day2 = (run: RunState, seed: number) => generateDay({ ...run, day: 2 }, mulberry32(seed));

  it('asks for each item around its usual amount, not up to a cap', () => {
    const run = { ...runFromMorning(smallMorning()), ahead: [] };
    let over = 0;
    let under = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const m = day2(run, seed);
      for (const item of m.items) {
        const total = asked(m, item.id);
        const usual = run.usual[item.id]!;
        if (total > usual) over++;
        if (total < usual) under++;
        expect(total).toBeGreaterThanOrEqual(Math.floor(usual * 0.8));
        expect(total).toBeLessThanOrEqual(Math.ceil(usual * 1.2) + m.orders.length);
      }
    }
    // It swings both ways, so ordering up to the usual amount is not always right.
    expect(over).toBeGreaterThan(40);
    expect(under).toBeGreaterThan(40);
  });

  it('lets a note raise that client\'s order the day after, and the busy client\'s order is the one that grows', () => {
    const base = { ...runFromMorning(smallMorning()), ahead: [] };
    const noted = { ...base, ahead: [{ client: 'Hotel Bellevue', event: 'wedding' }] };
    let more = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const plain = day2(base, seed);
      const wedding = day2(noted, seed);
      for (const item of ['pork', 'eggs', 'mozzarella']) {
        expect(asked(wedding, item)).toBeGreaterThanOrEqual(asked(plain, item) - 2);
        if (lineOf(wedding, 'Hotel Bellevue', item) > lineOf(plain, 'Hotel Bellevue', item)) more++;
      }
    }
    expect(more).toBeGreaterThan(60);
  });

  it('lets "keep it simple" lower that client\'s order', () => {
    const base = { ...runFromMorning(smallMorning()), ahead: [] };
    const quiet = { ...base, ahead: [{ client: 'Café Lumen', event: 'simple' }] };
    let less = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const now = lineOf(day2(quiet, seed), 'Café Lumen', 'pork');
      const before = lineOf(day2(base, seed), 'Café Lumen', 'pork');
      expect(now).toBeLessThanOrEqual(before);
      if (now < before) less++;
    }
    expect(less).toBeGreaterThan(5);
  });

  it('carries the notes of one day to the next: what the orders say today moves tomorrow', () => {
    const run = runFromMorning(smallMorning());
    // Nothing was said before the first morning; its own notes reach the second day through the day's outcome.
    expect(run.ahead).toEqual([]);
    const next = nextDay(run, outcome({ ahead: [{ client: "Rosa's", event: 'halfterm' }] }));
    expect(next.ahead).toEqual([{ client: "Rosa's", event: 'halfterm' }]);
    // A day that says nothing announces nothing.
    expect(nextDay(run, outcome()).ahead).toEqual([]);
  });

  it('puts a note that names an event on some orders, and the same notes for the same seed', () => {
    const run = { ...runFromMorning(bigMorning()), day: 2, ahead: [] };
    const m = generateDay(run, mulberry32(3));
    expect(generateDay(run, mulberry32(3))).toEqual(m);
    expect(announcedBy(m.orders).length).toBeGreaterThan(0);
  });

  it('stays within what the trucks can carry, with the busiest notes of the day before', () => {
    const run = runFromMorning(smallMorning());
    const everyone = { ...run, ahead: run.clients.map((c) => ({ client: c.name, event: 'wedding' })) };
    for (let seed = 1; seed <= 20; seed++) {
      const m = generateDay({ ...everyone, day: 2 }, mulberry32(seed));
      const space = m.orders.reduce((sum, o) => sum + o.lines.reduce((s, l) => s + l.asked * m.items.find((i) => i.id === l.item)!.size, 0), 0);
      expect(space).toBeLessThan(m.trucks.reduce((sum, t) => sum + t.capacity, 0) * 0.95);
    }
  });
});

describe('the supplier order', () => {
  it('shows what clients asked for today, beside the usual amount', () => {
    const m = smallMorning();
    const supply = new Supply(m, {});
    const chips = supply.rows.find((r) => r.item.id === 'chips')!;
    expect(chips.asked).toBe(asked(m, 'chips'));
    expect(supply.rows.every((r) => r.asked === asked(m, r.item.id))).toBe(true);
  });

  it('knows what the notes on today\'s orders say about tomorrow', () => {
    const supply = new Supply(smallMorning(), {});
    expect(supply.ahead.map((a) => a.event)).toEqual(['birthday', 'wedding', 'quiz']);
    const pork = supply.rows.findIndex((r) => r.item.id === 'pork');
    expect(supply.hints(pork).map((h) => h.client)).toEqual(['The Anchor', 'Hotel Bellevue']);
    expect(supply.hints(supply.rows.findIndex((r) => r.item.id === 'rice'))).toEqual([]);
  });

  it('shows the column, an arrow beside an item the notes name, and what they say for the highlighted row', () => {
    const app = new App(fakeEffects([], () => 0.3), () => {}, 'small');
    const press = (...keys: string[]) => keys.forEach((key) => app.press({ key }));
    playToSupply(app, press);
    const text = screen(app).join('\n');
    expect(text).toContain('ASKED');
    expect(text).toMatch(/Pork shoulder, kg +\d+ +\d+ +\d+ ↑/);
    const pork = app.supply!.rows.findIndex((r) => r.item.id === 'pork');
    press(...Array(pork).fill('ArrowDown'));
    const lines = screen(app).join('\n');
    expect(lines).toContain('Tomorrow: The Anchor (a birthday');
    expect(lines).toContain('Bellevue (a wedding)');
    expect(lines).toContain('so more');
  });
});
