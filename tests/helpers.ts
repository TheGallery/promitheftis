import { expect } from 'vitest';
import { buildCalls } from '../src/game/calls';
import { DEPART_MINUTE } from '../src/game/clock';
import { buildDay } from '../src/game/day';
import { Desk } from '../src/game/desk';
import { smallMorning } from '../src/game/morning';
import { buildResult } from '../src/game/results';
import { buildRoad, ROAD_TICK_MS } from '../src/game/road';
import { stockAfterDeliveries, Supply } from '../src/game/supply';
import { App, type Effects } from '../src/ui/app';
import { memoryStore, type Store } from '../src/ui/store';
import { COLS, plain, ROWS } from '../src/ui/grid';
import { screenLines } from '../src/ui/view';

export const SMALL_TRUCKS: Record<string, number> = {
  'Café Lumen': 1, "Rosa's": 2, 'The Anchor': 2, 'Golden Dragon': 1, 'Hotel Bellevue': 1, 'Burger Shack': 1, 'The Plough': 2,
};

export function handOut(d: Desk, client: string, truck: number) {
  const o = d.morning.orders.findIndex((x) => x.client === client);
  d.morning.orders[o]!.lines.forEach((_, l) => d.acceptLine(o, l));
  d.assignTruck(o, truck);
  d.finishOrder(o);
}

/** The small morning with every order handed out, the clients named getting no truck, and every call answered with `answer`. */
export function summary(answer: number, leaveOut: string[] = [], amounts: Record<string, number> = { chips: 5, pork: 3 }) {
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

export function fakeEffects(cues: string[] = [], random: () => number = () => 0, store: Store = memoryStore()): Effects {
  return {
    cue: (moment) => void cues.push(moment),
    print: () => 100,
    later: (fn, ms) => (ms === ROAD_TICK_MS ? undefined : fn()),
    toggleSound: () => true,
    setSound: () => {},
    store,
    now: (() => {
      let t = 0;
      return () => (t += 1000);
    })(),
    random,
  };
}

/** Plays a morning to the end-of-day screen, answering every call with the given option. */
export function toDay(
  answer = 0,
  morning: 'small' | 'big' = 'small',
  typed = ['a'],
  cues: string[] = [],
  random: () => number = () => 0,
  store: Store = memoryStore(),
  cash?: number,
) {
  const app = new App(fakeEffects(cues, random, store), () => {}, morning);
  if (cash != null) app.run.cash = cash;
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

/** Holds B or S down for a new run until the button is full, then lets go: what the player does to start over from a later day. */
export function holdNewRun(app: App, key: string) {
  app.press({ key });
  for (let n = 0; n < 5 && app.holding; n++) app.tick();
  app.release(key);
}

export function screen(app: App): string[] {
  const lines = plain(screenLines(app));
  expect(lines).toHaveLength(ROWS);
  for (const l of lines) expect([...l]).toHaveLength(COLS);
  return lines;
}


/**
 * Plays the day on the desk, whatever its orders and trucks, as far as the supplier order: every line
 * is given as asked, each order goes on the first truck from `first` with room, and every call is
 * answered with the option at `answer`.
 */
export function playToSupply(app: App, press: (...keys: string[]) => void, answer = 0) {
  const count = app.morning.trucks.length;
  press(' ');
  for (let n = 0; n < app.desk.orderCount; n++) {
    const o = app.orderSel;
    for (let l = 0; l < app.desk.order(o).lines.length; l++) press('Enter');
    for (let i = 0; i < count && !app.desk.isFinished(o); i++) press(...Array(count).fill('ArrowUp'), ...Array((n + i) % count).fill('ArrowDown'), 'Enter');
  }
  press('F10', 'F10', 'F9');
  for (let n = 0; n < 60 && !app.roadOver; n++) {
    if (app.roadCall) press(...Array(answer).fill('ArrowDown'), 'Enter');
    else press(' ');
  }
  press('Enter', 'Enter');
}

/** Plays the day to its end and the growth choice, then on to the next morning. `growth` is the number of the option to choose. */
export function toNextMorning(
  growth: '1' | '2' | '3',
  morning: 'small' | 'big' = 'small',
  answer = 0,
  random: () => number = () => 0,
  store: Store = memoryStore(),
  cash?: number,
) {
  const day = toDay(answer, morning, ['a'], [], random, store, cash);
  day.press('Enter', growth, 'Enter', 'Enter');
  return day;
}
