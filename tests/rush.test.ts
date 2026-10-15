import { describe, expect, it } from 'vitest';
import type { Call } from '../src/game/calls';
import { DEPART_MINUTE, formatTime } from '../src/game/clock';
import { Desk } from '../src/game/desk';
import { generateDay } from '../src/game/generate';
import { bigMorning, ITEM_LIST, smallMorning } from '../src/game/morning';
import { moodOf, moodPoints, moodReasons } from '../src/game/moods';
import { clientPrice, PRICES, rushPay, rushTripCost, truckCost } from '../src/game/money';
import { DEPOT, travelMinutes, travelSquares } from '../src/game/places';
import { mulberry32 } from '../src/game/random';
import { buildResult } from '../src/game/results';
import { buildRoad } from '../src/game/road';
import { RUSH_CHANCE, RUSH_LOAD_MINUTES, rushFor, rushTrips, withRush, addRush, offered } from '../src/game/rush';
import { runFromMorning, type RunState } from '../src/game/run';
import { decodeRun, encodeRun } from '../src/game/save';
import { STOP_MINUTES } from '../src/game/routes';
import { App, RUN_KEY } from '../src/ui/app';
import { HELP_PAGES } from '../src/ui/help';
import { memoryStore } from '../src/ui/store';
import { fakeEffects, hold, screen } from './helpers';

/** The small morning's run on day 3, with plenty of everything in the store so that there is stock to spare. */
function richRun(extra: Partial<RunState> = {}): RunState {
  const run = runFromMorning(smallMorning());
  const stock = Object.fromEntries(ITEM_LIST.map((i) => [i.id, 300]));
  return { ...run, day: 3, stock, ...extra };
}

/** The first seed from `after` + 1 up whose morning has a rush order (and no truck at the garage unless `garage`). */
function rushSeed(run: RunState, after = 0, garage = false): number {
  for (let seed = after + 1; seed < 20000; seed++) {
    const day = generateDay(run, mulberry32(seed));
    if (day.rush && Boolean(day.garage) === garage) return seed;
  }
  throw new Error('no seed gives a rush order');
}

/** An app opened on a saved run, at the morning of that day. */
function appOn(run: RunState, seed: number, store = memoryStore()) {
  store.write(RUN_KEY, encodeRun(run, seed));
  const app = new App(fakeEffects([], () => 0.5, store), () => {}, 'small');
  const press = (...keys: string[]) => keys.forEach((key) => app.press({ key }));
  press(' '); // WELCOME BACK -> continue
  return { app, press, store };
}

/** Hands out every order as asked, on the first truck that is not full, and sends the trucks: the app is then on the road. */
function toRoad(app: App, press: (...keys: string[]) => void) {
  const count = app.morning.trucks.length;
  if (app.screen === 'messages') press(' ');
  for (let n = 0; n < app.desk.orderCount; n++) {
    const o = app.orderSel;
    for (let l = 0; l < app.desk.order(o).lines.length; l++) press('Enter');
    for (let i = 0; i < count && !app.desk.isFinished(o); i++) press(...Array(count).fill('ArrowUp'), ...Array((n + i) % count).fill('ArrowDown'), 'Enter');
  }
  press(' ');
  hold(app, ' ');
  expect(app.screen).toBe('road');
}

/** Lets the road run, answering every call with `pick(call)` (the number of the answer), and returns the rush call as it rang. */
function drive(app: App, press: (...keys: string[]) => void, pick: (call: Call) => number = () => 0): Call | undefined {
  let rung: Call | undefined;
  for (let n = 0; n < 100 && !app.roadOver; n++) {
    const call = app.roadCall;
    if (call?.kind === 'rush') rung = call;
    if (call) press(...Array(pick(call)).fill('ArrowDown'), 'Enter');
    else press(' ');
  }
  return rung;
}

/** An app on the road on the first rush morning whose phone call satisfies `wanted`. */
function roadWhere(wanted: (call: Call) => boolean, run = richRun()) {
  let seed = 0;
  for (let tries = 0; tries < 60; tries++) {
    seed = rushSeed(run, seed);
    const x = appOn(run, seed);
    toRoad(x.app, x.press);
    if (wanted(x.app.calls.find((c) => c.kind === 'rush')!)) return { ...x, run };
  }
  throw new Error('no morning has the call asked for');
}

const declineIndex = (call: Call) => call.options.length - 1;

describe('the rush order, as chance makes it', () => {
  it('comes on about one morning in four or five, so most mornings have none', () => {
    const run = richRun();
    let days = 0;
    const seeds = 3000;
    for (let seed = 1; seed <= seeds; seed++) if (generateDay(run, mulberry32(seed)).rush) days++;
    expect(RUSH_CHANCE).toBeGreaterThan(0.17);
    expect(RUSH_CHANCE).toBeLessThan(0.27);
    expect(days / seeds).toBeGreaterThan(0.17);
    expect(days / seeds).toBeLessThan(0.27);
  });

  it('never comes on the first morning, small or big', () => {
    expect(smallMorning().rush).toBeUndefined();
    expect(bigMorning().rush).toBeUndefined();
    for (const kind of ['small', 'big'] as const) {
      const app = new App(fakeEffects([], () => 0.5, memoryStore()), () => {}, kind);
      expect(app.run.day).toBe(1);
      expect(app.morning.rush).toBeUndefined();
      expect(app.morning.messages.some((m) => m.kind === 'staff' && /rush/.test(m.text))).toBe(false);
    }
  });

  it('is the same for the same seed, and is announced by exactly one note', () => {
    const run = richRun();
    const seed = rushSeed(run);
    const day = generateDay(run, mulberry32(seed));
    expect(generateDay(run, mulberry32(seed))).toEqual(day);
    expect(day.messages.filter((m) => m.kind === 'staff' && /rush/.test(m.text))).toHaveLength(1);
  });

  it('asks a client of the run for a valuable item, in a size that grows with the business, a truck can carry, by a time after the ring', () => {
    const run = richRun();
    const big = runFromMorning(bigMorning());
    for (let seed = 1; seed < 800; seed++) {
      for (const r of [run, { ...big, day: 3 }]) {
        const day = generateDay(r, mulberry32(seed));
        const rush = day.rush;
        if (!rush) continue;
        expect(r.clients.some((c) => c.name === rush.client)).toBe(true);
        expect(day.orders[rush.orderIndex]?.client).toBe(rush.client);
        expect(clientPrice(rush.item)).toBeGreaterThanOrEqual(7);
        expect(rush.qty).toBeGreaterThanOrEqual(3);
        const size = ITEM_LIST.find((i) => i.id === rush.item)!.size;
        expect(rush.qty * size).toBeLessThanOrEqual(Math.min(...r.trucks.map((t) => t.capacity)));
        expect(rush.at).toBeGreaterThanOrEqual(8 * 60 + 30);
        expect(rush.at).toBeLessThanOrEqual(9 * 60 + 30);
        expect(rush.before - rush.at).toBeGreaterThanOrEqual(30);
        expect(rush.before - rush.at).toBeLessThanOrEqual(60);
        expect(rush.before % 15).toBe(0);
      }
    }
  });

  it('draws nothing when there is nobody to ask', () => {
    expect(rushFor(richRun(), [], mulberry32(1))).toBeUndefined();
  });
});

describe('the rush order is announced', () => {
  it('in an overnight note from the staff, with who may ring, for what and how much, early enough to hold stock back', () => {
    const run = richRun();
    const day = generateDay(run, mulberry32(rushSeed(run)));
    const rush = day.rush!;
    const note = day.messages.find((m) => m.kind === 'staff' && /rush/.test(m.text));
    expect(note).toBeDefined();
    const text = (note as { text: string }).text;
    expect(text).toContain(rush.client);
    expect(text).toContain(`${rush.qty} `);
    expect(text.toLowerCase()).toContain(ITEM_LIST.find((i) => i.id === rush.item)!.name.split(',')[0]!.toLowerCase());
    // It is among the overnight notes, before the loading crew is in.
    expect(note!.at).toBeGreaterThanOrEqual(24 * 60 + 3 * 60);
    expect(note!.at).toBeLessThanOrEqual(24 * 60 + 5 * 60 + 15);
  });

  it('on the order desk too, in HEADS UP', () => {
    const run = richRun();
    const seed = rushSeed(run);
    const { app, press } = appOn(run, seed);
    press(' ');
    expect(app.screen).toBe('desk');
    const text = screen(app).join('\n');
    expect(text).toContain('HEADS UP');
    expect(text).toContain(`${app.morning.rush!.client} may ring for ${app.morning.rush!.qty}`);
  });
});

describe('the rush order on the phone', () => {
  it('rings while the trucks are out, about the client asked, and offers a truck that makes it, a truck at best, or no', () => {
    const run = richRun();
    const { app, press } = appOn(run, rushSeed(run));
    toRoad(app, press);
    const call = app.calls.find((c) => c.kind === 'rush')!;
    expect(call).toBeDefined();
    const rush = app.morning.rush!;
    expect(call.client).toBe(rush.client);
    expect(call.qty).toBe(rush.qty);
    expect(call.item).toBe(rush.item);
    expect(call.at).toBeGreaterThan(DEPART_MINUTE);
    expect(call.at).toBeLessThan(app.road!.end);
    expect(call.say).toContain(`before ${formatTime(rush.before)}`);
    expect(call.options.length).toBeGreaterThanOrEqual(2);
    expect(call.options.length).toBeLessThanOrEqual(3);
    const last = call.options.at(-1)!;
    expect(last.rush).toBeUndefined();
    for (const o of call.options.slice(0, -1)) {
      expect(o.rush).toBeDefined();
      expect(o.label).toContain(formatTime(o.rush!.arriveAt));
      expect(o.label).toContain(o.rush!.late ? 'late' : 'in time');
      expect(o.rush!.late).toBe(o.rush!.arriveAt > rush.before);
    }
    const calls = app.calls.map((c) => c.at);
    expect(new Set(calls).size).toBe(calls.length);
  });

  it('shows the stock on the road screen with the call', () => {
    const run = richRun();
    const { app, press } = appOn(run, rushSeed(run));
    toRoad(app, press);
    for (let n = 0; n < 100 && app.roadCall?.kind !== 'rush' && !app.roadOver; n++) press(app.roadCall ? 'Enter' : ' ');
    expect(app.roadCall?.kind).toBe('rush');
    const text = screen(app).join('\n');
    expect(text).toContain('INCOMING CALL');
    expect(text).toContain("In store after today's deliveries:");
    expect(text).toContain(`They want ${app.morning.rush!.qty}.`);
  });

  it('pays the rush premium when a truck is sent in time: the cash, the stock and the trucks all change, and the client is pleased', () => {
    const { app, press, run } = roadWhere((c) => c.options.some((o) => o.rush && !o.rush.late));
    const call = drive(app, press, (c) => (c.kind === 'rush' ? c.options.findIndex((o) => o.rush && !o.rush.late) : 0))!;
    const trip = app.result!.rush!;
    expect(trip).toBeDefined();
    expect(trip.late).toBe(false);
    expect(trip.arriveAt).toBeLessThanOrEqual(app.morning.rush!.before);
    expect(trip.paid).toBe(trip.qty * clientPrice(trip.item) * PRICES.rushPremium);
    expect(trip.cut).toBe(0);
    expect(call.options.some((o) => o.rush === trip)).toBe(true);
    // The road shows the truck leaving, delivering and coming back, and goes on until it is home.
    const events = app.road!.events.filter((e) => e.truckId === trip.truckId && e.at >= trip.leaveAt);
    expect(events.map((e) => e.kind)).toEqual(['leave', 'rush', 'back']);
    expect(app.road!.end).toBeGreaterThanOrEqual(trip.backAt);
    expect(app.roadClock).toBeGreaterThanOrEqual(trip.backAt);
    // The truck's trip is on the result: later back, further driven.
    const before = buildResult(app.desk, DEPART_MINUTE).trucks.find((t) => t.truckId === trip.truckId)!;
    const after = app.result!.trucks.find((t) => t.truckId === trip.truckId)!;
    expect(after.squares).toBe(before.squares + trip.squares);
    expect(after.backAt).toBe(trip.backAt);
    expect(after.stops).toBe(before.stops + 1);
    press(' ');
    expect(app.screen).toBe('result');
    screen(app);
    press(' ');
    press('a');
    hold(app, ' ');
    const summary = app.day!;
    expect(screen(app).join('\n')).toContain('rush:');
    const client = summary.orders.find((o) => o.client === trip.client)!;
    expect(client.reasons).toContain('got the rush order on time');
    expect(client.mood).toBe('pleased');
    expect(summary.calls.some((c) => c.topic.startsWith('rush:') && c.record.startsWith(`truck ${trip.truckId},`))).toBe(true);
    const orderPaid = summary.orders.reduce((sum, o) => sum + o.paid, 0);
    expect(summary.money.takenIn).toBe(orderPaid + trip.paid);
    const trucksCost = summary.trucks.reduce((sum, t) => sum + t.cost, 0);
    expect(summary.money.trucks).toBe(trucksCost);
    // Today's rush units are out of the store: the supplier screen starts from what is really left.
    const left = app.supply!.rows.find((r) => r.item.id === trip.item)!.onHand;
    const delivered = app.result!.orders.reduce((sum, o) => sum + (o.delivered.find((d) => d.item === trip.item)?.units ?? 0), 0);
    expect(left).toBe(run.stock[trip.item]! - delivered - trip.qty);
  });

  it('pays half and lets the client down when the truck sent is late', () => {
    const { app, press } = roadWhere((c) => c.options.some((o) => o.rush?.late));
    drive(app, press, (c) => (c.kind === 'rush' ? c.options.findIndex((o) => o.rush?.late) : 0));
    const trip = app.result!.rush!;
    expect(trip.late).toBe(true);
    const full = trip.qty * clientPrice(trip.item) * PRICES.rushPremium;
    expect(trip.paid).toBe(Math.round(full / 2));
    expect(trip.cut).toBe(full - trip.paid);
    press(' ', ' ', 'a');
    hold(app, ' ');
    const client = app.day!.orders.find((o) => o.client === trip.client)!;
    expect(client.reasons).toContain('got the rush order late');
    expect(app.day!.money.lateCut).toBeGreaterThanOrEqual(trip.cut);
    expect(client.mood).not.toBe('pleased');
  });

  it('turning it down costs the client a small dent in their mood and sends no truck', () => {
    const run = richRun();
    const { app, press } = appOn(run, rushSeed(run));
    toRoad(app, press);
    const call = drive(app, press, (c) => (c.kind === 'rush' ? declineIndex(c) : 0))!;
    expect(call.options.at(-1)!.record).toBe('turned down');
    expect(app.result!.rush).toBeUndefined();
    press(' ', ' ', 'a');
    hold(app, ' ');
    const client = app.day!.orders.find((o) => o.client === call.client)!;
    expect(client.reasons).toContain('was turned down for a rush order');
    expect(client.mood).toBe('a bit let down');
    // With nothing taken, the store is as the deliveries left it.
    const delivered = app.result!.orders.reduce((sum, o) => sum + (o.delivered.find((d) => d.item === call.item)?.units ?? 0), 0);
    expect(app.supply!.rows.find((r) => r.item.id === call.item)!.onHand).toBe(run.stock[call.item!]! - delivered);
  });

  it('cannot be accepted without the stock: there is only a polite no, which still dents the mood', () => {
    const base = richRun();
    const seed = rushSeed(base);
    const rush = generateDay(base, mulberry32(seed)).rush!;
    const run = richRun({ stock: { ...base.stock, [rush.item]: rush.qty - 1 } });
    const { app, press } = appOn(run, seed);
    expect(app.morning.rush).toEqual(rush);
    toRoad(app, press);
    const call = app.calls.find((c) => c.kind === 'rush')!;
    expect(call.options).toHaveLength(1);
    expect(call.options[0]!.rush).toBeUndefined();
    expect(call.options[0]!.label).toContain('none to spare');
    drive(app, press);
    expect(app.result!.rush).toBeUndefined();
    press(' ', ' ', 'a');
    hold(app, ' ');
    expect(app.day!.orders.find((o) => o.client === rush.client)!.reasons).toContain('was turned down for a rush order');
  });

  it('is only possible with what the day left in the store: giving it all away at the desk leaves nothing to spare', () => {
    const base = richRun();
    const seed = rushSeed(base);
    const rush = generateDay(base, mulberry32(seed)).rush!;
    const day = generateDay(base, mulberry32(seed));
    const asked = day.orders.reduce((sum, o) => sum + o.lines.filter((l) => l.item === rush.item).reduce((n, l) => n + l.asked, 0), 0);
    const run = richRun({ stock: { ...base.stock, [rush.item]: asked } });
    const { app, press } = appOn(run, seed);
    toRoad(app, press);
    expect(app.calls.find((c) => c.kind === 'rush')!.options).toHaveLength(1);
  });
});

describe('what a rush order does to the day, from the parts', () => {
  const desk = () => {
    const d = new Desk(smallMorning());
    d.morning.orders.forEach((order, o) => {
      order.lines.forEach((_, l) => d.acceptLine(o, l));
      d.assignTruck(o, o % 2 === 0 ? 1 : 2);
      d.finishOrder(o);
    });
    return d;
  };
  const rush = { client: 'Hotel Bellevue', orderIndex: 4, item: 'chips', qty: 4, at: 9 * 60, before: 10 * 60, why: 0 };

  it('sends a truck from the depot when it is home and loaded: a truck still out finishes its round first, one in the yard goes at once', () => {
    const d = new Desk(smallMorning());
    d.morning.orders.forEach((order, o) => {
      order.lines.forEach((_, l) => d.acceptLine(o, l));
      d.assignTruck(o, 1);
      d.finishOrder(o);
    });
    const result = buildResult(d, DEPART_MINUTE);
    const home = result.trucks.find((t) => t.truckId === 1)!.backAt!;
    const trips = rushTrips(d.morning.trucks, result, rush, 'docks', rush.at);
    const out = trips.find((t) => t.truckId === 1)!;
    const yard = trips.find((t) => t.truckId === 2)!;
    expect(out.wentOut).toBe(true);
    expect(yard.wentOut).toBe(false);
    const there = travelMinutes(DEPOT, 'docks');
    expect(out.leaveAt).toBe(Math.max(rush.at, home) + RUSH_LOAD_MINUTES);
    expect(yard.leaveAt).toBe(rush.at + RUSH_LOAD_MINUTES);
    expect(yard.arriveAt).toBe(yard.leaveAt + there);
    expect(yard.backAt).toBe(yard.arriveAt + STOP_MINUTES + there);
    expect(yard.squares).toBe(2 * travelSquares(DEPOT, 'docks'));
    // The yard truck costs a driver as well as the road; the truck already out only the road.
    expect(yard.cost).toBe(truckCost(yard.squares));
    expect(out.cost).toBe(rushTripCost(out.squares, true));
    expect(out.cost).toBe(out.squares * PRICES.truckPerSquare);
    expect(yard.cost - out.cost).toBe(PRICES.truckDriver);
  });

  it('offers the truck that gets there first and the cheapest one that gets there in time, and one truck when they are the same', () => {
    const result = buildResult(desk(), DEPART_MINUTE);
    const trips = rushTrips(desk().morning.trucks, result, rush, 'docks', rush.at);
    const picked = offered(trips);
    expect(picked.length).toBeGreaterThanOrEqual(1);
    expect(picked.length).toBeLessThanOrEqual(2);
    expect(picked[0]!.arriveAt).toBe(Math.min(...trips.map((t) => t.arriveAt)));
    expect(new Set(picked.map((t) => t.truckId)).size).toBe(picked.length);
    const onTime = trips.filter((t) => !t.late);
    if (onTime.length > 0) expect(picked.some((t) => t.cost === Math.min(...onTime.map((t) => t.cost)))).toBe(true);
    // When no truck can make it, the nearest one is still offered.
    const tight = rushTrips(desk().morning.trucks, result, { ...rush, before: rush.at + 1 }, 'docks', rush.at);
    expect(tight.every((t) => t.late)).toBe(true);
    expect(offered(tight).length).toBeGreaterThanOrEqual(1);
  });

  it('puts the trip on the result and the road once, and leaves the orders as they were', () => {
    const d = desk();
    const result = buildResult(d, DEPART_MINUTE);
    const road = buildRoad(d, result);
    const trip = offered(rushTrips(d.morning.trucks, result, rush, 'docks', rush.at))[0]!;
    const with1 = withRush(result, trip);
    expect(with1.orders).toEqual(result.orders);
    expect(withRush(with1, trip)).toBe(with1);
    expect(withRush(result, null)).toBe(result);
    expect(with1.lastBack).toBe(Math.max(result.lastBack!, trip.backAt));
    const longer = addRush(road, trip);
    expect(longer.end).toBe(Math.max(road.end, trip.backAt));
    expect(longer.events.map((e) => e.at)).toEqual([...longer.events.map((e) => e.at)].sort((a, b) => a - b));
    expect(road.events.some((e) => e.kind === 'rush')).toBe(false);
  });

  it('prices a rush at twice the usual price, and half of that when late', () => {
    expect(PRICES.rushPremium).toBeGreaterThan(1);
    expect(rushPay('chips', 4, false)).toEqual({ paid: 4 * clientPrice('chips') * PRICES.rushPremium, cut: 0 });
    const late = rushPay('chips', 4, true);
    expect(late.paid).toBe(4 * clientPrice('chips') * PRICES.rushPremium / 2);
    expect(late.paid + late.cut).toBe(4 * clientPrice('chips') * PRICES.rushPremium);
  });
});

describe('moods and a rush order', () => {
  const calm = { percent: 100, late: false, shortCall: null } as const;

  it('dents the mood by a point when the rush was turned down or came late, and not when it came in time', () => {
    expect(moodPoints({ ...calm, rush: 'on time' })).toBe(0);
    expect(moodPoints({ ...calm, rush: 'late' })).toBe(1);
    expect(moodPoints({ ...calm, rush: 'declined' })).toBe(1);
    expect(moodOf({ ...calm, rush: 'declined' })).toBe('a bit let down');
    expect(moodOf({ ...calm, rush: null })).toBe('pleased');
    expect(moodReasons({ ...calm, rush: 'declined' })).toContain('was turned down for a rush order');
    expect(moodReasons({ ...calm, rush: 'late' })).toContain('got the rush order late');
    expect(moodReasons({ ...calm, rush: 'on time' })).toContain('got the rush order on time');
  });
});

describe('a truck at the garage and a rush order', () => {
  it('is never sent: only the trucks that can be loaded are offered', () => {
    const run = richRun({ trucks: runFromMorning(bigMorning()).trucks.slice(0, 4), crews: runFromMorning(bigMorning()).crews });
    let seed = 0;
    let checked = 0;
    for (let tries = 0; tries < 60 && checked < 3; tries++) {
      seed = rushSeed(run, seed, true);
      const day = generateDay(run, mulberry32(seed));
      const store = memoryStore();
      store.write(RUN_KEY, encodeRun(run, seed));
      const app = new App(fakeEffects([], () => 0.5, store), () => {}, 'small');
      app.press({ key: ' ' });
      const press = (...keys: string[]) => keys.forEach((key) => app.press({ key }));
      toRoad(app, press);
      const call = app.calls.find((c) => c.kind === 'rush')!;
      for (const o of call.options) expect(o.rush?.truckId).not.toBe(day.garage!.truckId);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('playing the rush order again, and saving', () => {
  it('brings the same rush back when the day is played again with R', () => {
    const run = richRun();
    const { app, press } = appOn(run, rushSeed(run));
    const before = JSON.stringify({ rush: app.morning.rush, messages: app.morning.messages, orders: app.morning.orders });
    toRoad(app, press);
    drive(app, press);
    press(' ');
    hold(app, 'r');
    expect(app.screen).toBe('messages');
    expect(JSON.stringify({ rush: app.morning.rush, messages: app.morning.messages, orders: app.morning.orders })).toBe(before);
    expect(app.result).toBeNull();
    toRoad(app, press);
    expect(app.calls.find((c) => c.kind === 'rush')).toBeDefined();
  });

  it('is in a save made mid-run: reopening the page brings the same rush and the same note, and the save format is unchanged', () => {
    const run = richRun();
    const seed = rushSeed(run);
    const first = appOn(run, seed);
    toRoad(first.app, first.press);
    const saved = decodeRun(first.store.data.get(RUN_KEY) ?? '');
    expect(saved).not.toBeNull();
    expect(Object.keys(saved!.run).sort()).toEqual(Object.keys(run).sort());
    const again = new App(fakeEffects([], () => 0.5, first.store), () => {}, 'small');
    again.press({ key: ' ' });
    expect(again.morning.rush).toEqual(first.app.morning.rush);
    expect(JSON.stringify(again.morning.messages)).toBe(JSON.stringify(first.app.morning.messages));
  });
});

describe('how to play', () => {
  it('says what a rush order is and how to answer it', () => {
    const text = HELP_PAGES.flatMap((p) => p.blocks.map((b) => `${b.head ?? ''} ${b.text}`)).join('\n');
    expect(text).toMatch(/RUSH ORDER/);
    expect(text).toMatch(/spare/);
  });
});
