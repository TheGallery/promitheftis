import { describe, expect, it } from 'vitest';
import { buildCalls } from '../src/game/calls';
import { DEPART_MINUTE } from '../src/game/clock';
import { buildDay } from '../src/game/day';
import { Desk } from '../src/game/desk';
import { plainName } from '../src/game/headsup';
import { smallMorning } from '../src/game/morning';
import { buildResult } from '../src/game/results';
import { buildRoad, ROAD_TICK_MS } from '../src/game/road';
import { stockAfterDeliveries, Supply } from '../src/game/supply';
import { App, type Effects } from '../src/ui/app';
import { COLS, plain, ROWS } from '../src/ui/grid';
import { screenLines } from '../src/ui/view';

const SMALL_TRUCKS: Record<string, number> = {
  'Café Lumen': 1, "Rosa's": 2, 'The Anchor': 2, 'Golden Dragon': 1, 'Hotel Bellevue': 1, 'Burger Shack': 1, 'The Plough': 2,
};

function handOut(d: Desk, client: string, truck: number) {
  const o = d.morning.orders.findIndex((x) => x.client === client);
  d.morning.orders[o]!.lines.forEach((_, l) => d.acceptLine(o, l));
  d.assignTruck(o, truck);
  d.finishOrder(o);
}

/** The small morning with every order handed out, the clients named getting no truck, and every call answered with `answer`. */
function summary(answer: number, leaveOut: string[] = [], amounts: Record<string, number> = { chips: 5, pork: 3 }) {
  const d = new Desk(smallMorning());
  for (const [client, truck] of Object.entries(SMALL_TRUCKS)) {
    if (leaveOut.includes(client)) {
      const o = d.morning.orders.findIndex((x) => x.client === client);
      d.morning.orders[o]!.lines.forEach((_, l) => d.acceptLine(o, l));
    } else handOut(d, client, truck);
  }
  const result = buildResult(d, DEPART_MINUTE);
  const calls = buildCalls(d, result, buildRoad(d, result));
  const answers = new Map(calls.map((c) => [c.id, answer]));
  const supply = new Supply(d.morning, stockAfterDeliveries(d));
  supply.rows.forEach((row, r) => supply.set(r, amounts[row.item.id] ?? 0));
  return { d, result, calls, answers, supply, day: buildDay(result, calls, answers, supply) };
}

describe('how the day went', () => {
  it('has each order with how much of it was delivered, when, and the client mood', () => {
    const { result, day } = summary(0);
    expect(day.orders).toHaveLength(result.orders.length);
    day.orders.forEach((o, i) => {
      expect(o.percent).toBe(result.orders[i]!.percent);
      expect(o.arriveAt).toBe(result.orders[i]!.arriveAt);
      expect(['pleased', 'a bit let down', 'let down']).toContain(o.mood);
      expect(o.reasons.length).toBeGreaterThan(0);
    });
    const plough = day.orders.find((o) => o.client === 'The Plough')!;
    // Ketchup ran short and the last to ask went without some.
    expect(plough.percent).toBeLessThan(100);
    expect(plough.mood).not.toBe('pleased');
  });

  it('lists every truck with when it got back and the clients it reached late', () => {
    const { result, day } = summary(0);
    expect(day.trucks.map((t) => [t.truckId, t.backAt])).toEqual(result.trucks.map((t) => [t.truckId, t.backAt]));
    for (const t of day.trucks) {
      expect(t.lateTo).toEqual(result.orders.filter((o) => o.truckId === t.truckId && o.lateForAsk).map((o) => o.client));
    }
  });

  it('names a truck as late when it reached a client after the time they asked', () => {
    const { d, result, calls, answers, supply } = summary(0);
    const o = result.orders.findIndex((x) => x.truckId === 2);
    const late = { ...result, orders: result.orders.map((x, i) => (i === o ? { ...x, lateForAsk: true } : x)) };
    const day = buildDay(late, calls, answers, supply);
    expect(day.trucks.find((t) => t.truckId === 2)!.lateTo).toEqual([d.order(o).client]);
    expect(day.trucks.find((t) => t.truckId === 1)!.lateTo).toEqual([]);
    expect(day.orders[o]!.reasons).toContain('came after the time asked');
  });

  it('keeps a truck that never left the yard with no back time and nothing late', () => {
    const { day } = summary(0, ['Rosa\'s', 'The Anchor', 'The Plough']);
    const idle = day.trucks.find((t) => t.truckId === 2)!;
    expect(idle.backAt).toBeNull();
    expect(idle.lateTo).toEqual([]);
    const rosa = day.orders.find((o) => o.client === "Rosa's")!;
    expect(rosa.percent).toBe(0);
    expect(rosa.mood).toBe('let down');
    expect(rosa.reasons).toEqual(['got no truck']);
  });
});

describe('the phone calls', () => {
  it('lists who rang and what was answered, with the promises for tomorrow marked', () => {
    const { calls, day } = summary(0);
    expect(day.calls).toHaveLength(calls.length);
    expect(day.calls.map((c) => c.line)).toEqual(calls.map((c) => `${c.client} · ${c.topic} · ${c.options[0]!.record}`));
    expect(day.calls.map((c) => c.promised)).toEqual(calls.map((c) => !!c.options[0]!.addsToOrder));
    expect(day.calls.some((c) => c.promised)).toBe(true);
  });

  it('marks no promise when every call was answered "not today"', () => {
    const { day } = summary(1);
    expect(day.calls.filter((c) => c.line.includes('told not today')).length).toBeGreaterThan(0);
    expect(day.calls.filter((c) => c.line.startsWith('The Plough') && c.promised)).toEqual([]);
    expect(day.calls.some((c) => c.promised)).toBe(false);
  });

  it('leaves out a call that was not answered', () => {
    const { result, calls, supply } = summary(0);
    const day = buildDay(result, calls, new Map([[calls[0]!.id, 0]]), supply);
    expect(day.calls).toHaveLength(1);
  });

  it('lets the answer to a short call move that client\'s mood', () => {
    const promised = summary(0).day;
    const refused = summary(1).day;
    const short = summary(0).calls.find((c) => c.kind === 'short')!;
    const rank = { pleased: 0, 'a bit let down': 1, 'let down': 2 };
    expect(rank[refused.orders[short.orderIndex]!.mood]).toBeGreaterThan(rank[promised.orders[short.orderIndex]!.mood]);
  });
});

describe("tomorrow's order", () => {
  it('lists what was ordered and how many units', () => {
    const { day } = summary(0);
    expect(day.ordered.map((o) => [o.item.id, o.amount])).toEqual([['chips', 5], ['pork', 3]]);
    expect(day.units).toBe(8);
  });

  it('has the three rooms and none over full when the order fits', () => {
    const { day } = summary(0);
    expect(day.rooms.map((r) => r.kept)).toEqual(['freezer', 'fridge', 'dry']);
    expect(day.overFull).toEqual([]);
  });

  it('names a room the order fills past full, and only that room', () => {
    const { day } = summary(0, [], { chips: 999 });
    expect(day.overFull.map((r) => r.kept)).toEqual(['freezer']);
    expect(day.overFull[0]!.space.overPct).toBeGreaterThan(0);
  });
});

function fakeEffects(cues: string[] = []): Effects {
  return {
    cue: (moment) => void cues.push(moment),
    print: () => 100,
    later: (fn, ms) => (ms === ROAD_TICK_MS ? undefined : fn()),
    toggleSound: () => true,
    now: (() => {
      let t = 0;
      return () => (t += 1000);
    })(),
  };
}

/** Plays a morning to the end-of-day screen, answering every call with the given option. */
function toDay(answer = 0, morning: 'small' | 'big' = 'small', typed = ['a'], cues: string[] = []) {
  const app = new App(fakeEffects(cues), () => {}, morning);
  const press = (...keys: string[]) => keys.forEach((key) => app.press({ key }));
  press(' ');
  if (morning === 'small') {
    for (let n = 0; n < 7; n++) {
      const name = app.desk.order(app.orderSel).client;
      const lines = app.desk.order(app.orderSel).lines.length;
      for (let l = 0; l < lines; l++) press('Enter');
      press(...Array(9).fill('ArrowUp'), ...Array((SMALL_TRUCKS[name] as number) - 1).fill('ArrowDown'), 'Enter');
    }
  } else {
    for (let n = 0; n < 38; n++) {
      const o = app.orderSel;
      const lines = app.desk.order(o).lines.length;
      for (let l = 0; l < lines; l++) press('Enter');
      for (let i = 0; i < 9 && !app.desk.isFinished(o); i++) press(...Array(9).fill('ArrowUp'), ...Array((n + i) % 9).fill('ArrowDown'), 'Enter');
    }
  }
  press('F10', 'F9');
  for (let n = 0; n < 30 && !app.roadOver; n++) {
    if (app.roadCall) press(...Array(answer).fill('ArrowDown'), 'Enter');
    else press(' ');
  }
  press('Enter', 'Enter', ...typed, 'F9');
  return { app, press };
}

function screen(app: App): string[] {
  const lines = plain(screenLines(app));
  expect(lines).toHaveLength(ROWS);
  for (const l of lines) expect([...l]).toHaveLength(COLS);
  return lines;
}

describe('the end-of-day screen', () => {
  it('opens when the order is placed, with the four parts of the day', () => {
    const { app } = toDay();
    expect(app.screen).toBe('day');
    const text = screen(app).join('\n');
    expect(text).toContain('END OF THE DAY');
    expect(text).toContain('18:00');
    for (const part of ['HOW THE DAY WENT', 'TRUCKS', 'PHONE CALLS', "TOMORROW'S ORDER"]) expect(text).toContain(part);
    // Every client has a line with how much arrived and a mood.
    for (const o of app.day!.orders) {
      expect(text).toContain(o.client);
      expect(text).toContain(o.mood);
    }
    expect(text).toContain('Order placed for tomorrow');
  });

  it('shows when each truck got back, and the calls with what was promised', () => {
    const { app } = toDay();
    const text = screen(app).join('\n');
    for (const t of app.day!.trucks) expect(text).toContain(`${t.truckId} ${t.driver}`);
    for (const t of app.day!.trucks) if (t.backAt != null) expect(text).toMatch(new RegExp(`back ${String(Math.floor(t.backAt / 60)).padStart(2, '0')}:`));
    const flat = text.split('\n').map((l) => l.split('│')[1] ?? '').join(' ').replace(/\s+/g, ' ');
    for (const c of app.day!.calls) expect(flat).toContain(c.line);
    expect(text).toContain('added');
  });

  it('shows the order and each room, with an amber warning when one is over full', () => {
    const fits = toDay(0, 'small', ['3']).app;
    const text = screen(fits).join('\n');
    for (const room of ['FREEZER', 'FRIDGE', 'DRY STORE']) expect(text).toMatch(new RegExp(`${room} +\\d+% full tomorrow`));
    expect(text).not.toContain('over by');

    const over = toDay(0, 'small', ['9', '9', '9']).app;
    const lines = screen(over);
    expect(lines.filter((l) => l.includes('over by'))).toHaveLength(1);
    const amber = screenLines(over).find((l) => l.some(([t]) => t.includes('over by')))!;
    expect(amber.filter(([t]) => t.includes('over by')).every(([, cls]) => cls === 'w')).toBe(true);
  });

  it('shows the selected client\'s story and moves with the arrow keys', () => {
    const { app, press } = toDay();
    const first = app.day!.orders[0]!;
    expect(screen(app).join('\n')).toContain(first.client.toUpperCase());
    press('ArrowDown');
    expect(app.daySel).toBe(1);
    expect(screen(app).join('\n')).toContain(app.day!.orders[1]!.client.toUpperCase());
    press('ArrowUp', 'ArrowUp');
    expect(app.daySel).toBe(0);
  });

  it('wraps a long line under itself rather than cutting it', () => {
    const { app } = toDay(0, 'big');
    const text = screen(app).join('\n');
    expect(text).not.toContain('…');
  });

  it('keeps everything in the big morning in view, and scrolls through its 38 clients', () => {
    const { app, press } = toDay(0, 'big');
    expect(app.day!.orders).toHaveLength(38);
    const text = screen(app).join('\n');
    for (const part of ['HOW THE DAY WENT', 'TRUCKS', 'PHONE CALLS', "TOMORROW'S ORDER", 'DRY STORE']) expect(text).toContain(part);
    for (const t of app.day!.trucks) expect(text).toContain(`${t.truckId} ${t.driver}`);
    for (const c of app.day!.calls) expect(text.split('\n').map((l) => l.split('│')[1] ?? '').join(' ').replace(/\s+/g, ' ')).toContain(c.line);
    // The whole order is listed, or the screen says how many items it leaves out.
    const flat = text.split('\n').map((l) => l.split('│')[1] ?? '').join(' ').replace(/\s+/g, ' ');
    const missing = app.day!.ordered.filter((o) => !flat.includes(`${o.amount} ${plainName(o.item.name)}`));
    if (missing.length > 0) expect(flat).toContain(`+ ${missing.length} more`);
    for (let i = 0; i < 40; i++) {
      press('ArrowDown');
      const lines = screen(app);
      expect(lines.join('\n')).toContain(app.day!.orders[app.daySel]!.client.toUpperCase());
    }
    expect(app.daySel).toBe(37);
    press('PageUp');
    expect(app.daySel).toBe(27);
    press('PageDown', 'PageDown');
    expect(app.daySel).toBe(37);
  });

  it('fits 120 columns in both colour schemes', () => {
    const { app, press } = toDay();
    screen(app);
    press('F2');
    expect(app.blue).toBe(true);
    screen(app);
    // The theme classes it uses are ones the other screens use.
    const classes = new Set(screenLines(app).flatMap((l) => l.map(([, c]) => c)));
    for (const c of classes) expect(['', 'b', 'd', 'w', 'acc', 'hl', 'w hl', 'acc hl', 'kbar', 'k']).toContain(c);
  });

  it('says nothing about money', () => {
    const { app } = toDay();
    expect(screen(app).join('\n')).not.toMatch(/[$£€]|money|price|cost|profit/i);
  });

  it('has no ESC back to the supplier order once it is placed, and no key it does not use', () => {
    const { app, press } = toDay();
    press('Escape');
    expect(app.screen).toBe('day');
    expect(app.press({ key: 'F9' })).toBe(false);
    expect(app.press({ key: 'Enter' })).toBe(false);
  });

  it('plays the morning again with R and loads either morning with B and S', () => {
    const a = toDay();
    a.press('r');
    expect(a.app.screen).toBe('messages');
    expect(a.app.morning.id).toBe('small');
    expect(a.app.supply).toBeNull();
    expect(a.app.day).toBeNull();
    const b = toDay();
    b.press('b');
    expect(b.app.screen).toBe('messages');
    expect(b.app.morning.id).toBe('big');
    b.press('s');
    expect(b.app.morning.id).toBe('small');
    const c = toDay(0, 'big');
    c.press('R');
    expect(c.app.morning.id).toBe('big');
    expect(c.app.screen).toBe('messages');
    expect(c.app.desk.unfinishedCount()).toBe(38);
  });

  it('lists the keys that work, and only those', () => {
    const { app } = toDay();
    const bar = screen(app)[ROWS - 1]!;
    for (const word of ['look through the clients', 'play again', 'big morning', 'colours', 'sound']) expect(bar).toContain(word);
    expect(bar).not.toContain('ESC');
  });

  it('makes a finishing sound when the order is placed, a soft click for each step and a confirm for R', () => {
    const cues: string[] = [];
    const { app, press } = toDay(0, 'small', ['a'], cues);
    expect(cues.at(-1)).toBe('finish');
    cues.length = 0;
    press('ArrowDown', 'ArrowUp', 'ArrowUp', 'r');
    expect(cues).toEqual(['move', 'move', 'confirm']);
    expect(app.screen).toBe('messages');
  });
});
