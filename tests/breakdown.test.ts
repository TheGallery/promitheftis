import { describe, expect, it } from 'vitest';
import { BREAKDOWN_CHANCE, breakdownFor, MIN_FLEET, shortReason } from '../src/game/breakdown';
import { Desk } from '../src/game/desk';
import { generateDay } from '../src/game/generate';
import { fleetOf } from '../src/game/growth';
import { bigMorning, smallMorning } from '../src/game/morning';
import { mulberry32 } from '../src/game/random';
import { runFromMorning, type RunState } from '../src/game/run';
import { decodeRun, encodeRun, SAVE_VERSION } from '../src/game/save';
import { App, RUN_KEY } from '../src/ui/app';
import { HELP_PAGES } from '../src/ui/help';
import { memoryStore } from '../src/ui/store';
import { fakeEffects, hold, playToSupply, screen } from './helpers';

/** A run on day 4 with the big morning's trucks, or just the first `trucks` of them. */
function runOf(trucks = 9, day = 4): RunState {
  const run = runFromMorning(bigMorning());
  return { ...run, day, trucks: run.trucks.slice(0, trucks) };
}

/** The first seed from 1 up whose morning has a truck at the garage. */
function garageSeed(run: RunState, after = 0): number {
  for (let seed = after + 1; seed < 5000; seed++) if (generateDay(run, mulberry32(seed)).garage) return seed;
  throw new Error('no seed gives a truck at the garage');
}

/** An app opened on a saved run, at the morning of that day. */
function appOn(run: RunState, seed: number, store = memoryStore()) {
  store.write(RUN_KEY, encodeRun(run, seed));
  const app = new App(fakeEffects([], () => 0.5, store), () => {}, 'big');
  const press = (...keys: string[]) => keys.forEach((key) => app.press({ key }));
  press(' '); // WELCOME BACK -> continue
  return { app, press, store };
}

describe('a truck at the garage', () => {
  it('happens on about one morning in four or five', () => {
    const run = runOf();
    const seeds = 3000;
    let days = 0;
    for (let seed = 1; seed <= seeds; seed++) if (generateDay(run, mulberry32(seed)).garage) days++;
    expect(BREAKDOWN_CHANCE).toBeGreaterThanOrEqual(0.2);
    expect(BREAKDOWN_CHANCE).toBeLessThanOrEqual(0.25);
    expect(days / seeds).toBeGreaterThan(0.17);
    expect(days / seeds).toBeLessThan(0.27);
  });

  it('never happens on the first morning, whichever way the dice fall', () => {
    for (const kind of ['small', 'big'] as const) {
      const run = runFromMorning(kind === 'big' ? bigMorning() : smallMorning());
      expect(run.day).toBe(1);
      for (let seed = 1; seed <= 500; seed++) expect(breakdownFor(run, mulberry32(seed), 0, 10)).toBeNull();
    }
    expect(bigMorning().garage).toBeUndefined();
    expect(smallMorning().garage).toBeUndefined();
    expect(new App(fakeEffects(), () => {}, 'big').morning.garage).toBeUndefined();
  });

  it('never takes the last truck: a business with one truck is never without it', () => {
    expect(MIN_FLEET).toBeGreaterThanOrEqual(2);
    const one = runOf(1);
    for (let seed = 1; seed <= 1000; seed++) expect(generateDay(one, mulberry32(seed)).garage).toBeUndefined();
    const two = runOf(2);
    for (let seed = 1; seed <= 1000; seed++) {
      const morning = generateDay(two, mulberry32(seed));
      const free = morning.trucks.filter((t) => t.id !== morning.garage?.truckId);
      expect(free.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('is one of the business\'s own trucks, and every truck can be the one', () => {
    const run = runOf(3);
    const ids = new Set<number>();
    for (let seed = 1; seed <= 600; seed++) {
      const garage = generateDay(run, mulberry32(seed)).garage;
      if (garage) {
        expect(run.trucks.map((t) => t.id)).toContain(garage.truckId);
        ids.add(garage.truckId);
      }
    }
    expect([...ids].sort()).toEqual([1, 2, 3]);
  });

  it('moves nothing else the day\'s dice decide: the same orders, notes and calls with or without it', () => {
    const run = runOf();
    const seed = garageSeed(run);
    const withIt = generateDay(run, mulberry32(seed));
    const without = generateDay({ ...run, trucks: run.trucks.slice(0, 1) }, mulberry32(seed));
    expect(withIt.garage).toBeDefined();
    expect(without.garage).toBeUndefined();
    expect(withIt.callKinds).toEqual(without.callKinds);
    expect(withIt.callSalt).toBe(without.callSalt);
    expect(withIt.messages.filter((m) => m.kind === 'order')).toEqual(without.messages.filter((m) => m.kind === 'order'));
  });

  it('is announced in the overnight messages, by name, with what is wrong and when it is back', () => {
    const run = runOf();
    const morning = generateDay(run, mulberry32(garageSeed(run)));
    const { truckId, reason } = morning.garage!;
    const note = morning.messages.find((m) => m.kind === 'staff' && m.text.includes('garage'));
    expect(note).toBeDefined();
    if (!note || note.kind === 'order') throw new Error('not a note');
    expect(note.text).toContain(`Truck ${truckId}`);
    expect(note.text).toContain(`with ${reason}`);
    expect(note.text).toContain('Back tomorrow');
    // Between 03:00 and 05:15, with the other notes, and the messages stay in the order they came.
    expect(note.at).toBeGreaterThanOrEqual(24 * 60 + 3 * 60);
    expect(note.at).toBeLessThanOrEqual(24 * 60 + 5 * 60 + 15);
    const times = morning.messages.map((m) => m.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    // A morning without one says nothing of the kind.
    const calm = generateDay(run, mulberry32(garageSeed(run) + 1000));
    if (!calm.garage) expect(calm.messages.some((m) => m.kind === 'staff' && m.text.includes('garage'))).toBe(false);
  });

  it('is on the first screen: the overnight messages say which truck is at the garage', () => {
    const run = runOf();
    const seed = garageSeed(run);
    const { app } = appOn(run, seed);
    expect(app.screen).toBe('messages');
    const id = app.morning.garage!.truckId;
    expect(screen(app).join('\n')).toContain(`Truck ${id} is at the garage today`);
    const at = app.morning.messages.findIndex((m) => m.kind === 'staff' && m.text.includes('garage'));
    expect(at).toBeGreaterThanOrEqual(0);
    const press = (...keys: string[]) => keys.forEach((key) => app.press({ key }));
    press(...Array(at).fill('ArrowDown'));
    expect(screen(app).join('\n')).toContain(`is at the garage with ${app.morning.garage!.reason}`);
  });

  it('is said again when the desk opens, and the how-to-play tells of it', () => {
    const run = runOf();
    const { app, press } = appOn(run, garageSeed(run));
    press(' ');
    expect(app.screen).toBe('desk');
    expect(app.status).toContain(`Truck ${app.morning.garage!.truckId} is at the garage today`);
    expect(app.tone).toBe('warn');
    expect(screen(app).join('\n')).toContain('nothing can go on it');
    expect(HELP_PAGES.flatMap((p) => p.blocks.map((b) => b.text)).join(' ')).toContain('at the garage');
  });

  it('cannot be loaded: the desk turns an order away from it, and the other trucks are as before', () => {
    const run = runOf();
    const morning = generateDay(run, mulberry32(garageSeed(run)));
    const desk = new Desk(morning);
    const id = morning.garage!.truckId;
    expect(desk.inGarage(id)).toBe(true);
    expect(desk.assignTruck(0, id)).toEqual({ ok: false, reason: 'garage' });
    expect(desk.truckFor(0)).toBeNull();
    const clock = desk.clock;
    const other = morning.trucks.find((t) => t.id !== id)!;
    expect(desk.inGarage(other.id)).toBe(false);
    expect(desk.assignTruck(0, other.id)).toEqual({ ok: true });
    expect(desk.clock).toBe(clock + 1);
  });

  it('shows on the desk and the sheets as at the garage, and says so when the truck is picked', () => {
    const run = runOf();
    const { app, press } = appOn(run, garageSeed(run));
    const id = app.morning.garage!.truckId;
    press(' ');
    expect(app.screen).toBe('desk');
    const text = screen(app).join('\n');
    expect(text).toMatch(new RegExp(`${id} \\w+ +at the garage +${shortReason(app.morning.garage!.reason)}`));
    // Pick it: a warning, and the order is still without a truck.
    press('Enter', 'Enter', 'Enter', 'Enter', 'Enter');
    while (app.pane !== 'trucks') press('Tab');
    const at = app.morning.trucks.findIndex((t) => t.id === id);
    press(...Array(app.morning.trucks.length).fill('ArrowUp'), ...Array(at).fill('ArrowDown'), 'Enter');
    expect(app.status).toContain('at the garage');
    expect(app.tone).toBe('warn');
    expect(app.desk.truckFor(app.orderSel)).toBeNull();
    // The sheets list it, unused, and open it to say why.
    press('Escape');
    press(' ');
    expect(app.screen).toBe('sheets');
    expect(screen(app).join('\n')).toContain('at the garage');
    press(...Array(at).fill('ArrowDown'), 'Enter');
    expect(screen(app).join('\n')).toContain('Back tomorrow');
  });

  it('costs nothing and carries nothing over: the day shows it in the garage and the trucks stay the same tomorrow', () => {
    const run = runOf(3);
    const { app, press } = appOn(run, garageSeed(run));
    const id = app.morning.garage!.truckId;
    playToSupply(app, press);
    press(' ', 'a');
    hold(app, ' ');
    expect(app.screen).toBe('day');
    const result = app.result!;
    const truck = result.trucks.find((t) => t.truckId === id)!;
    expect(truck).toMatchObject({ garage: true, stops: 0, backAt: null, squares: 0 });
    const day = app.day!;
    const row = day.trucks.find((t) => t.truckId === id)!;
    expect(row).toMatchObject({ garage: true, backAt: null, cost: 0 });
    expect(day.trucks.filter((t) => t.garage)).toHaveLength(1);
    expect(screen(app).join('\n')).toContain('at the garage');
    // Its cost is not in the money, and the fleet's space leaves it out.
    const driven = day.trucks.filter((t) => t.backAt != null).length;
    expect(day.money.trucksOut).toBe(driven);
    const fleet = fleetOf(day);
    expect(fleet).toMatchObject({ trucks: 3, garage: 1 });
    expect(fleet.out + fleet.yard).toBe(2);
    expect(fleet.space).toBe(day.trucks.filter((t) => !t.garage).reduce((n, t) => n + t.capacity, 0));
    // Tomorrow the business still owns all of its trucks.
    press(' ', '3', 'Enter');
    hold(app, ' ');
    expect(app.run.trucks.map((t) => t.id)).toEqual(run.trucks.map((t) => t.id));
  });

  it('makes the other trucks carry its orders: with no truck it cannot take, an order stays unloaded', () => {
    const run = runOf(2);
    const seed = garageSeed(run);
    const { app } = appOn(run, seed);
    const garage = app.morning.garage!.truckId;
    const free = app.morning.trucks.find((t) => t.id !== garage)!;
    const cap = app.morning.trucks.reduce((n, t) => n + t.capacity, 0);
    // The orders were made to fill most of both trucks; one truck cannot take them all.
    const d = app.desk;
    let loaded = 0;
    for (let o = 0; o < d.orderCount; o++) {
      d.order(o).lines.forEach((_, l) => d.acceptLine(o, l));
      if (d.assignTruck(o, free.id).ok) loaded++;
      d.assignTruck(o, garage);
    }
    expect(d.load(garage)).toBe(0);
    expect(d.load(free.id)).toBeLessThanOrEqual(free.capacity);
    expect(cap).toBeGreaterThan(free.capacity);
    expect(loaded).toBeLessThan(d.orderCount);
  });

  it('plays the same when the day is played again: R brings the same truck, the same note and the same orders', () => {
    const run = runOf(3);
    const { app, press } = appOn(run, garageSeed(run));
    const first = JSON.stringify({ garage: app.morning.garage, messages: app.morning.messages, orders: app.morning.orders });
    playToSupply(app, press);
    press(' ', 'a');
    hold(app, ' ');
    expect(app.screen).toBe('day');
    hold(app, 'r');
    expect(app.screen).toBe('messages');
    expect(JSON.stringify({ garage: app.morning.garage, messages: app.morning.messages, orders: app.morning.orders })).toBe(first);
    expect(new Desk(app.morning).inGarage(app.morning.garage!.truckId)).toBe(true);
  });

  it('is kept by a save: opening the page again brings the same truck and the same note', () => {
    const run = runOf(3);
    const { app, store } = appOn(run, garageSeed(run));
    const before = JSON.stringify({ garage: app.morning.garage, messages: app.morning.messages });
    const again = new App(fakeEffects([], () => 0.5, store), () => {}, 'small');
    expect(again.screen).toBe('start');
    again.press({ key: ' ' });
    expect(again.screen).toBe('messages');
    expect(JSON.stringify({ garage: again.morning.garage, messages: again.morning.messages })).toBe(before);
    expect(again.desk.inGarage(again.morning.garage!.truckId)).toBe(true);
  });

  it('is kept by a save made after playing a day: the next morning\'s truck comes back with it', () => {
    const run = runOf(3);
    const { app, press, store } = appOn(run, 1);
    playToSupply(app, press);
    press(' ', 'a');
    hold(app, ' ');
    press(' ', '3', 'Enter');
    hold(app, ' ');
    expect(app.run.day).toBe(5);
    const again = new App(fakeEffects([], () => 0.5, store), () => {}, 'small');
    again.press({ key: ' ' });
    expect(JSON.stringify(again.morning)).toBe(JSON.stringify(app.morning));
  });

  it('needs no new save version: the saved data holds no garage, and a run saved before reads as it did', () => {
    expect(SAVE_VERSION).toBe(4);
    const run = runOf(3);
    const text = encodeRun(run, garageSeed(run));
    expect(text).not.toContain('garage');
    expect(decodeRun(text)).toEqual({ run, daySeed: garageSeed(run) });
  });
});
