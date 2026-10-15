import { describe, expect, it } from 'vitest';
import { dateLabel, weekdayName, weekdayOf } from '../src/game/clock';
import { CLOSED_CHANCE, closedIn, isTownEvent, TOWN_CHANCE, tomorrowFor, weekFactor, weekLine, weekMark } from '../src/game/daysize';
import { EVENTS, swings, type Announced } from '../src/game/demand';
import { generateDay } from '../src/game/generate';
import { bigMorning, smallMorning } from '../src/game/morning';
import { mulberry32 } from '../src/game/random';
import { nextDay, runFromMorning, type DayOutcome, type RunState } from '../src/game/run';
import { decodeRun, encodeRun, SAVE_VERSION } from '../src/game/save';
import { Supply } from '../src/game/supply';
import type { Morning } from '../src/game/types';
import { App, RUN_KEY } from '../src/ui/app';
import { HELP_PAGES } from '../src/ui/help';
import { memoryStore } from '../src/ui/store';
import { fakeEffects, hold, playToSupply, screen } from './helpers';

/** Day 1 is a Tuesday, so day 5 is a Saturday and day 7 a Monday. */
const SATURDAY = 5;
const MONDAY = 7;
const WEDNESDAY = 2;

function runOf(day = 4, kind: 'small' | 'big' = 'big'): RunState {
  return { ...runFromMorning(kind === 'big' ? bigMorning() : smallMorning()), day };
}

const asked = (m: Morning, item?: string) => m.orders.reduce((sum, o) => sum + o.lines.filter((l) => !item || l.item === item).reduce((n, l) => n + l.asked, 0), 0);

/** The first seed from 1 up whose morning (with `run`) tells of a town event, or of a closed client, for the next day. */
function seedWith(run: RunState, event: (e: Announced) => boolean, after = 0): number {
  for (let seed = after + 1; seed < 5000; seed++) if (generateDay(run, mulberry32(seed)).tomorrow?.some(event)) return seed;
  throw new Error('no seed tells of it');
}

function appOn(run: RunState, seed: number, store = memoryStore()) {
  store.write(RUN_KEY, encodeRun(run, seed));
  const app = new App(fakeEffects([], () => 0.5, store), () => {}, 'big');
  const press = (...keys: string[]) => keys.forEach((key) => app.press({ key }));
  press(' ');
  return { app, press, store };
}

describe('the days of the week', () => {
  it('begin on a Tuesday, and a week of them asks for the usual amount: a quiet Monday, a busy Friday and Saturday', () => {
    expect(weekdayName(1)).toBe('Tuesday');
    expect(dateLabel(1)).toContain('TUE');
    expect(weekdayOf(MONDAY)).toBe(1);
    expect(weekdayName(SATURDAY)).toBe('Saturday');
    const week = [1, 2, 3, 4, 5, 6, 7].map(weekFactor);
    expect(week.reduce((a, b) => a + b, 0) / 7).toBeCloseTo(1, 10);
    expect(weekFactor(MONDAY)).toBe(Math.min(...week));
    expect(weekFactor(SATURDAY)).toBe(Math.max(...week));
    expect(weekFactor(MONDAY)).toBeLessThan(0.9);
    expect(weekFactor(4)).toBeGreaterThan(1);
    expect(weekFactor(SATURDAY)).toBeGreaterThan(weekFactor(4));
    expect(weekFactor(WEDNESDAY)).toBe(1);
    // The same weekday, a week on.
    expect(weekFactor(MONDAY + 7)).toBe(weekFactor(MONDAY));
  });

  it('say so in a line the supplier order can show', () => {
    expect(weekLine(MONDAY)).toBe('Monday is a quiet day: clients ask for less.');
    expect(weekLine(SATURDAY)).toBe('Saturday is a busy day: clients ask for more.');
    expect(weekLine(WEDNESDAY)).toBe('Wednesday is an ordinary day.');
    expect([weekMark(MONDAY), weekMark(SATURDAY), weekMark(WEDNESDAY)]).toEqual(['↓', '↑', '']);
  });

  it('make a quiet Monday smaller and a busy Saturday bigger, with a few orders on every day', () => {
    const totals = (day: number) => {
      const run = runOf(day);
      return Array.from({ length: 40 }, (_, i) => asked(generateDay(run, mulberry32(i + 1))));
    };
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const [monday, wednesday, saturday] = [totals(MONDAY), totals(WEDNESDAY), totals(SATURDAY)].map(mean) as [number, number, number];
    expect(monday).toBeLessThan(wednesday * 0.9);
    expect(saturday).toBeGreaterThan(wednesday * 1.1);
    for (const kind of ['small', 'big'] as const) {
      for (let seed = 1; seed <= 20; seed++) {
        const quiet = generateDay(runOf(MONDAY, kind), mulberry32(seed));
        expect(quiet.orders.length).toBeGreaterThanOrEqual(runOf(MONDAY, kind).clients.length - 1 - Math.floor(runOf(MONDAY, kind).clients.length / 10));
      }
    }
  });

  it('are on the supplier order, which names tomorrow\'s day and whether it is quiet or busy', () => {
    const { app, press } = appOn(runOf(SATURDAY - 1), 3);
    playToSupply(app, press);
    expect(app.screen).toBe('supply');
    expect(app.supply!.day).toBe(SATURDAY - 1);
    expect(screen(app).join('\n')).toContain('Saturday is a busy day: clients ask for more.');
  });
});

describe('a town event', () => {
  it('is told the day before, on about one day in four or five, to the clients it is about', () => {
    expect(TOWN_CHANCE).toBeGreaterThanOrEqual(0.2);
    expect(TOWN_CHANCE).toBeLessThanOrEqual(0.25);
    for (const kind of ['small', 'big'] as const) {
      const run = runOf(4, kind);
      const seeds = 1500;
      let days = 0;
      for (let seed = 1; seed <= seeds; seed++) {
        const tomorrow = generateDay(run, mulberry32(seed)).tomorrow ?? [];
        if (tomorrow.some((a) => isTownEvent(a.event))) days++;
      }
      expect(days / seeds).toBeGreaterThan(0.12);
      expect(days / seeds).toBeLessThan(0.28);
    }
  });

  it('is never on the first day, or the second: the fixed morning tells of none, and a run that begins from it has none', () => {
    for (const kind of ['small', 'big'] as const) {
      const first = kind === 'big' ? bigMorning() : smallMorning();
      expect(first.tomorrow).toBeUndefined();
      const run = runFromMorning(first);
      expect(run.day).toBe(1);
      expect(run.ahead).toEqual([]);
      expect(new Supply(first, first.stock).ahead.filter((a) => isTownEvent(a.event) || a.event === 'closed')).toEqual([]);
      for (let seed = 1; seed <= 300; seed++) {
        const none = tomorrowFor(run, first.orders, mulberry32(seed), 0, 10);
        expect(none).toEqual({ ahead: [], notes: [] });
      }
    }
  });

  it('is announced in an overnight message, in the game\'s own voice, with the day and what will be wanted more', () => {
    const run = runOf(4);
    const seed = seedWith(run, (a) => isTownEvent(a.event));
    const morning = generateDay(run, mulberry32(seed));
    const named = morning.tomorrow!.filter((a) => isTownEvent(a.event));
    expect(named.length).toBeGreaterThan(0);
    const note = morning.messages.find((m) => m.kind === 'staff' && m.text.includes('will want more'));
    expect(note).toBeDefined();
    if (!note || note.kind === 'order') throw new Error('not a note');
    expect(note.text).toContain('Saturday');
    expect(note.at).toBeGreaterThanOrEqual(24 * 60 + 3 * 60);
    expect(note.at).toBeLessThanOrEqual(24 * 60 + 5 * 60 + 15);
    const times = morning.messages.map((m) => m.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    // Only clients that are asking today, and in the places it is about.
    const clients = new Map(morning.orders.map((o) => [o.client, o.place]));
    for (const a of named) expect(clients.has(a.client)).toBe(true);
    expect(new Set(named.map((a) => a.event)).size).toBe(1);
  });

  it('is on the first screen, and the supplier order shows it against the items it moves, with an arrow', () => {
    const run = runOf(4);
    const seed = seedWith(run, (a) => isTownEvent(a.event));
    const { app, press } = appOn(run, seed);
    expect(app.screen).toBe('messages');
    const at = app.morning.messages.findIndex((m) => m.kind === 'staff' && m.text.includes('will want more'));
    expect(at).toBeGreaterThanOrEqual(0);
    press(...Array(at).fill('ArrowDown'));
    expect(screen(app).join('\n')).toContain('will want more');
    playToSupply(app, press);
    const event = EVENTS.find((e) => e.id === app.supply!.ahead.find((a) => isTownEvent(a.event))!.event)!;
    const row = app.supply!.rows.findIndex((r) => event.items.includes(r.item.id));
    press(...Array(row).fill('ArrowDown'));
    const supply = screen(app).join('\n');
    expect(supply).toContain('so more');
    expect(supply).toContain('↑');
    // The news comes first, so the three lines beside the bars name its clients before any client's note.
    const first = app.supply!.hints(row)[0]!;
    expect(first.word).toBe(event.word);
    expect(supply).toContain(first.client.split(' ')[0]);
  });

  it('makes the clients it is about ask for more of the items it names, and the rest as before', () => {
    const run = runOf(4);
    const seed = seedWith(run, (a) => isTownEvent(a.event));
    const told = generateDay(run, mulberry32(seed)).tomorrow!.filter((a) => isTownEvent(a.event));
    const event = EVENTS.find((e) => e.id === told[0]!.event)!;
    const names = new Set(told.map((a) => a.client));
    const withIt = generateDay({ ...run, ahead: told }, mulberry32(seed + 1));
    const without = generateDay(run, mulberry32(seed + 1));
    const mine = (m: Morning) => m.orders.filter((o) => names.has(o.client)).reduce((n, o) => n + o.lines.filter((l) => event.items.includes(l.item)).reduce((k, l) => k + l.asked, 0), 0);
    expect(mine(withIt)).toBeGreaterThan(mine(without));
    const units = swings(told, run.usual, run.clients.length).reduce((n, s) => n + s.units, 0);
    expect(units).toBeGreaterThan(0);
    // The same clients, the same notes, the same calls.
    expect(withIt.orders.map((o) => o.client)).toEqual(without.orders.map((o) => o.client));
    expect(withIt.callKinds).toEqual(without.callKinds);
  });

  it('may press on the trucks a little on a busy day, never past what they can carry', () => {
    const run = runOf(SATURDAY);
    const space = (m: Morning) => m.orders.reduce((n, o) => n + o.lines.reduce((k, l) => k + l.asked * (m.items.find((i) => i.id === l.item)?.size ?? 1), 0), 0);
    const room = run.trucks.reduce((n, t) => n + t.capacity, 0);
    for (let seed = 1; seed <= 40; seed++) expect(space(generateDay(run, mulberry32(seed)))).toBeLessThanOrEqual(room * 0.95);
  });

  it('moves nothing else the day\'s dice decide: the same orders\' clients, calls and garage with the news or without', () => {
    const run = runOf(4);
    const seed = seedWith(run, (a) => isTownEvent(a.event));
    const a = generateDay(run, mulberry32(seed));
    const b = generateDay(run, mulberry32(seed));
    expect(a).toEqual(b);
    const without = { ...a, messages: a.messages.filter((m) => m.kind === 'order') };
    expect(without.messages).toEqual(b.messages.filter((m) => m.kind === 'order'));
  });

  it('is played again by R: the same news, the same clients and the same orders', () => {
    const run = runOf(4);
    const { app, press } = appOn(run, seedWith(run, (a) => isTownEvent(a.event)));
    const first = JSON.stringify({ tomorrow: app.morning.tomorrow, messages: app.morning.messages, orders: app.morning.orders });
    playToSupply(app, press);
    press(' ', 'a');
    hold(app, ' ');
    expect(app.screen).toBe('day');
    hold(app, 'r');
    expect(app.screen).toBe('messages');
    expect(JSON.stringify({ tomorrow: app.morning.tomorrow, messages: app.morning.messages, orders: app.morning.orders })).toBe(first);
  });

  it('is kept by a save: the news the night before, and the busy morning it makes, come back after the page is opened again', () => {
    const run = runOf(4);
    const seed = seedWith(run, (a) => isTownEvent(a.event));
    const { app, press, store } = appOn(run, seed);
    const told = app.morning.tomorrow!;
    playToSupply(app, press);
    press(' ', 'a');
    hold(app, ' ');
    press(' ', '3', 'Enter');
    hold(app, ' ');
    // The next morning is the event's: it was carried in the run, and the save made as the morning began holds it.
    expect(app.run.day).toBe(5);
    expect(app.run.ahead.filter((a) => isTownEvent(a.event))).toEqual(told.filter((a) => isTownEvent(a.event)));
    const text = store.read(RUN_KEY)!;
    const again = new App(fakeEffects([], () => 0.5, store), () => {}, 'small');
    again.press({ key: ' ' });
    expect(again.morning.day).toBe(5);
    expect(JSON.stringify(again.morning)).toBe(JSON.stringify(app.morning));
    expect(decodeRun(text)!.run.ahead).toEqual(app.run.ahead);
  });

  it('needs no new save version: a run saved before reads as it did, and one saved with news in it reads back whole', () => {
    expect(SAVE_VERSION).toBe(5);
    const run = runOf(5);
    expect(decodeRun(encodeRun(run, 9))).toEqual({ run, daySeed: 9 });
    const told: Announced[] = [{ client: run.clients[0]!.name, event: 'match' }, { client: run.clients[1]!.name, event: 'closed' }];
    const withNews = { ...run, ahead: told };
    expect(decodeRun(encodeRun(withNews, 9))).toEqual({ run: withNews, daySeed: 9 });
  });

  it('is told in the how-to-play', () => {
    const text = HELP_PAGES.flatMap((p) => p.blocks.map((b) => b.text)).join(' ');
    expect(text).toContain('quiet');
    expect(text).toContain('match day');
    expect(text).toContain('closed');
  });
});

describe('a client that is closed for the day', () => {
  it('is told the day before, now and then, by a message that names the client, the day and why', () => {
    expect(CLOSED_CHANCE).toBeGreaterThan(0);
    const run = runOf(4);
    const seed = seedWith(run, (a) => a.event === 'closed');
    const morning = generateDay(run, mulberry32(seed));
    const closed = morning.tomorrow!.filter((a) => a.event === 'closed');
    expect(closed.length).toBeGreaterThan(0);
    for (const c of closed) {
      const note = morning.messages.find((m) => m.kind === 'staff' && m.text.startsWith(`${c.client} rang`));
      expect(note).toBeDefined();
      if (!note || note.kind === 'order') throw new Error('not a note');
      expect(note.text).toMatch(/closed on Saturday for .+\. No order from them\.$/);
    }
    // Not every day, not many clients at once.
    let days = 0;
    let most = 0;
    for (let s = 1; s <= 600; s++) {
      const n = (generateDay(run, mulberry32(s)).tomorrow ?? []).filter((a) => a.event === 'closed').length;
      if (n > 0) days++;
      most = Math.max(most, n);
    }
    expect(days / 600).toBeGreaterThan(0.3);
    expect(days / 600).toBeLessThan(0.9);
    expect(most).toBeLessThanOrEqual(Math.floor(run.clients.length / 10));
  });

  it('is never the hospital, a school or any client that always asks for a time', () => {
    const run = runOf(4);
    const always = new Set(run.clients.filter((c) => c.before != null).map((c) => c.name));
    expect(always.has("St Jude's Hospital")).toBe(true);
    expect(always.has('Millford School')).toBe(true);
    expect(always.has('Ashby Primary School')).toBe(true);
    for (let seed = 1; seed <= 1500; seed++) {
      for (const a of generateDay(run, mulberry32(seed)).tomorrow ?? []) if (a.event === 'closed') expect(always.has(a.client)).toBe(false);
    }
  });

  it('is more often a small client than a big one', () => {
    const base = runOf(4);
    const sized = (size: number) => ({ ...base, clients: base.clients.map((c) => (c.before == null ? { ...c, size } : c)) });
    const count = (run: RunState) => {
      let n = 0;
      for (let seed = 1; seed <= 600; seed++) n += (generateDay(run, mulberry32(seed)).tomorrow ?? []).filter((a) => a.event === 'closed').length;
      return n;
    };
    expect(count(sized(0.5))).toBeGreaterThan(count(sized(2)));
  });

  it('sends no order the day after, and the others ask for what is left of the usual amount', () => {
    const run = runOf(5);
    const quiet = run.clients.find((c) => c.before == null)!;
    const closed: Announced[] = [{ client: quiet.name, event: 'closed' }];
    const total = (r: RunState) => Array.from({ length: 30 }, (_, i) => asked(generateDay(r, mulberry32(i + 1)))).reduce((a, b) => a + b, 0);
    const shut = Array.from({ length: 30 }, (_, i) => generateDay({ ...run, ahead: closed }, mulberry32(i + 1)));
    for (const m of shut) {
      expect(m.orders.map((o) => o.client)).not.toContain(quiet.name);
      expect(m.orders).toHaveLength(run.clients.length - 1);
      expect(closedIn(run.ahead).size).toBe(0);
    }
    const open = total(run);
    expect(shut.reduce((n, m) => n + asked(m), 0)).toBeLessThan(open);
    // About one client's share of 38 less.
    expect(shut.reduce((n, m) => n + asked(m), 0)).toBeGreaterThan(open * 0.9);
  });

  it('keeps its mood and what it was promised for its next order, since it had no day of its own', () => {
    const run = runOf(5);
    const who = run.clients.find((c) => c.before == null)!.name;
    const other = run.clients.find((c) => c.name !== who && c.before == null)!.name;
    const state: RunState = {
      ...run,
      ahead: [{ client: who, event: 'closed' }],
      moods: { [who]: 'let down', [other]: 'pleased' },
      promises: [{ client: who, item: 'pork', qty: 4 }, { client: other, item: 'eggs', qty: 2 }],
    };
    const outcome: DayOutcome = { left: {}, ordered: {}, moods: { [other]: 'pleased' }, today: {}, promises: [], growth: null, earned: 0 };
    const next = nextDay(state, outcome);
    expect(next.moods[who]).toBe('let down');
    expect(next.promises).toEqual([{ client: who, item: 'pork', qty: 4 }]);
    // The day it is back, its order says so.
    const order = generateDay({ ...next, ahead: [] }, mulberry32(3)).orders.find((o) => o.client === who)!;
    expect(order.note).toContain('As promised: 4 pork');
    // A client that was open settles as it always did: what is said of its day replaces what was.
    expect(nextDay({ ...state, ahead: [] }, outcome).promises).toEqual([]);
  });

  it('is on the supplier order, against every item, as less', () => {
    const run = runOf(4);
    const seed = seedWith(run, (a) => a.event === 'closed');
    const { app, press } = appOn(run, seed);
    playToSupply(app, press);
    const who = app.supply!.ahead.find((a) => a.event === 'closed')!.client;
    expect(app.supply!.hints(0).some((h) => h.client === who && !h.busy && h.word === 'closed')).toBe(true);
    const text = screen(app).join('\n');
    expect(text).toContain('(closed)');
    expect(text).toContain('so less');
    expect(text).toContain('↓');
  });

  it('is kept by a save, and played again by R', () => {
    const run = runOf(4);
    const { app, press, store } = appOn(run, seedWith(run, (a) => a.event === 'closed'));
    const told = app.morning.tomorrow!;
    const first = JSON.stringify(app.morning);
    playToSupply(app, press);
    press(' ', 'a');
    hold(app, ' ');
    hold(app, 'r');
    expect(JSON.stringify(app.morning)).toBe(first);
    playToSupply(app, press);
    press(' ', 'a');
    hold(app, ' ');
    press(' ', '3', 'Enter');
    hold(app, ' ');
    const closed = told.filter((a) => a.event === 'closed').map((a) => a.client);
    expect(app.run.day).toBe(5);
    for (const name of closed) expect(app.morning.orders.map((o) => o.client)).not.toContain(name);
    const again = new App(fakeEffects([], () => 0.5, store), () => {}, 'small');
    again.press({ key: ' ' });
    expect(JSON.stringify(again.morning)).toBe(JSON.stringify(app.morning));
  });
});
