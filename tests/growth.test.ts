import { describe, expect, it } from 'vitest';
import { bigMorning, smallMorning } from '../src/game/morning';
import { growthOptions, NEW_CLIENTS, newClientFor, tightestRoom, type NewClient } from '../src/game/growth';
import { PLACES } from '../src/game/places';
import { plain, ROWS } from '../src/ui/grid';
import { screenLines } from '../src/ui/view';
import { screen, summary, toDay } from './helpers';

const clientsOf = (m: { orders: Array<{ client: string }> }) => m.orders.map((o) => o.client);
const CLIENT: NewClient = { name: 'The Salt Cellar', place: 'saltmarket', contact: 'Ines' };
/** A random source that gives these numbers in turn, then the last one again. */
const sequence = (...values: number[]) => {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)] as number;
};

describe('the tightest room', () => {
  it('is the freezer when the order fills it most', () => {
    const { day } = summary(0, [], { chips: 40 });
    expect(tightestRoom(day.rooms).kept).toBe('freezer');
  });

  it('is the fridge or the dry store when that one is fullest', () => {
    expect(tightestRoom(summary(0, [], { pork: 300 }).day.rooms).kept).toBe('fridge');
    expect(tightestRoom(summary(0, [], { flour: 100 }).day.rooms).kept).toBe('dry');
  });

  it('counts a room that is over full as the tightest, the most over first', () => {
    const { day } = summary(0, [], { chips: 999, flour: 999 });
    expect(day.overFull.map((r) => r.kept)).toEqual(['freezer', 'dry']);
    const most = day.rooms.reduce((a, b) => (b.space.pct > a.space.pct ? b : a));
    expect(tightestRoom(day.rooms)).toBe(most);
  });

  it('is the first listed room when they tie', () => {
    const { day } = summary(0, [], {});
    const flat = day.rooms.map((r) => ({ ...r, space: { ...r.space, pct: 50 } }));
    expect(tightestRoom(flat).kept).toBe('freezer');
  });
});

describe('the three growth options', () => {
  it('lists another truck, a bigger room and a new client, in that order', () => {
    const { day } = summary(0, [], { chips: 40 });
    const options = growthOptions(day, CLIENT);
    expect(options.map((o) => o.growth.kind)).toEqual(['truck', 'room', 'client']);
    expect(options[0]!.title).toBe('Another truck');
    for (const o of options) {
      expect(o.gain.length).toBeGreaterThan(0);
      expect(o.work.length).toBeGreaterThan(0);
    }
    expect(options.map((o) => `${o.gain} ${o.work}`).join(' ')).not.toMatch(/[$£€]|money|price|cost|profit/i);
  });

  it('names the tightest room in the option and records which one it is', () => {
    const cases = [
      [{ chips: 40 }, 'freezer', 'A bigger freezer'],
      [{ pork: 300 }, 'fridge', 'A bigger fridge'],
      [{ flour: 100 }, 'dry', 'A bigger dry store'],
    ] as const;
    for (const [amounts, room, title] of cases) {
      const { day } = summary(0, [], amounts);
      const option = growthOptions(day, CLIENT)[1]!;
      expect(option.title).toBe(title);
      expect(option.growth).toEqual({ kind: 'room', room });
      expect(option.gain).toContain(`${tightestRoom(day.rooms).space.pct}% full tomorrow`);
    }
  });

  it('offers the restaurant it is given, with its square and contact', () => {
    const { day } = summary(0);
    const option = growthOptions(day, CLIENT)[2]!;
    expect(option.growth).toEqual({ kind: 'client', client: CLIENT });
    expect(option.title).toBe('A new client: The Salt Cellar');
    expect(option.gain).toContain('The Salt Cellar in Saltmarket');
    expect(option.gain).toContain('contact Ines');
  });
});

describe('the new client', () => {
  const pool = (taken: readonly string[]) => NEW_CLIENTS.filter((c) => !taken.includes(c.name));

  it('has a pool of restaurants on the nine squares, none of them a client of either morning', () => {
    const clients = [...clientsOf(smallMorning()), ...clientsOf(bigMorning())];
    for (const c of NEW_CLIENTS) {
      expect(clients).not.toContain(c.name);
      expect(PLACES.map((p) => p.id)).toContain(c.place);
      expect(c.contact.length).toBeGreaterThan(0);
    }
    expect(new Set(NEW_CLIENTS.map((c) => c.name)).size).toBe(NEW_CLIENTS.length);
  });

  it('has at least one restaurant on every one of the nine squares', () => {
    for (const p of PLACES) {
      expect(NEW_CLIENTS.map((c) => c.place)).toContain(p.id);
    }
    expect(PLACES).toHaveLength(9);
  });

  it('is picked with the random number it is given: the first at 0, the last just under 1', () => {
    const taken = clientsOf(smallMorning());
    expect(newClientFor(taken, () => 0)).toEqual(NEW_CLIENTS[0]);
    expect(newClientFor(taken, () => 0.999999)).toEqual(NEW_CLIENTS.at(-1));
    expect(newClientFor(taken, () => 0.5)).toEqual(NEW_CLIENTS[Math.floor(NEW_CLIENTS.length / 2)]);
  });

  it('can be any of the pool, so it differs from game to game', () => {
    const seen = new Set(NEW_CLIENTS.map((_, i) => newClientFor([], () => (i + 0.5) / NEW_CLIENTS.length).name));
    expect(seen.size).toBe(NEW_CLIENTS.length);
  });

  it('is never one that is a client already, whatever the random number', () => {
    const taken = [NEW_CLIENTS[0]!.name, NEW_CLIENTS[3]!.name];
    for (let i = 0; i < 20; i++) {
      const c = newClientFor(taken, () => i / 20);
      expect(taken).not.toContain(c.name);
      expect(pool(taken)).toContain(c);
    }
  });

  it('keeps to the pool when a random source gives a number outside 0 to 1', () => {
    expect(NEW_CLIENTS).toContain(newClientFor([], () => 1));
    expect(NEW_CLIENTS).toContain(newClientFor([], () => -0.5));
  });

  it('still names someone when every candidate is a client already', () => {
    expect(newClientFor(NEW_CLIENTS.map((c) => c.name), () => 0.3).name).not.toBe('');
  });
});

describe('choosing what to grow', () => {
  it('starts with nothing chosen, and ENTER on the day opens the choice', () => {
    const { app, press } = toDay();
    expect(app.growth).toBeNull();
    expect(app.growthOpen).toBe(false);
    press('Enter');
    expect(app.growthOpen).toBe(true);
    expect(app.screen).toBe('day');
    expect(app.growthSel).toBe(0);
    expect(app.growth).toBeNull();
  });

  it('moves with ↑↓ and 1-3 and stays within the three', () => {
    const { app, press } = toDay();
    press('Enter', 'ArrowDown', 'ArrowDown', 'ArrowDown');
    expect(app.growthSel).toBe(2);
    press('ArrowUp');
    expect(app.growthSel).toBe(1);
    press('3');
    expect(app.growthSel).toBe(2);
    press('1');
    expect(app.growthSel).toBe(0);
    press('4');
    expect(app.growthSel).toBe(0);
    press('9');
    expect(app.growthSel).toBe(0);
    expect(app.growth).toBeNull();
  });

  it('records the choice as plain state when ENTER confirms, and the pick can no longer be changed', () => {
    const { app, press } = toDay(0, 'small', ['9', '9', '9']);
    press('Enter', '2', 'Enter');
    expect(app.growth).toEqual({ kind: 'room', room: tightestRoom(app.day!.rooms).kept });
    expect(app.status).toContain('Chosen: A bigger');
    expect(app.status).toContain('tomorrow');
    const chosen = app.growth;
    press('1', 'ArrowUp', 'ArrowDown');
    expect(app.growthSel).toBe(1);
    expect(app.growth).toBe(chosen);
    expect(app.screen).toBe('day');
  });

  it('records a truck and a new client as well', () => {
    const truck = toDay();
    truck.press('Enter', '1', 'Enter');
    expect(truck.app.growth).toEqual({ kind: 'truck' });
    const client = toDay();
    client.press('Enter', 'ArrowDown', 'ArrowDown', 'Enter');
    const option = client.app.growthOptions[2]!;
    expect(client.app.growth).toEqual(option.growth);
    expect(client.app.growth?.kind).toBe('client');
  });

  it('does not touch today: the result, the order and the day are as they were', () => {
    const { app, press } = toDay();
    const before = JSON.stringify([app.result, app.day, app.supply?.ordered(), app.desk.clock]);
    press('Enter', '3', 'Enter');
    expect(JSON.stringify([app.result, app.day, app.supply?.ordered(), app.desk.clock])).toBe(before);
    expect(app.morning.orders.map((o) => o.client)).not.toContain((app.growth as { client: { name: string } }).client.name);
  });

  it('goes back to the day with ESC and opens again on the choice that was made', () => {
    const { app, press } = toDay();
    press('Enter', '2', 'Escape');
    expect(app.growthOpen).toBe(false);
    expect(app.growth).toBeNull();
    press('Enter', 'Enter', 'Escape', 'Enter');
    expect(app.growth).not.toBeNull();
    expect(app.growthSel).toBe(1);
  });

  it('plays the sounds: a click to move, a finishing knock to choose, nothing for a key that changes nothing', () => {
    const cues: string[] = [];
    const { app, press } = toDay(0, 'small', ['a'], cues);
    cues.length = 0;
    press('Enter', 'ArrowDown', 'ArrowUp', 'ArrowUp', 'Enter');
    expect(cues).toEqual(['confirm', 'move', 'move', 'finish']);
    cues.length = 0;
    press('ArrowDown', 'x');
    expect(cues).toEqual([]);
    press('Escape');
    expect(cues).toEqual(['confirm']);
    expect(app.growthOpen).toBe(false);
    cues.length = 0;
    press('Enter', 'Enter');
    expect(cues).toEqual(['confirm', 'confirm']);
    expect(app.screen).toBe('messages');
  });

  it.each(['r', 'R'])('%s plays the morning again and forgets the choice', (key) => {
    const { app, press } = toDay();
    press('Enter', '2', 'Enter');
    expect(app.growth).not.toBeNull();
    press(key);
    expect(app.screen).toBe('messages');
    expect(app.morning.id).toBe('small');
    expect([app.growth, app.growthOpen, app.growthSel]).toEqual([null, false, 0]);
  });

  it.each([['b', 'big'], ['s', 'small']] as const)('%s loads the %s morning and forgets the choice', (key, id) => {
    const { app, press } = toDay(0, id === 'big' ? 'small' : 'big');
    press('Enter', '3', 'Enter');
    expect(app.growth?.kind).toBe('client');
    press(key);
    expect(app.screen).toBe('messages');
    expect(app.morning.id).toBe(id);
    expect([app.growth, app.growthOpen, app.growthSel]).toEqual([null, false, 0]);
  });

  it('forgets a choice when the same morning is played to the end of the day again', () => {
    const first = toDay();
    first.press('Enter', '1', 'Enter');
    expect(first.app.growth).toEqual({ kind: 'truck' });
    const again = toDay();
    expect(again.app.growth).toBeNull();
    expect(again.app.growthOpen).toBe(false);
  });
});

describe('the new client in the game', () => {
  const offered = (app: { growthOptions: Array<{ growth: { kind: string } }> }) => app.growthOptions[2]!.growth as { kind: 'client'; client: NewClient };

  it('is picked with the random source the app was given, and is not one of the morning\'s clients', () => {
    const first = toDay(0, 'small', ['a'], [], () => 0).app;
    const last = toDay(0, 'small', ['a'], [], () => 0.999).app;
    expect(offered(first).client).toEqual(NEW_CLIENTS[0]);
    expect(offered(last).client).toEqual(NEW_CLIENTS.at(-1));
    for (const app of [first, last]) expect(clientsOf(app.morning)).not.toContain(offered(app).client.name);
  });

  it('stays the same while the day is on show, and is what a choice of it records', () => {
    const random = sequence(0.3, 0.9);
    const { app, press } = toDay(0, 'small', ['a'], [], random);
    const before = offered(app).client;
    press('Enter', 'Escape', 'Enter', 'ArrowDown', 'ArrowUp', 'ArrowDown', 'ArrowDown');
    expect(offered(app).client).toEqual(before);
    expect(screen(app).join('\n')).toContain(`A new client: ${before.name}`);
    press('Enter');
    expect(app.growth).toEqual({ kind: 'client', client: before });
  });

  it('is forgotten by R, and the next game picks its own', () => {
    const { app, press } = toDay(0, 'small', ['a'], [], () => 0);
    expect(offered(app).client).toEqual(NEW_CLIENTS[0]);
    press('r');
    expect(app.growthOptions).toEqual([]);
    const again = toDay(0, 'small', ['a'], [], sequence(0.999)).app;
    expect(offered(again).client).toEqual(NEW_CLIENTS.at(-1));
  });

  it('draws no random number for anything else in the game', () => {
    let draws = 0;
    toDay(0, 'big', ['a'], [], () => (draws++, 0));
    expect(draws).toBe(1);
  });
});

describe('the growth screen', () => {
  it('shows the three options and what today showed, 120 columns by 30 rows', () => {
    const { app, press } = toDay(0, 'small', ['9', '9', '9']);
    press('Enter');
    const text = screen(app).join('\n');
    expect(text).toContain('END OF THE DAY');
    expect(text).toContain('18:00');
    expect(text).toContain('WHAT TO GROW');
    for (const o of app.growthOptions) {
      expect(text).toContain(o.title);
      expect(text).toContain(o.gain);
      expect(text).toContain(o.work);
    }
    expect(text).toContain('WHAT TODAY SHOWED');
    for (const room of ['FREEZER', 'FRIDGE', 'DRY STORE']) expect(text).toMatch(new RegExp(`${room} +\\d+% full tomorrow`));
    expect(text).toContain('the tightest');
    expect(text).toContain('It takes effect tomorrow');
    expect(text).not.toContain('…');
    expect(text).not.toMatch(/[$£€]|money|price|cost|profit/i);
  });

  it('highlights the picked option and moves the highlight with the keys', () => {
    const { app, press } = toDay();
    press('Enter');
    const highlighted = () =>
      screenLines(app)
        .filter((l) => l.some(([, c]) => c === 'hl'))
        .map((l) => l.map(([t]) => t).join(''));
    expect(highlighted()).toHaveLength(1);
    expect(highlighted()[0]).toContain('▶ 1  Another truck');
    press('ArrowDown');
    expect(highlighted()[0]).toContain('▶ 2  A bigger');
    press('3');
    expect(highlighted()[0]).toContain(`▶ 3  ${app.growthOptions[2]!.title}`);
  });

  it('says what was chosen and that it takes effect tomorrow, and lists only the keys that work', () => {
    const { app, press } = toDay();
    press('Enter');
    const pending = screen(app);
    for (const word of ['pick one', 'choose it', 'back to the day', 'play again', 'big morning', 'colours', 'sound']) expect(pending[ROWS - 1]).toContain(word);
    press('3', 'Enter');
    const lines = screen(app);
    const text = lines.join('\n');
    expect(text).toContain('YOU CHOSE');
    expect(text).not.toContain('WHAT TO GROW');
    expect(text).toContain(app.growthOptions[2]!.title);
    expect(text).toContain('chosen');
    expect(text).toContain('It takes effect tomorrow');
    expect(lines[ROWS - 1]).toContain('next morning');
    expect(lines[ROWS - 1]).toContain('back to the day');
    expect(lines[ROWS - 1]).not.toContain('choose it');
    expect(lines[ROWS - 1]).not.toContain('1-3');
  });

  it('fits 120 columns in both colour schemes, before and after choosing', () => {
    const { app, press } = toDay(0, 'big');
    press('Enter');
    screen(app);
    press('F2');
    expect(app.blue).toBe(true);
    screen(app);
    press('Enter');
    screen(app);
    const classes = new Set(screenLines(app).flatMap((l) => l.map(([, c]) => c)));
    for (const c of classes) expect(['', 'b', 'd', 'w', 'acc', 'hl', 'w hl', 'acc hl', 'kbar', 'k']).toContain(c);
    press('F2');
    expect(app.blue).toBe(false);
    expect(plain(screenLines(app))).toHaveLength(ROWS);
  });

  it('is the day screen again after ESC, with the same client highlighted', () => {
    const { app, press } = toDay();
    press('ArrowDown', 'Enter', 'Escape');
    expect(app.daySel).toBe(1);
    expect(screen(app).join('\n')).toContain('HOW THE DAY WENT');
    expect(screen(app).join('\n')).toContain(app.day!.orders[1]!.client.toUpperCase());
  });
});
