import { describe, expect, it } from 'vitest';
import { clientDay, HISTORY_DAYS, remember, shortCount, shortMarker, shortNotes, shortYesterday, type ClientDay } from '../src/game/history';
import { generateDay } from '../src/game/generate';
import { mulberry32 } from '../src/game/random';
import { nextDay, outcomeOf, runFromMorning } from '../src/game/run';
import { smallMorning } from '../src/game/morning';
import type { OrderResult } from '../src/game/results';
import { buildDay } from '../src/game/day';
import { moodPoints } from '../src/game/moods';
import { App } from '../src/ui/app';
import { fakeEffects, holdNewRun, playToSupply, screen, summary, toNextMorning } from './helpers';

const full: ClientDay = { percent: 100, late: false, lacked: [] };
const short = (percent: number, ...lacked: Array<[string, number, number]>): ClientDay => ({
  percent,
  late: false,
  lacked: lacked.map(([item, asked, given]) => ({ item, asked, given })),
});
const nameOf = (id: string): string => id;

describe('what is remembered of a day', () => {
  it('takes the share delivered, the lateness and what was short from the order result', () => {
    const order: Pick<OrderResult, 'percent' | 'lateForAsk' | 'shortLines'> = {
      percent: 60,
      lateForAsk: true,
      shortLines: [{ item: 'chips', asked: 5, given: 2 }],
    };
    const day = clientDay(order);
    expect(day).toEqual({ percent: 60, late: true, lacked: [{ item: 'chips', asked: 5, given: 2 }] });
    expect(day.lacked[0]).not.toBe(order.shortLines[0]);
  });

  it('puts the newest day first and keeps two days', () => {
    expect(HISTORY_DAYS).toBe(2);
    const one = remember({}, { A: short(70) });
    expect(one.A).toEqual([short(70)]);
    const two = remember(one, { A: full });
    expect(two.A).toEqual([full, short(70)]);
  });

  it('drops the third day back', () => {
    const history = remember(remember(remember({}, { A: short(10) }), { A: short(20) }), { A: short(30) });
    expect(history.A).toEqual([short(30), short(20)]);
    expect(history.A).toHaveLength(2);
  });

  it('keeps a client that was not in the day as it was, and does not change the history it was given', () => {
    const before = { A: [short(40)], B: [full] };
    const after = remember(before, { A: full });
    expect(after.B).toEqual([full]);
    expect(before.A).toEqual([short(40)]);
    expect(after.A).toEqual([full, short(40)]);
  });
});

describe('the marker', () => {
  it('is empty for a client with no history, or only full deliveries', () => {
    expect(shortMarker(undefined)).toBe('');
    expect(shortMarker([])).toBe('');
    expect(shortMarker([full, full])).toBe('');
  });

  it('is one mark for one short day, whichever of the two days it was', () => {
    expect(shortMarker([short(80), full])).toBe('!');
    expect(shortMarker([full, short(80)])).toBe('!');
    expect(shortCount([short(99), full])).toBe(1);
  });

  it('is two marks for short two days running', () => {
    expect(shortMarker([short(80), short(0)])).toBe('!!');
  });

  it('knows whether the client was short yesterday', () => {
    expect(shortYesterday([short(80), full])).toBe(true);
    expect(shortYesterday([full, short(80)])).toBe(false);
    expect(shortYesterday(undefined)).toBe(false);
  });
});

describe('the detail', () => {
  it('says nothing for a client who has not been short', () => {
    expect(shortNotes([full, full], nameOf)).toEqual([]);
    expect(shortNotes(undefined, nameOf)).toEqual([]);
  });

  it('says which day, how much came and what was short', () => {
    expect(shortNotes([short(60, ['chips', 5, 2], ['peas', 3, 0])], nameOf)).toEqual([
      'Yesterday: got 60%, short of chips (2 of 5), peas (0 of 3).',
    ]);
    expect(shortNotes([full, short(80, ['eggs', 4, 3])], nameOf)).toEqual(['2 days ago: got 80%, short of eggs (3 of 4).']);
  });

  it('says nothing was delivered, and when the truck was late too', () => {
    expect(shortNotes([short(0)], nameOf)).toEqual(['Yesterday: got nothing.']);
    expect(shortNotes([{ ...short(50, ['oil', 2, 1]), late: true }], nameOf)).toEqual(['Yesterday: got 50%, short of oil (1 of 2), and late.']);
  });

  it('names three items and counts the rest', () => {
    const lacked: Array<[string, number, number]> = [['a', 1, 0], ['b', 1, 0], ['c', 1, 0], ['d', 1, 0], ['e', 1, 0]];
    expect(shortNotes([short(0, ...lacked)], nameOf)[0]).toBe('Yesterday: got nothing, short of a (0 of 1), b (0 of 1), c (0 of 1), +2 more.');
  });

  it('leads with a line of its own when short two days running', () => {
    const notes = shortNotes([short(80, ['eggs', 4, 3]), short(50, ['oil', 2, 1])], nameOf);
    expect(notes).toEqual([
      'Short two days running.',
      'Yesterday: got 80%, short of eggs (3 of 4).',
      '2 days ago: got 50%, short of oil (1 of 2).',
    ]);
  });
});

describe('across the days of a run', () => {
  /** A day on the small morning with the clients named getting no truck. */
  function dayWithout(...clients: string[]) {
    const { day, calls, answers, supply } = summary(0, clients);
    return { day, calls, answers, supply };
  }

  it('starts a run with no history', () => {
    expect(runFromMorning(smallMorning()).history).toEqual({});
  });

  it('records each client from the day and carries it to the next', () => {
    const run = runFromMorning(smallMorning());
    const { day, supply, calls, answers } = dayWithout("Rosa's");
    const next = nextDay(run, outcomeOf({}, supply, day, calls, answers, null));
    expect(next.history["Rosa's"]).toEqual([{ percent: 0, late: false, lacked: expect.any(Array) }]);
    expect(next.history["Rosa's"]![0]!.lacked.length).toBeGreaterThan(0);
    expect(shortMarker(next.history["Rosa's"])).toBe('!');
    expect(next.history['Café Lumen']![0]!.percent).toBe(100);
    expect(run.history).toEqual({});
  });

  it('keeps a client for two days and then lets the first go', () => {
    let run = runFromMorning(smallMorning());
    for (const shortClient of ["Rosa's", 'The Anchor', 'Golden Dragon']) {
      const { day, supply, calls, answers } = dayWithout(shortClient);
      run = nextDay(run, outcomeOf({}, supply, day, calls, answers, null));
    }
    expect(run.day).toBe(4);
    expect(run.history["Rosa's"]).toHaveLength(2);
    expect(shortCount(run.history["Rosa's"])).toBe(0);
    expect(shortMarker(run.history['The Anchor'])).toBe('!');
    expect(shortMarker(run.history['Golden Dragon'])).toBe('!');
    expect(shortMarker(run.history['The Plough'])).toBe('!!');
  });

  it('has a new client with no history until it has had a day', () => {
    const run = runFromMorning(smallMorning());
    const { day, supply, calls, answers } = dayWithout();
    const next = nextDay(run, outcomeOf({}, supply, day, calls, answers, { kind: 'client', client: { name: 'Newcomer', place: 'docks', contact: 'Bo' } }));
    expect(next.history.Newcomer).toBeUndefined();
    expect(next.clients.some((c) => c.name === 'Newcomer')).toBe(true);
  });

  it('puts the marker on the right orders of the made-up day', () => {
    const run = runFromMorning(smallMorning());
    const { day, supply, calls, answers } = dayWithout("Rosa's");
    const next = nextDay(run, outcomeOf({}, supply, day, calls, answers, null));
    const morning = generateDay(next, mulberry32(3));
    const marked = morning.orders.filter((o) => shortMarker(next.history[o.client]) !== '').map((o) => o.client);
    expect(marked).toContain("Rosa's");
    expect(marked).not.toContain('Café Lumen');
  });

  it('makes the mood from the history: short again after short yesterday is one point worse', () => {
    const { result, calls, answers, supply } = summary(1, ["Rosa's"]);
    const rosa = (history: Record<string, ClientDay[]>) => buildDay(result, calls, answers, supply, history).orders.find((o) => o.client === "Rosa's")!;
    const first = rosa({});
    const again = rosa({ "Rosa's": [short(70)] });
    expect(moodPoints({ percent: 0, late: false, shortCall: null, shortBefore: true })).toBe(moodPoints({ percent: 0, late: false, shortCall: null }) + 1);
    expect(again.reasons).toContain('was short yesterday as well');
    expect(first.reasons).not.toContain('was short yesterday as well');
    const rank = ['pleased', 'a bit let down', 'let down'];
    expect(rank.indexOf(again.mood)).toBeGreaterThanOrEqual(rank.indexOf(first.mood));
  });
});

/** Moves the order desk's selection to the named client's order. */
function selectOrder(app: App, press: (...keys: string[]) => void, client: string): void {
  for (let i = 0; i < 3 && app.pane !== 'orders'; i++) press('Tab');
  while (app.desk.order(app.orderSel).client !== client) press('ArrowDown');
}

describe('on the screens', () => {
  /** The game on day 2 of the small morning, played from day 1 where two clients went short. */
  const dayTwo = () => toNextMorning('1');

  it('shows nothing on day 1', () => {
    const app = new App(fakeEffects());
    const text = screen(app).join('\n');
    expect(text).not.toMatch(/!/);
    app.press({ key: ' ' });
    expect(screen(app).join('\n')).not.toMatch(/ ! | !! |short yesterday|went short/i);
  });

  it('marks the orders of clients who went short, on the order desk and the messages', () => {
    const { app, press } = dayTwo();
    expect(app.run.day).toBe(2);
    const marked = app.morning.orders.filter((o) => shortMarker(app.run.history[o.client]) !== '').map((o) => o.client);
    expect(marked.sort()).toEqual(['Burger Shack', 'The Plough']);

    const messages = screen(app);
    const rowFor = (name: string) => messages.find((l) => l.includes(name))!;
    expect(rowFor('Burger Shack')).toMatch(/ !$| ! *$/);
    expect(rowFor('The Plough')).toMatch(/!\s*$/);
    expect(rowFor('Rosa')).not.toMatch(/!/);

    press(' ');
    const desk = screen(app);
    const deskRow = (name: string) => desk.find((l) => l.includes(name))!;
    expect(deskRow('Burger Shack')).toMatch(/Burger Shack\s+!\s+\S/);
    expect(deskRow('The Plough')).toMatch(/The Plough\s+!/);
    expect(deskRow("Rosa's")).not.toMatch(/!/);
    expect(desk.join('\n')).toContain('! went short lately');
    expect(desk.join('\n')).toContain('!! short two days running');
  });

  it('shows the day, what was short and how much when a marked order is selected', () => {
    const { app, press } = dayTwo();
    const messageIndex = app.morning.messages.findIndex((m) => m.kind === 'order' && app.desk.order(m.orderId - 1).client === 'Burger Shack');
    for (let i = 0; i < messageIndex; i++) press('ArrowDown');
    expect(screen(app).join('\n')).toMatch(/Yesterday: got 83%, short of frozen chips \(4 of 8\)\./);

    press(' ');
    selectOrder(app, press, 'Burger Shack');
    const lines = screen(app);
    const row = lines.findIndex((l) => l.includes('Yesterday: got 83%'));
    expect(row).toBeGreaterThan(0);
    // The wrapped second line is indented under the first.
    expect(lines[row + 1]).toMatch(/│ {3}\S/);
    expect(`${lines[row]} ${lines[row + 1]}`.replace(/│/g, ' ').replace(/\s+/g, ' ')).toContain('short of frozen chips (4 of 8).');
  });

  it('shows no detail for an order from a client who was not short', () => {
    const { app, press } = dayTwo();
    press(' ');
    expect(screen(app).join('\n')).not.toMatch(/Yesterday:|2 days ago:/);
  });

  it('wraps a long detail onto an indented second line, within 120 columns', () => {
    const { app, press } = dayTwo();
    const history = { ...app.run.history, 'Café Lumen': [short(5, ['chips', 8, 0], ['peas', 8, 0], ['pork', 3, 0]), short(5, ['chips', 8, 0], ['peas', 8, 0], ['pork', 3, 0])] };
    app.run = { ...app.run, history };
    press(' ');
    selectOrder(app, press, 'Café Lumen');
    const lines = screen(app);
    const row = lines.findIndex((l) => l.includes('Yesterday: got 5%'));
    expect(row).toBeGreaterThan(0);
    expect(lines[row + 1]).toMatch(/│ {3}\S/);
    expect(lines.join('\n')).toContain('Short two days running.');
    expect(lines.join('\n')).toContain('!!');
  });

  it('keeps the stock notes on the order desk when a long shortfall detail would not fit', () => {
    const { app, press } = toNextMorning('1', 'big');
    press(' ', 'Tab');
    const stock = app.desk.morning.stock as Record<string, number>;
    for (const item of Object.keys(stock)) stock[item] = 0;
    const notesOf = (lines: string[]) => lines.map((l) => l.split('│')[1] ?? '').filter((l) => /left, |has room for|still to come/.test(l));
    const everyLine = () =>
      app.morning.orders.flatMap((o, i) =>
        o.lines.map((_, l) => {
          app.orderSel = i;
          app.lineSel = l;
          return { lines: screen(app), notes: notesOf(screen(app)) };
        }),
      );
    const before = everyLine().map((v) => v.notes);
    expect(before.flat().length).toBeGreaterThan(0);
    const bad = { ...short(5, ['chips', 8, 0], ['peas', 8, 0], ['pork', 3, 0]), late: true };
    app.run = { ...app.run, history: Object.fromEntries(app.morning.orders.map((o) => [o.client, [bad, bad]])) };
    const after = everyLine();
    expect(after.map((v) => v.notes)).toEqual(before);
    for (const v of after) expect(v.lines.join('\n')).toMatch(/Yesterday: got 5%/);
  });

  it('marks short two days running with two marks after a second short day', () => {
    const { app, press } = dayTwo();
    playToSupply(app, press);
    press('a', 'F9', 'Enter', '1', 'Enter', 'Enter');
    const twice = app.morning.orders.filter((o) => shortCount(app.run.history[o.client]) === 2).map((o) => o.client);
    for (const client of twice) expect(shortMarker(app.run.history[client])).toBe('!!');
    expect(app.run.day).toBe(3);
    for (const history of Object.values(app.run.history)) expect(history.length).toBeLessThanOrEqual(2);
  });

  it('keeps the history R started the day with, and B and S start a fresh run with none', () => {
    const { app, press } = dayTwo();
    const history = JSON.stringify(app.run.history);
    const orders = JSON.stringify(app.morning.orders);
    playToSupply(app, press);
    press('a', 'F9', 'r');
    expect(app.screen).toBe('messages');
    expect(JSON.stringify(app.run.history)).toBe(history);
    expect(JSON.stringify(app.morning.orders)).toBe(orders);
    expect(screen(app).join('\n')).toMatch(/!/);

    holdNewRun(app, 'b');
    expect(app.run.history).toEqual({});
    expect(app.morning.day).toBe(1);
    expect(screen(app).join('\n')).not.toMatch(/ ! | !! /);

    const again = dayTwo();
    holdNewRun(again.app, 's');
    expect(again.app.run.history).toEqual({});
    press('r');
    expect(app.run.history).toEqual({});
  });

  it('plays the big morning to day 2 with the markers in 120 columns, in both colour schemes', () => {
    const { app, press } = toNextMorning('1', 'big');
    expect(Object.keys(app.run.history).length).toBe(38);
    screen(app);
    press('F2');
    screen(app);
    press(' ');
    screen(app);
    press('F2');
    screen(app);
  });

  it('is the same in the day-end view: the mood reasons say short yesterday as well', () => {
    const { app, press } = dayTwo();
    playToSupply(app, press);
    press('a', 'F9');
    const orders = app.day!.orders.filter((o) => shortYesterday(app.run.history[o.client]) && o.percent < 100);
    for (const o of orders) expect(o.reasons.join(' ')).toContain('short yesterday as well');
  });
});
