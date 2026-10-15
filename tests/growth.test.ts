import { describe, expect, it } from 'vitest';
import { newClientFor, randomFrom, type NewClient } from '../src/game/clients';
import { fleetOf, growthOptions, tightestRoom } from '../src/game/growth';
import { formatMoney, truckPrice } from '../src/game/money';
import { smallMorning } from '../src/game/morning';
import { runFromMorning } from '../src/game/run';
import { plain, ROWS } from '../src/ui/grid';
import { screenLines } from '../src/ui/view';
import { hold, screen, summary, toDay } from './helpers';

const clientsOf = (m: { orders: Array<{ client: string }> }) => m.orders.map((o) => o.client);
const CLIENT: NewClient = { name: 'The Salt Cellar', place: 'saltmarket', contact: 'Ines', shape: { size: 1 } };
const BUSINESS = runFromMorning(smallMorning());
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
    const options = growthOptions(day, CLIENT, BUSINESS);
    expect(options.map((o) => o.growth.kind)).toEqual(['truck', 'room', 'client']);
    expect(options[0]!.title).toBe('Another truck');
    for (const o of options) {
      expect(o.gain.length).toBeGreaterThan(0);
      expect(o.work.length).toBeGreaterThan(0);
      expect(o.work).not.toMatch(/[$£€]|money|price|cost|profit/i);
    }
  });

  it('names the tightest room in the option and records which one it is, with how full it is and what spoils', () => {
    const cases = [
      [{ chips: 40 }, 'freezer', 'A bigger freezer'],
      [{ pork: 300 }, 'fridge', 'A bigger fridge'],
      [{ flour: 100 }, 'dry', 'A bigger dry store'],
    ] as const;
    for (const [amounts, room, title] of cases) {
      const { day } = summary(0, [], amounts);
      const option = growthOptions(day, CLIENT, BUSINESS)[1]!;
      const tight = tightestRoom(day.rooms);
      expect(option.title).toBe(title);
      expect(option.growth).toEqual({ kind: 'room', room });
      expect(option.gain.join(' ')).toContain(`${tight.space.pct}% full tomorrow`);
      expect(option.gain.join(' ')).toContain(tight.space.spoils > 0 ? `${tight.space.spoils} unit` : 'nothing will spoil');
    }
  });

  it('says how many units will spoil when the room is over full', () => {
    const { day } = summary(0, [], { chips: 999 });
    const tight = tightestRoom(day.rooms);
    expect(tight.space.spoils).toBeGreaterThan(0);
    expect(growthOptions(day, CLIENT, BUSINESS)[1]!.gain.join(' ')).toContain(`${tight.space.spoils} units will spoil`);
  });

  it('tells the truth about the trucks: how full they were, how many stayed in the yard, and what a truck is', () => {
    const { day } = summary(0, ['Café Lumen']);
    const fleet = fleetOf(day);
    expect(fleet.trucks).toBe(2);
    expect(fleet.out + fleet.yard).toBe(2);
    const load = day.trucks.reduce((n, t) => n + t.load, 0);
    expect(fleet.use).toBe(Math.round((load * 100) / fleet.space));
    const gain = growthOptions(day, CLIENT, BUSINESS)[0]!.gain.join(' ');
    expect(gain).toContain(`today they were ${fleet.use}% full`);
    expect(gain).toContain('box van with room for 380');
    expect(gain).not.toContain('More deliveries can go out on time');
    expect(gain).toContain(`will cost ${formatMoney(truckPrice(BUSINESS.clients.length, BUSINESS.trucks.length + 1))}`);
  });

  it('counts a truck that never left the yard, and says so', () => {
    const { day } = summary(0, ['Café Lumen']);
    const idle = { ...day, trucks: day.trucks.map((t, i) => (i === 1 ? { ...t, backAt: null, load: 0, squares: 0, cost: 0 } : t)) };
    expect(fleetOf(idle)).toMatchObject({ trucks: 2, out: 1, yard: 1 });
    expect(growthOptions(idle, CLIENT, BUSINESS)[0]!.gain.join(' ')).toContain('1 stayed in the yard');
    expect(growthOptions(day, CLIENT, BUSINESS)[0]!.gain.join(' ')).not.toContain('stayed in the yard');
  });

  it('offers the restaurant it is given, with its square, contact and what it is like', () => {
    const { day } = summary(0);
    const option = growthOptions(day, CLIENT, BUSINESS)[2]!;
    expect(option.growth).toEqual({ kind: 'client', client: CLIENT });
    expect(option.title).toBe('A new client: The Salt Cellar');
    const text = option.gain.join(' ');
    expect(text).toContain('Ordinary orders, Saltmarket: at the depot');
    expect(text).toContain('Contact Ines');
  });

  it('shows the shape of a big client far away, one that is always early, and one that is heavy on a room', () => {
    const { day } = summary(0);
    const big: NewClient = { name: 'Rushmere Grill', place: 'rushmere', contact: 'Callum', shape: { size: 2, before: 9 * 60 } };
    expect(growthOptions(day, big, BUSINESS)[2]!.gain.join(' ')).toContain('Big orders, Rushmere: far from the depot; always before 09:00');
    const heavy: NewClient = { name: 'Fenwick Deli', place: 'fenwick', contact: 'Alf', shape: { size: 1, heavy: 'freezer' } };
    expect(growthOptions(day, heavy, BUSINESS)[2]!.gain.join(' ')).toContain('Ordinary orders, Fenwick: close to the depot; mostly freezer stock');
    const small: NewClient = { name: 'The Bell', place: 'docks', contact: 'Ivor', shape: { size: 0.5 } };
    expect(growthOptions(day, small, BUSINESS)[2]!.gain.join(' ')).toContain('Small orders, Docks: close to the depot');
  });

  it('says what a big client brings and what the road to it costs', () => {
    const { day } = summary(0);
    const far: NewClient = { name: 'Rushmere Grill', place: 'rushmere', contact: 'Callum', shape: { size: 2 } };
    const near: NewClient = { name: 'Hollin Deli', place: 'hollin', contact: 'Maud', shape: { size: 0.5 } };
    expect(growthOptions(day, far, BUSINESS)[2]!.gain.join(' ')).toContain('up to £48 on the road');
    expect(growthOptions(day, near, BUSINESS)[2]!.gain.join(' ')).toContain('up to £24 on the road');
    expect(growthOptions(day, CLIENT, BUSINESS)[2]!.gain.join(' ')).not.toContain('on the road');
  });
});

describe('choosing what to grow', () => {
  it('starts with nothing chosen, and SPACE on the day opens the choice', () => {
    const { app, press } = toDay();
    expect(app.growth).toBeNull();
    expect(app.growthOpen).toBe(false);
    press('Enter');
    expect(app.growthOpen).toBe(false);
    press(' ');
    expect(app.growthOpen).toBe(true);
    expect(app.screen).toBe('day');
    expect(app.growthSel).toBe(0);
    expect(app.growth).toBeNull();
  });

  it('moves with ↑↓ and 1-3 and stays within the three', () => {
    const { app, press } = toDay();
    press(' ', 'ArrowDown', 'ArrowDown', 'ArrowDown');
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

  it('records the choice as plain state when ENTER confirms, and the arrows and numbers leave it alone', () => {
    const { app, press } = toDay(0, 'small', ['9', '9', '9'], [], undefined, undefined, 99999);
    press(' ', '2', 'Enter');
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
    truck.press(' ', '1', 'Enter');
    expect(truck.app.growth).toEqual({ kind: 'truck' });
    const client = toDay();
    client.press(' ', 'ArrowDown', 'ArrowDown', 'Enter');
    const option = client.app.growthOptions[2]!;
    expect(client.app.growth).toEqual(option.growth);
    expect(client.app.growth?.kind).toBe('client');
  });

  it('does not touch today: the result, the order and the day are as they were', () => {
    const { app, press } = toDay();
    const before = JSON.stringify([app.result, app.day, app.supply?.ordered(), app.desk.clock]);
    press(' ', '3', 'Enter');
    expect(JSON.stringify([app.result, app.day, app.supply?.ordered(), app.desk.clock])).toBe(before);
    expect(app.morning.orders.map((o) => o.client)).not.toContain((app.growth as { client: { name: string } }).client.name);
  });

  it('goes back to the day with ESC and opens again on the choice that was made', () => {
    const { app, press } = toDay();
    press(' ', '2', 'Escape');
    expect(app.growthOpen).toBe(false);
    expect(app.growth).toBeNull();
    press(' ', 'Enter', 'Escape', ' ');
    expect(app.growth).not.toBeNull();
    expect(app.growthSel).toBe(1);
  });

  it('plays the sounds: a click to move, a finishing knock to choose, nothing for a key that changes nothing', () => {
    const cues: string[] = [];
    const { app, press } = toDay(0, 'small', ['a'], cues);
    cues.length = 0;
    press(' ', 'ArrowDown', 'ArrowUp', 'ArrowUp', 'Enter');
    expect(cues).toEqual(['confirm', 'move', 'move', 'finish']);
    cues.length = 0;
    press('ArrowDown', 'x');
    expect(cues).toEqual([]);
    press('Escape');
    expect(cues).toEqual(['confirm']);
    expect(app.growthOpen).toBe(false);
    cues.length = 0;
    press(' ');
    hold(app, ' ');
    expect(cues).toEqual(['confirm', 'confirm']);
    expect(app.screen).toBe('messages');
  });

  it.each(['r', 'R'])('%s plays the morning again and forgets the choice', (key) => {
    const { app, press } = toDay();
    press(' ', '2', 'Enter');
    expect(app.growth).not.toBeNull();
    hold(app, key);
    expect(app.screen).toBe('messages');
    expect(app.morning.id).toBe('small');
    expect([app.growth, app.growthOpen, app.growthSel]).toEqual([null, false, 0]);
  });

  it.each([['b', 'big'], ['s', 'small']] as const)('%s loads the %s morning and forgets the choice', (key, id) => {
    const { app, press } = toDay(0, id === 'big' ? 'small' : 'big');
    press(' ', '3', 'Enter');
    expect(app.growth?.kind).toBe('client');
    hold(app, key);
    expect(app.screen).toBe('messages');
    expect(app.morning.id).toBe(id);
    expect([app.growth, app.growthOpen, app.growthSel]).toEqual([null, false, 0]);
  });

  it('forgets a choice when the same morning is played to the end of the day again', () => {
    const first = toDay();
    first.press(' ', '1', 'Enter');
    expect(first.app.growth).toEqual({ kind: 'truck' });
    const again = toDay();
    expect(again.app.growth).toBeNull();
    expect(again.app.growthOpen).toBe(false);
  });
});

describe('changing the choice before the next morning', () => {
  it.each(['u', 'U', 'Backspace'])('%s takes a confirmed choice back to the three options with nothing chosen', (key) => {
    const { app, press } = toDay();
    press(' ', '2', 'Enter');
    expect(app.growth).not.toBeNull();
    press(key);
    expect(app.growth).toBeNull();
    expect(app.growthOpen).toBe(true);
    expect(app.screen).toBe('day');
    expect(screen(app).join('\n')).toContain('WHAT TO GROW');
  });

  it('lets a different option, or the same one, be confirmed after taking it back', () => {
    const { app, press } = toDay();
    press(' ', '1', 'Enter', 'u', '3', 'Enter');
    expect(app.growth?.kind).toBe('client');
    press('Backspace', 'Enter');
    expect(app.growth?.kind).toBe('client');
    press('u', '1', 'Enter');
    expect(app.growth).toEqual({ kind: 'truck' });
  });

  it('does nothing when nothing is chosen yet, and the key bar offers it only once chosen', () => {
    const cues: string[] = [];
    const { app, press } = toDay(0, 'small', ['a'], cues);
    press(' ');
    cues.length = 0;
    press('u', 'Backspace');
    expect(cues).toEqual([]);
    expect(screen(app).join('\n')).not.toContain('change choice');
    press('Enter');
    expect(screen(app).join('\n')).toContain('U change');
    press('u');
    expect(cues).toEqual(['finish', 'confirm']);
  });

  it('puts the last choice to work when the next morning starts', () => {
    const { app, press } = toDay();
    const trucks = app.morning.trucks.length;
    press(' ', '2', 'Enter', 'u', '1', 'Enter');
    hold(app, ' ');
    expect(app.screen).toBe('messages');
    expect(app.run.day).toBe(2);
    expect(app.morning.trucks.length).toBe(trucks + 1);
  });

  it('keeps the same new client across taking back and choosing again', () => {
    const { app, press } = toDay(0, 'small', ['a'], [], sequence(0.3, 0.9));
    const before = (app.growthOptions[2]!.growth as { client: NewClient }).client;
    press(' ', '3', 'Enter', 'u', '1', 'Enter', 'u', '3', 'Enter');
    expect(app.growth).toEqual({ kind: 'client', client: before });
    expect(app.growthOptions[2]!.growth).toEqual({ kind: 'client', client: before });
  });
});

describe('the new client in the game', () => {
  const offered = (app: { growthOptions: Array<{ growth: { kind: string } }> }) => app.growthOptions[2]!.growth as { kind: 'client'; client: NewClient };

  it('is made up with the random source the app was given, and is not one of the morning\'s clients', () => {
    const first = toDay(0, 'small', ['a'], [], () => 0).app;
    const last = toDay(0, 'small', ['a'], [], () => 0.999).app;
    expect(offered(first).client).toEqual(newClientFor(clientsOf(first.morning), randomFrom(0)));
    expect(offered(last).client).toEqual(newClientFor(clientsOf(last.morning), randomFrom(0.999)));
    expect(offered(first).client).not.toEqual(offered(last).client);
    for (const app of [first, last]) expect(clientsOf(app.morning)).not.toContain(offered(app).client.name);
  });

  it('stays the same while the day is on show, and is what a choice of it records', () => {
    const random = sequence(0.3, 0.9);
    const { app, press } = toDay(0, 'small', ['a'], [], random);
    const before = offered(app).client;
    press(' ', 'Escape', ' ', 'ArrowDown', 'ArrowUp', 'ArrowDown', 'ArrowDown');
    expect(offered(app).client).toEqual(before);
    expect(screen(app).join('\n')).toContain(`A new client: ${before.name}`);
    press('Enter');
    expect(app.growth).toEqual({ kind: 'client', client: before });
  });

  it('is forgotten by R, and the next game makes up its own', () => {
    const { app } = toDay(0, 'small', ['a'], [], () => 0);
    const before = offered(app).client;
    hold(app, 'r');
    expect(app.growthOptions).toEqual([]);
    const again = toDay(0, 'small', ['a'], [], sequence(0.999)).app;
    expect(offered(again).client).not.toEqual(before);
  });

  it('draws no random number for anything else in the game: the new client and the next day only', () => {
    let draws = 0;
    toDay(0, 'big', ['a'], [], () => (draws++, 0));
    expect(draws).toBe(2);
  });
});

describe('the growth screen', () => {
  it('shows the three options and what today showed, 120 columns by 30 rows', () => {
    const { app, press } = toDay(0, 'small', ['9', '9', '9'], [], undefined, undefined, 99999);
    press(' ');
    const text = screen(app).join('\n');
    expect(text).toContain('END OF THE DAY');
    expect(text).toContain('18:00');
    expect(text).toContain('WHAT TO GROW');
    const flat = text.replace(/\s+/g, ' ');
    for (const o of app.growthOptions) {
      expect(text).toContain(o.title);
      for (const g of o.gain) expect(flat).toContain(g);
      expect(text).toContain(o.work);
    }
    const fleet = fleetOf(app.day!);
    expect(text).toContain('WHAT TODAY SHOWED');
    expect(text).toContain(`${fleet.out} of ${fleet.trucks} trucks went out and none stayed in the yard; together they were ${fleet.use}% full.`);
    expect(text).toMatch(/Rooms tomorrow: freezer \d+%.*fridge \d+%.*dry store \d+% full\./);
    expect(text).toContain('It takes effect tomorrow');
    expect(text).not.toContain('…');
    expect(text).toContain('The bank holds');
    for (const o of app.growthOptions) expect(text).toContain(o.price > 0 ? formatMoney(o.price) : 'free');
  });

  it('keeps every line on the screen for a business of dozens of trucks and clients, chosen or not', () => {
    const { app, press } = toDay(0, 'big', ['9', '9', '9'], [], undefined, undefined, 99999);
    const model = app.run.trucks[0]!;
    for (let id = 10; id <= 40; id++) app.run.trucks.push({ ...model, id, driver: `Driver ${id}` });
    for (let n = 0; n < 60; n++) app.run.clients.push({ name: `Client ${n}`, place: 'docks', contact: 'X' });
    press(' ');
    expect(screen(app).join('\n')).toContain('Rooms tomorrow');
    expect(screen(app).join('\n')).toContain(formatMoney(truckPrice(app.run.clients.length, app.run.trucks.length + 1)));
    press('3', 'Enter');
    expect(screen(app).join('\n')).toContain('Rooms tomorrow');
  });

  it('highlights the picked option and moves the highlight with the keys', () => {
    const { app, press } = toDay();
    press(' ');
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
    press(' ');
    const pending = screen(app);
    for (const word of ['pick one', 'choose it', 'back', 'hold: replay', 'hold: big', 'colours', 'sound']) expect(pending[ROWS - 1]).toContain(word);
    press('3', 'Enter');
    const lines = screen(app);
    const text = lines.join('\n');
    expect(text).toContain('YOU CHOSE');
    expect(text).not.toContain('WHAT TO GROW');
    expect(text).toContain(app.growthOptions[2]!.title);
    expect(text).toContain('chosen');
    expect(text).toContain('It takes effect tomorrow');
    expect(lines[ROWS - 1]).toContain('hold: next morning');
    expect(lines[ROWS - 1]).toContain('back');
    expect(lines[ROWS - 1]).not.toContain('choose it');
    expect(lines[ROWS - 1]).not.toContain('1-3');
  });

  it('fits 120 columns in both colour schemes, before and after choosing', () => {
    const { app, press } = toDay(0, 'big');
    press(' ');
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
    press('ArrowDown', ' ', 'Escape');
    expect(app.daySel).toBe(1);
    expect(screen(app).join('\n')).toContain('HOW THE DAY WENT');
    expect(screen(app).join('\n')).toContain(app.day!.orders[1]!.client.toUpperCase());
  });
});
