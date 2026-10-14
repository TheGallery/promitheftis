import { describe, expect, it } from 'vitest';
import { bigMorning, smallMorning } from '../src/game/morning';
import { growthOptions, NEW_CLIENTS, newClientFor, tightestRoom } from '../src/game/growth';
import { PLACES } from '../src/game/places';
import { plain, ROWS } from '../src/ui/grid';
import { screenLines } from '../src/ui/view';
import { screen, summary, toDay } from './helpers';

const clientsOf = (m: { orders: Array<{ client: string }> }) => m.orders.map((o) => o.client);

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
    const { day, d } = summary(0, [], { chips: 40 });
    const options = growthOptions(day, clientsOf(d.morning));
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
      const { day, d } = summary(0, [], amounts);
      const option = growthOptions(day, clientsOf(d.morning))[1]!;
      expect(option.title).toBe(title);
      expect(option.growth).toEqual({ kind: 'room', room });
      expect(option.gain).toContain(`${tightestRoom(day.rooms).space.pct}% full tomorrow`);
    }
  });

  it('names a plausible new client on a square of the map, who is not a client already', () => {
    const { day, d } = summary(0);
    const taken = clientsOf(d.morning);
    const option = growthOptions(day, taken)[2]!;
    expect(option.growth.kind).toBe('client');
    if (option.growth.kind !== 'client') return;
    const { client } = option.growth;
    expect(taken).not.toContain(client.name);
    expect(PLACES.map((p) => p.id)).toContain(client.place);
    expect(client.contact.length).toBeGreaterThan(0);
    expect(option.title).toBe(`A new client: ${client.name}`);
    expect(option.gain).toContain(client.name);
    expect(option.gain).toMatch(/in [A-Z][a-z]+/);
  });

  it('names the same client for the same day, and never one of either morning\'s clients', () => {
    const small = clientsOf(smallMorning());
    const big = clientsOf(bigMorning());
    expect(newClientFor(small)).toEqual(newClientFor(small));
    for (const name of [...small, ...big]) expect(NEW_CLIENTS.map((c) => c.name)).not.toContain(name);
    expect(new Set(NEW_CLIENTS.map((c) => c.name)).size).toBe(NEW_CLIENTS.length);
    expect(newClientFor(big).name).not.toBe('');
  });

  it('skips a candidate that is a client already', () => {
    const first = NEW_CLIENTS[0]!.name;
    expect(newClientFor([first]).name).not.toBe(first);
    expect(newClientFor(NEW_CLIENTS.map((c) => c.name)).name).not.toBe('');
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
    press('9');
    expect(app.growthSel).toBe(2);
    expect(app.growth).toBeNull();
  });

  it('records the choice as plain state when ENTER confirms, and a second ENTER changes nothing', () => {
    const { app, press } = toDay(0, 'small', ['9', '9', '9']);
    press('Enter', '2', 'Enter');
    expect(app.growth).toEqual({ kind: 'room', room: tightestRoom(app.day!.rooms).kept });
    expect(app.status).toContain('Chosen: A bigger');
    expect(app.status).toContain('tomorrow');
    const chosen = app.growth;
    press('1', 'ArrowUp', 'Enter');
    expect(app.growthSel).toBe(1);
    expect(app.growth).toBe(chosen);
    expect(app.status).toContain('Already chosen');
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
    press('ArrowDown', 'Enter', 'x');
    expect(cues).toEqual([]);
    press('Escape');
    expect(cues).toEqual(['confirm']);
    expect(app.growthOpen).toBe(false);
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
