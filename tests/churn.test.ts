import { describe, expect, it } from 'vitest';
import { AWAY_FROM, AWAY_TO, isBack, isWarned, noticeNotes, SECOND_WITHIN, settle, WARY_SCALE, type Standings } from '../src/game/churn';
import { usualWithout } from '../src/game/clients';
import { generateDay } from '../src/game/generate';
import { loadMorning, smallMorning } from '../src/game/morning';
import type { Mood } from '../src/game/moods';
import { mulberry32 } from '../src/game/random';
import { nextDay, runFromMorning, type DayOutcome, type RunState } from '../src/game/run';
import { decodeRun, encodeRun, SAVE_VERSION } from '../src/game/save';
import { App, RUN_KEY } from '../src/ui/app';
import { HELP_PAGES } from '../src/ui/help';
import { memoryStore } from '../src/ui/store';
import { fakeEffects, hold, screen } from './helpers';

const ROSA = "Rosa's";
const HOSPITAL = "St Jude's Hospital";
const names = (run: RunState) => run.clients.map((c) => c.name);

/** A day's end with every client pleased except those named, which get `mood`; the next morning's run, made from `seed`. */
function endDay(run: RunState, bad: readonly string[], seed: number, mood: Mood = 'let down'): RunState {
  const moods: Record<string, Mood> = {};
  for (const c of run.clients) {
    if ((run.standing[c.name]?.away ?? 0) === 0) moods[c.name] = bad.includes(c.name) ? mood : 'pleased';
  }
  const outcome: DayOutcome = { left: {}, ordered: {}, moods, today: {}, promises: [], growth: null, earned: 0 };
  return nextDay(run, outcome, seed);
}

/** The big run's clients: a run of the big morning, taken to day 2 with everyone pleased. */
function bigRun(): RunState {
  return endDay(runFromMorning(loadMorning('big')), [], 1);
}

/** Lets `client` down on each of `days` days in a row, from `run`, with a different seed each day. */
function letDownFor(run: RunState, client: string, days: number, mood: Mood = 'let down'): RunState {
  let now = run;
  for (let d = 0; d < days; d++) now = endDay(now, [client], 100 + d, mood);
  return now;
}

describe('the standing of a client', () => {
  const clients = [
    { name: 'A', place: 'docks' as const, contact: 'Ann' },
    { name: 'B', place: 'docks' as const, contact: 'Bo' },
  ];

  it('counts days let down or a bit let down in a row, and a pleased day starts the count again', () => {
    let standing: Standings = {};
    for (const mood of ['let down', 'a bit let down'] as const) standing = settle(clients, standing, { A: mood, B: 'pleased' }, 1).standing;
    expect(standing.A).toMatchObject({ streak: 2, away: 0 });
    expect(standing.B).toBeUndefined();
    expect(isWarned(standing, 'A')).toBe(true);
    expect(isWarned(standing, 'B')).toBe(false);
    standing = settle(clients, standing, { A: 'pleased', B: 'pleased' }, 3).standing;
    expect(standing.A).toBeUndefined();
  });

  it('does not count a day on which the client sent no order, so a closed day is not a day let down', () => {
    let standing: Standings = {};
    standing = settle(clients, standing, { A: 'let down', B: 'pleased' }, 1).standing;
    standing = settle(clients, standing, { B: 'pleased' }, 2).standing;
    expect(standing.A).toMatchObject({ streak: 1, away: 0 });
    standing = settle(clients, standing, { A: 'let down', B: 'pleased' }, 3).standing;
    expect(standing.A).toMatchObject({ streak: 2 });
  });

  it('takes a break after the third day, of two or three mornings, drawn from the seed', () => {
    const lengths = new Set<number>();
    for (let seed = 0; seed < 40; seed++) {
      let standing: Standings = {};
      let news: ReturnType<typeof settle>['news'] = [];
      for (let day = 1; day <= 3; day++) {
        const settled = settle(clients, standing, { A: 'a bit let down', B: 'pleased' }, day, seed);
        standing = settled.standing;
        news = settled.news;
        expect(news).toHaveLength(day < 3 ? 0 : 1);
      }
      expect(news[0]).toMatchObject({ client: 'A', kind: 'break' });
      lengths.add(standing.A!.away);
      expect(standing.A).toMatchObject({ streak: 0, lastBreak: 3 });
    }
    expect([...lengths].sort()).toEqual(Array.from({ length: AWAY_TO - AWAY_FROM + 1 }, (_, i) => AWAY_FROM + i));
  });

  it('draws the same break for the same seed', () => {
    const go = () => {
      let standing: Standings = {};
      for (let day = 1; day <= 3; day++) standing = settle(clients, standing, { A: 'let down', B: 'pleased' }, day, 77).standing;
      return standing;
    };
    expect(go()).toEqual(go());
  });

  it('counts the break down, and brings the client back on the morning after the last one', () => {
    let standing: Standings = { A: { streak: 0, away: 2, lastBreak: 3 } };
    standing = settle(clients, standing, { B: 'pleased' }, 4).standing;
    expect(standing.A).toMatchObject({ away: 1 });
    standing = settle(clients, standing, { B: 'pleased' }, 5).standing;
    expect(standing.A).toMatchObject({ away: 0, back: true });
    expect(isBack(standing, 'A')).toBe(true);
    standing = settle(clients, standing, { A: 'pleased', B: 'pleased' }, 6).standing;
    expect(isBack(standing, 'A')).toBe(false);
  });

  it('never loses the last client still ordering', () => {
    let standing: Standings = { B: { streak: 0, away: 3, lastBreak: 5 } };
    const settled = settle(clients, standing, { A: 'let down' }, 6);
    standing = { ...settled.standing, A: { streak: 2, away: 0 } };
    const next = settle(clients, standing, { A: 'let down' }, 7);
    expect(next.news).toEqual([]);
    expect(next.gone).toEqual([]);
    expect(isWarned(next.standing, 'A')).toBe(true);
  });
});

describe('a client let down three days running', () => {
  it('has no break on the first morning, nor the second, nor the third', () => {
    for (const id of ['small', 'big'] as const) {
      const first = runFromMorning(loadMorning(id));
      expect(first.standing).toEqual({});
      expect(loadMorning(id).messages.some((m) => m.kind === 'client')).toBe(false);
    }
    let run = runFromMorning(smallMorning());
    for (let day = 1; day <= 2; day++) {
      run = endDay(run, [ROSA], 10 + day);
      expect(run.news).toEqual([]);
      expect(Object.values(run.standing).every((s) => s.away === 0)).toBe(true);
    }
    expect(run.day).toBe(3);
  });

  it('is warned two days running, and sends no orders for a few days after the third', () => {
    let run = runFromMorning(smallMorning());
    run = letDownFor(run, ROSA, 2);
    expect(isWarned(run.standing, ROSA)).toBe(true);
    expect(generateDay(run, mulberry32(5)).orders.some((o) => o.client === ROSA)).toBe(true);
    run = endDay(run, [ROSA], 7);
    expect(run.news).toMatchObject([{ client: ROSA, kind: 'break' }]);
    const away = run.standing[ROSA]!.away;
    expect(away).toBeGreaterThanOrEqual(AWAY_FROM);
    expect(away).toBeLessThanOrEqual(AWAY_TO);
    for (let morning = 0; morning < away; morning++) {
      expect(generateDay(run, mulberry32(20 + morning)).orders.some((o) => o.client === ROSA)).toBe(false);
      expect(names(run)).toContain(ROSA);
      run = endDay(run, [], 30 + morning);
    }
    expect(isBack(run.standing, ROSA)).toBe(true);
    expect(generateDay(run, mulberry32(50)).orders.some((o) => o.client === ROSA)).toBe(true);
  });

  it('says so politely overnight, in a note from the client, on the first morning of the break only', () => {
    const run = letDownFor(runFromMorning(smallMorning()), ROSA, 3);
    const day = generateDay(run, mulberry32(5));
    const note = day.messages.find((m) => m.kind === 'client');
    if (note?.kind !== 'client') throw new Error('no note');
    expect(note.from).toBe(ROSA);
    expect(note.text).toMatch(/another supplier for a few days/);
    expect(note.at).toBeGreaterThanOrEqual(24 * 60 + 2 * 60);
    expect(note.at).toBeLessThanOrEqual(24 * 60 + 5 * 60);
    const second = endDay(run, [], 8);
    expect(generateDay(second, mulberry32(6)).messages.some((m) => m.kind === 'client')).toBe(false);
  });

  it('leaves the other orders, and everything else chance decides, as they were', () => {
    const run = letDownFor(runFromMorning(smallMorning()), ROSA, 3);
    const away = generateDay(run, mulberry32(5));
    const here = generateDay({ ...run, standing: {}, news: [] }, mulberry32(5));
    const others = (m: typeof away) => m.orders.filter((o) => o.client !== ROSA).map(({ id: _id, leftAt: _left, ...rest }) => rest);
    expect(others(away)).toEqual(others(here));
    expect(away.garage).toEqual(here.garage);
    expect(away.rush?.item).toEqual(here.rush?.item);
    expect(away.callKinds).toEqual(here.callKinds);
    expect(away.orders).toHaveLength(here.orders.length - 1);
  });

  it('comes back with a note, a little wary: the order is smaller for that one day', () => {
    let run = letDownFor(runFromMorning(smallMorning()), ROSA, 3);
    while (!isBack(run.standing, ROSA)) run = endDay(run, [], 40 + run.day);
    const day = generateDay(run, mulberry32(9));
    const order = day.orders.find((o) => o.client === ROSA)!;
    expect(order.note).toMatch(/We are back/);
    const calm = generateDay({ ...run, standing: {} }, mulberry32(9)).orders.find((o) => o.client === ROSA)!;
    const asked = (o: typeof order) => o.lines.reduce((sum, l) => sum + l.asked, 0);
    expect(asked(order)).toBeLessThan(asked(calm));
    expect(asked(order)).toBeGreaterThan(asked(calm) * (WARY_SCALE - 0.2));
    expect(calm.note ?? '').not.toMatch(/We are back/);
    const after = endDay(run, [], 3);
    expect(isBack(after.standing, ROSA)).toBe(false);
    const next = generateDay(after, mulberry32(10)).orders.find((o) => o.client === ROSA)!;
    expect(next.note ?? '').not.toMatch(/We are back/);
  });

  it('starts again clean: what the client went short of before the break is forgotten', () => {
    const run = letDownFor(runFromMorning(smallMorning()), ROSA, 3);
    expect(run.history[ROSA]).toBeUndefined();
    expect(run.moods[ROSA]).toBeUndefined();
  });

  it('is gone for good on a second break within a short time, with a short kind farewell, and the offer can fill the gap later', () => {
    let run = letDownFor(runFromMorning(smallMorning()), ROSA, 3);
    const first = run.day - 1;
    while (!isBack(run.standing, ROSA)) run = endDay(run, [], 40 + run.day);
    const before = { clients: names(run).length, usual: { ...run.usual } };
    run = letDownFor(run, ROSA, 3);
    expect(run.day - 1 - first).toBeLessThan(SECOND_WITHIN);
    expect(run.news).toMatchObject([{ client: ROSA, kind: 'gone' }]);
    expect(names(run)).not.toContain(ROSA);
    expect(run.lost).toEqual([ROSA]);
    expect(run.standing[ROSA]).toBeUndefined();
    expect(names(run)).toHaveLength(before.clients - 1);
    expect(Object.keys(run.usual).every((item) => run.usual[item]! <= before.usual[item]!)).toBe(true);
    expect(Object.keys(run.usual).some((item) => run.usual[item]! < before.usual[item]!)).toBe(true);
    const day = generateDay(run, mulberry32(3));
    expect(day.orders.some((o) => o.client === ROSA)).toBe(false);
    const note = day.messages.find((m) => m.kind === 'client');
    if (note?.kind !== 'client') throw new Error('no note');
    expect(note.text).toMatch(/will not be ordering again/);
    expect(note.text.length).toBeLessThan(140);
  });

  it('takes a second break long after the first as a first one', () => {
    let run = letDownFor(runFromMorning(smallMorning()), ROSA, 3);
    while (!isBack(run.standing, ROSA)) run = endDay(run, [], 40 + run.day);
    for (let d = 0; d < SECOND_WITHIN; d++) run = endDay(run, [], 60 + d);
    run = letDownFor(run, ROSA, 3);
    expect(run.news).toMatchObject([{ client: ROSA, kind: 'break' }]);
    expect(names(run)).toContain(ROSA);
  });

  it('never makes the hospital or a school go for good: a second break is a plainer note', () => {
    let run = bigRun();
    run = letDownFor(run, HOSPITAL, 3);
    while (!isBack(run.standing, HOSPITAL)) run = endDay(run, [], 40 + run.day);
    run = letDownFor(run, HOSPITAL, 3);
    expect(run.news).toMatchObject([{ client: HOSPITAL, kind: 'break', plain: true }]);
    expect(names(run)).toContain(HOSPITAL);
    expect(run.lost).toEqual([]);
    const note = noticeNotes(run.news)[0]!;
    expect(note.text).toMatch(/second time we have been let down/);
    expect(generateDay(run, mulberry32(4)).orders.some((o) => o.client === HOSPITAL)).toBe(false);
  });

  it('never loses the last client: with one client left ordering, they stay', () => {
    let run = runFromMorning(smallMorning());
    run = { ...run, clients: run.clients.slice(0, 2) };
    const [a, b] = names(run) as [string, string];
    for (let d = 0; d < 12; d++) {
      run = endDay(run, [a, b], 200 + d);
      expect(run.clients.length).toBeGreaterThanOrEqual(1);
      expect(run.clients.some((c) => (run.standing[c.name]?.away ?? 0) === 0)).toBe(true);
      expect(generateDay(run, mulberry32(d)).orders.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('still has an order when the only client left ordering is closed that day', () => {
    let run = runFromMorning(smallMorning());
    const [only] = names(run) as [string];
    run = endDay(run, [], 1);
    const standing: Standings = Object.fromEntries(names(run).filter((n) => n !== only).map((n) => [n, { streak: 0, away: 2 }]));
    const day = generateDay({ ...run, standing, ahead: [{ client: only, event: 'closed' }] }, mulberry32(4));
    expect(day.orders.map((o) => o.client)).toEqual([only]);
  });

  it('plays the same morning again for the same seed, break and all', () => {
    const run = letDownFor(runFromMorning(smallMorning()), ROSA, 3);
    expect(generateDay(run, mulberry32(99))).toEqual(generateDay(run, mulberry32(99)));
  });
});

describe('what the clients who go for good take with them', () => {
  it('takes their share off the usual amounts, and leaves them alone when nothing is shared', () => {
    const clients = [{}, {}, {}, {}];
    const usual = { chips: 50, pork: 100 };
    const less = usualWithout(usual, clients, {});
    expect(less.chips).toBeLessThan(50);
    expect(less.pork).toBeLessThan(100);
    expect(usualWithout(usual, [], {})).toEqual(usual);
  });

  it('takes each of two clients who go on the same day off against the clients still there', () => {
    const run = bigRun();
    const [a, b] = run.clients.filter((c) => c.name !== HOSPITAL && !/School/.test(c.name));
    if (!a || !b) throw new Error('two clients wanted');
    const standing = { [a.name]: { streak: 2, away: 0, lastBreak: run.day - 1 }, [b.name]: { streak: 2, away: 0, lastBreak: run.day - 1 } };
    const next = endDay({ ...run, standing }, [a.name, b.name], 9);
    expect(next.lost).toEqual([a.name, b.name]);
    const rest = run.clients.filter((c) => c !== a);
    expect(next.usual).toEqual(usualWithout(usualWithout(run.usual, run.clients, a), rest, b));
  });
});

describe('on the screens', () => {
  /** An app resumed on day 4 of a saved run in which Rosa's has been let down two days running. */
  function warnedApp() {
    const store = memoryStore();
    const run = letDownFor(runFromMorning(smallMorning()), ROSA, 2);
    store.write(RUN_KEY, encodeRun(run, 12345));
    const app = new App(fakeEffects([], () => 0.5, store), () => {}, 'small');
    app.press({ key: ' ' });
    return { app, run, store };
  }

  it('marks the client on the overnight messages and says why, with the client named', () => {
    const { app } = warnedApp();
    const index = app.morning.messages.findIndex((m) => m.kind === 'order' && app.desk.order(m.orderId - 1).client === ROSA);
    for (let i = 0; i < index; i++) app.press({ key: 'ArrowDown' });
    const lines = screen(app);
    expect(lines.some((l) => l.includes(ROSA) && l.includes('▼'))).toBe(true);
    expect(lines.some((l) => l.includes("Rosa's: let down two days running; another bad day and they will try someone else."))).toBe(true);
    expect(lines.filter((l) => l.includes('▼'))).toHaveLength(1);
  });

  it('marks the client on the order desk, with a legend and a line below, next to the short markers', () => {
    const { app } = warnedApp();
    app.press({ key: ' ' });
    while (app.pane !== 'orders') app.press({ key: 'Tab' });
    for (let n = 0; n < app.desk.orderCount && app.desk.order(app.orderSel).client !== ROSA; n++) app.press({ key: 'ArrowDown' });
    expect(app.desk.order(app.orderSel).client).toBe(ROSA);
    const lines = screen(app);
    expect(lines.some((l) => l.includes(ROSA) && l.includes('▼'))).toBe(true);
    expect(lines.some((l) => l.includes('▼ let down two days running'))).toBe(true);
    expect(lines.some((l) => l.includes('Let down two days running;'))).toBe(true);
  });

  it('shows no marker for a client in good standing', () => {
    const app = new App(fakeEffects([], () => 0.5, memoryStore()), () => {}, 'small');
    app.press({ key: ' ' });
    expect(screen(app).some((l) => l.includes('▼'))).toBe(false);
  });

  it('keeps the warning and the break through a save mid-run, and R plays the same day again', () => {
    const run = letDownFor(runFromMorning(smallMorning()), ROSA, 3);
    const away = run.standing[ROSA]!.away;
    const store = memoryStore();
    store.write(RUN_KEY, encodeRun(run, 4242));
    const app = new App(fakeEffects([], () => 0.5, store), () => {}, 'small');
    app.press({ key: ' ' });
    expect(app.run.standing[ROSA]!.away).toBe(away);
    expect(app.morning.orders.some((o) => o.client === ROSA)).toBe(false);
    expect(app.morning.messages.some((m) => m.kind === 'client' && m.from === ROSA)).toBe(true);
    const day = app.morning;
    app.press({ key: ' ' });
    app.restartDay();
    expect(app.morning).toEqual(day);
    const again = new App(fakeEffects([], () => 0.5, store), () => {}, 'small');
    again.press({ key: ' ' });
    expect(again.morning).toEqual(day);
  });

  it('plays on after a client has gone: the order desk and the messages still show every screen at full width', () => {
    let run = letDownFor(runFromMorning(smallMorning()), ROSA, 3);
    while (!isBack(run.standing, ROSA)) run = endDay(run, [], 40 + run.day);
    run = letDownFor(run, ROSA, 3);
    const store = memoryStore();
    store.write(RUN_KEY, encodeRun(run, 321));
    const app = new App(fakeEffects([], () => 0.5, store), () => {}, 'small');
    app.press({ key: ' ' });
    screen(app);
    app.press({ key: ' ' });
    screen(app);
    hold(app, 'h');
  });
});

describe('how to play', () => {
  it('says what a break is, what the marker means and who never leaves for good', () => {
    const text = HELP_PAGES.flatMap((p) => p.blocks.map((b) => `${b.head ?? ''} ${b.text}`)).join('\n');
    expect(text).toContain('three days running');
    expect(text).toContain('{▼}');
    expect(text).toContain('go for good');
    expect(text).toContain('hospital and the schools');
  });
});

describe('the saved run', () => {
  it('writes the new version and reads it back with the standing, the notices and the lost clients', () => {
    expect(SAVE_VERSION).toBe(6);
    let run = letDownFor(runFromMorning(smallMorning()), ROSA, 3);
    while (!isBack(run.standing, ROSA)) run = endDay(run, [], 40 + run.day);
    run = letDownFor(run, ROSA, 3);
    const back = decodeRun(encodeRun(run, 7))!.run;
    expect(back.lost).toEqual([ROSA]);
    expect(back.news).toEqual(run.news);
    expect(back.standing).toEqual(run.standing);
    const warned = letDownFor(runFromMorning(smallMorning()), 'The Anchor', 2);
    expect(decodeRun(encodeRun(warned, 7))!.run.standing).toEqual(warned.standing);
  });

  it('still reads a run saved before, with every client in good standing', () => {
    const { standing: _s, news: _n, lost: _l, ...old } = { ...runFromMorning(smallMorning()), day: 4 };
    const text = JSON.stringify({ version: 5, daySeed: 9, run: old });
    const saved = decodeRun(text)!;
    expect(saved.run.standing).toEqual({});
    expect(saved.run.news).toEqual([]);
    expect(saved.run.lost).toEqual([]);
    expect(saved.run.day).toBe(4);
  });

  it('does not read a run whose standing is not what it holds, or whose clients are all on a break', () => {
    const run = { ...runFromMorning(smallMorning()), day: 4 };
    const read = (patch: object) => decodeRun(JSON.stringify({ version: 6, daySeed: 9, run: { ...run, ...patch } }));
    expect(read({})).not.toBeNull();
    expect(read({ standing: { [ROSA]: { streak: -1, away: 0 } } })).toBeNull();
    expect(read({ standing: { [ROSA]: { streak: 1, away: 9 } } })).toBeNull();
    expect(read({ news: [{ client: ROSA, contact: 'Rosa', kind: 'left' }] })).toBeNull();
    expect(read({ lost: [3] })).toBeNull();
    const all = Object.fromEntries(run.clients.map((c) => [c.name, { streak: 0, away: 2 }]));
    expect(read({ standing: all })).toBeNull();
  });
});
