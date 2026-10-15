import { describe, expect, it } from 'vitest';
import { dateLabel } from '../src/game/clock';
import { generateDay } from '../src/game/generate';
import { BIG_TRUCKS, bigMorning, smallMorning } from '../src/game/morning';
import { mulberry32 } from '../src/game/random';
import { ROOM_CAPACITY, ROOM_GROWTH } from '../src/game/rooms';
import { EXTRA_DRIVERS, nextDay, newTruck, promisesFrom, runFromMorning, type DayOutcome, type RunState } from '../src/game/run';
import { NEW_CLIENTS } from '../src/game/growth';
import { stockAfterDeliveries } from '../src/game/supply';
import type { Morning } from '../src/game/types';
import { App } from '../src/ui/app';
import { fakeEffects, hold, holdNewRun, playToSupply, screen, toDay, toNextMorning } from './helpers';

const outcome = (over: Partial<DayOutcome> = {}): DayOutcome => ({ left: {}, ordered: {}, moods: {}, today: {}, promises: [], growth: null, earned: 0, ...over });
const smallRun = (): RunState => runFromMorning(smallMorning());
const bigRun = (): RunState => runFromMorning(bigMorning());
const total = (m: Morning, client: string) => m.orders.find((o) => o.client === client)!.lines.reduce((sum, l) => sum + l.asked, 0);
const spaceOf = (m: Morning, lines: Array<{ item: string; asked: number }>) =>
  lines.reduce((sum, l) => sum + l.asked * m.items.find((i) => i.id === l.item)!.size, 0);

describe('the date', () => {
  it('moves on a day at a time from TUE 14 MAR', () => {
    expect(dateLabel(1)).toBe('TUE 14 MAR');
    expect(dateLabel(2)).toBe('WED 15 MAR');
    expect(dateLabel(3)).toBe('THU 16 MAR');
    expect(dateLabel(8)).toBe('TUE 21 MAR');
  });

  it('rolls over into the next month', () => {
    expect(dateLabel(18)).toBe('FRI 31 MAR');
    expect(dateLabel(19)).toBe('SAT 1 APR');
  });
});

describe('the state a run starts from', () => {
  it.each([['small', smallMorning], ['big', bigMorning]] as const)('copies the %s morning: day 1, its stock, trucks, rooms and clients', (id, load) => {
    const m = load();
    const run = runFromMorning(m);
    expect(run.kind).toBe(id);
    expect(run.day).toBe(1);
    expect(run.stock).toEqual(m.stock);
    expect(run.trucks).toEqual(m.trucks);
    expect(run.capacity).toEqual(ROOM_CAPACITY);
    expect(run.clients.map((c) => c.name)).toEqual(m.orders.map((o) => o.client));
    expect(run.moods).toEqual({});
    expect(run.promises).toEqual([]);
    run.stock.ketchup = 999;
    run.trucks[0]!.capacity = 1;
    expect(m.stock.ketchup).not.toBe(999);
    expect(m.trucks[0]!.capacity).not.toBe(1);
  });

  it('keeps the times clients asked for on the first morning', () => {
    const run = bigRun();
    expect(run.clients.find((c) => c.name === "St Jude's Hospital")?.before).toBe(8 * 60);
    expect(run.clients.find((c) => c.name === 'Corner Deli')?.before).toBeUndefined();
  });
});

describe('the next day', () => {
  it('is the day after, with the stock that was left plus the supplier order', () => {
    const run = smallRun();
    const next = nextDay(run, outcome({ left: { ketchup: 2, chips: 5, pork: 0 }, ordered: { ketchup: 10, pork: 30, rice: 4 } }));
    expect(next.day).toBe(2);
    expect(next.stock.ketchup).toBe(12);
    expect(next.stock.chips).toBe(5);
    expect(next.stock.pork).toBe(30);
    expect(next.stock.rice).toBe(4);
    // Nothing was left of the rest and nothing was ordered, so nothing is in the store.
    expect(next.stock.eggs).toBe(0);
    expect(Object.keys(next.stock).sort()).toEqual(Object.keys(run.stock).sort());
  });

  it('counts what the supplier brought in', () => {
    expect(nextDay(smallRun(), outcome({ ordered: { ketchup: 10, pork: 30, rice: 0 } })).delivery).toEqual({ items: 2, units: 40 });
    expect(nextDay(smallRun(), outcome()).delivery).toEqual({ items: 0, units: 0 });
  });

  it('keeps the trucks, rooms and clients as they were when nothing is grown, and passes on moods and promises', () => {
    const run = smallRun();
    const promises = [{ client: 'Café Lumen', item: 'ketchup', qty: 4 }];
    const next = nextDay(run, outcome({ moods: { 'Café Lumen': 'let down' }, promises }));
    expect(next.trucks).toEqual(run.trucks);
    expect(next.capacity).toEqual(run.capacity);
    expect(next.clients).toEqual(run.clients);
    expect(next.usual).toEqual(run.usual);
    expect(next.moods).toEqual({ 'Café Lumen': 'let down' });
    expect(next.promises).toEqual(promises);
  });

  it('forgets last day\'s moods and promises on the day after', () => {
    const second = nextDay(smallRun(), outcome({ moods: { 'Café Lumen': 'let down' }, promises: [{ client: 'Café Lumen', item: 'ketchup', qty: 4 }] }));
    const third = nextDay(second, outcome());
    expect(third.day).toBe(3);
    expect(third.moods).toEqual({});
    expect(third.promises).toEqual([]);
  });

  it('does not change the state it was given', () => {
    const run = smallRun();
    const before = JSON.stringify(run);
    nextDay(run, outcome({ left: { ketchup: 1 }, growth: { kind: 'truck' } }));
    nextDay(run, outcome({ growth: { kind: 'room', room: 'freezer' } }));
    expect(JSON.stringify(run)).toBe(before);
  });
});

describe('growing', () => {
  it('another truck is one more truck, the next in the line-up, in the last crew', () => {
    const run = smallRun();
    const next = nextDay(run, outcome({ growth: { kind: 'truck' } }));
    expect(next.trucks).toHaveLength(3);
    expect(next.trucks[2]).toEqual(BIG_TRUCKS[2]);
    expect(next.crews.at(-1)!.trucks).toEqual([1, 2, 3]);
    const again = nextDay(next, outcome({ growth: { kind: 'truck' } }));
    expect(again.trucks.map((t) => t.id)).toEqual([1, 2, 3, 4]);
  });

  it('goes on past nine trucks with new ids', () => {
    const next = nextDay(bigRun(), outcome({ growth: { kind: 'truck' } }));
    expect(next.trucks).toHaveLength(10);
    expect(next.trucks[9]!.id).toBe(10);
    expect(next.trucks[9]!.capacity).toBeGreaterThan(0);
    expect(next.trucks[9]!.kind).toBe(BIG_TRUCKS[0]!.kind);
    expect(next.trucks[9]!.driver).toBe(EXTRA_DRIVERS[0]);
    expect(next.crews.at(-1)!.trucks.at(-1)).toBe(10);
  });

  it.each(['freezer', 'fridge', 'dry'] as const)('a bigger %s adds space to that room only', (room) => {
    const next = nextDay(smallRun(), outcome({ growth: { kind: 'room', room } }));
    expect(next.capacity[room]).toBe(ROOM_CAPACITY[room] + ROOM_GROWTH[room]);
    for (const other of (['freezer', 'fridge', 'dry'] as const).filter((r) => r !== room)) expect(next.capacity[other]).toBe(ROOM_CAPACITY[other]);
    expect(nextDay(next, outcome({ growth: { kind: 'room', room } })).capacity[room]).toBe(ROOM_CAPACITY[room] + 2 * ROOM_GROWTH[room]);
  });

  it('a new client joins the clients', () => {
    const client = NEW_CLIENTS[0]!;
    const next = nextDay(smallRun(), outcome({ growth: { kind: 'client', client } }));
    expect(next.clients).toHaveLength(8);
    expect(next.clients.at(-1)).toEqual(client);
    expect(nextDay(next, outcome({ growth: { kind: 'client', client } })).clients).toHaveLength(8);
  });

  it.each([
    ['small', smallRun],
    ['big', bigRun],
  ] as const)('never gives two trucks the same driver on the %s run, however many are added', (_name, make) => {
    let run = make();
    const first = run.trucks.map((t) => ({ ...t }));
    for (let i = 0; i < 60; i++) run = nextDay(run, outcome({ growth: { kind: 'truck' } }));
    expect(run.trucks).toHaveLength(first.length + 60);
    expect(new Set(run.trucks.map((t) => t.driver)).size).toBe(run.trucks.length);
    expect(run.trucks.slice(0, first.length)).toEqual(first);
    if (_name === 'small') expect(run.trucks.slice(0, 3)).toEqual(BIG_TRUCKS.slice(0, 3));
    for (const t of run.trucks) {
      expect(BIG_TRUCKS.some((b) => b.kind === t.kind && b.capacity === t.capacity)).toBe(true);
    }
  });

  it('newTruck picks a driver no other truck has', () => {
    expect(newTruck(10, BIG_TRUCKS.map((t) => t.driver)).driver).toBe(EXTRA_DRIVERS[0]);
    expect(newTruck(3, ['Sam', 'Dev']).driver).not.toMatch(/^(Sam|Dev)$/);
  });

  it('a new client raises each usual amount by the average share of one client', () => {
    const run = smallRun();
    const clients = run.clients.length;
    const next = nextDay(run, outcome({ growth: { kind: 'client', client: NEW_CLIENTS[0]! } }));
    for (const [item, n] of Object.entries(run.usual)) expect(next.usual[item]).toBe(n + Math.round(n / clients));
    const again = nextDay(next, outcome({ growth: { kind: 'client', client: NEW_CLIENTS[0]! } }));
    expect(again.usual).toEqual(next.usual);
  });

  it('another truck or a bigger room leaves the usual amounts as they were', () => {
    const run = smallRun();
    expect(nextDay(run, outcome({ growth: { kind: 'truck' } })).usual).toEqual(run.usual);
    expect(nextDay(run, outcome({ growth: { kind: 'room', room: 'dry' } })).usual).toEqual(run.usual);
  });
});

describe('promises', () => {
  it('are the answered calls that promised something for tomorrow', () => {
    const calls = [
      { id: 0, client: 'A', item: 'pork', qty: 3, options: [{ addsToOrder: true }, {}] },
      { id: 1, client: 'B', item: 'eggs', qty: 2, options: [{ addsToOrder: true }, {}] },
      { id: 2, client: 'C', options: [{}, {}] },
      { id: 3, client: 'D', item: 'rice', qty: 5, options: [{ addsToOrder: true }, {}] },
    ] as unknown as Parameters<typeof promisesFrom>[0];
    expect(promisesFrom(calls, new Map([[0, 0], [1, 1], [2, 0]]))).toEqual([{ client: 'A', item: 'pork', qty: 3 }]);
  });
});

describe('a made-up day', () => {
  const runs: Array<[string, () => RunState]> = [['small', smallRun], ['big', bigRun]];

  it.each(runs)('is a valid %s morning for any seed', (_name, make) => {
    for (let seed = 1; seed <= 25; seed++) {
      const run = { ...make(), day: 2 };
      const m = generateDay(run, mulberry32(seed));
      expect(m.day).toBe(2);
      expect(m.title).toBe('Day 2');
      expect(m.id).toBe(run.kind);
      expect(m.orders.map((o) => o.client).sort()).toEqual(run.clients.map((c) => c.name).sort());
      expect(m.orders.map((o) => o.id)).toEqual(m.orders.map((_, i) => i + 1));
      const ids = new Set(m.items.map((i) => i.id));
      for (const o of m.orders) {
        expect(o.lines.length).toBeGreaterThanOrEqual(3);
        expect(new Set(o.lines.map((l) => l.item)).size).toBe(o.lines.length);
        for (const l of o.lines) {
          expect(ids.has(l.item)).toBe(true);
          expect(Number.isInteger(l.asked)).toBe(true);
          expect(l.asked).toBeGreaterThan(0);
        }
        expect(spaceOf(m, o.lines)).toBeLessThan(Math.min(...m.trucks.map((t) => t.capacity)));
        const place = run.clients.find((c) => c.name === o.client)!;
        expect([o.place, o.contact]).toEqual([place.place, place.contact]);
      }
      const orderMessages = m.messages.filter((x) => x.kind === 'order');
      expect(orderMessages.map((x) => (x.kind === 'order' ? x.orderId : 0))).toEqual(m.orders.map((o) => o.id));
      const times = m.messages.map((x) => x.at);
      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(m.stock).toEqual(run.stock);
      expect(m.trucks).toEqual(run.trucks);
      expect(m.capacity).toEqual(run.capacity);
      expect(m.crews).toEqual(run.crews);
    }
  });

  it.each(runs)('stays sensible for the %s run: no item asked for beyond its usual amount, and room on the trucks', (_name, make) => {
    for (let seed = 1; seed <= 25; seed++) {
      const run = make();
      const m = generateDay(run, mulberry32(seed));
      for (const item of m.items) {
        const asked = m.orders.reduce((sum, o) => sum + o.lines.filter((l) => l.item === item.id).reduce((s, l) => s + l.asked, 0), 0);
        // A line is never below one, so a very small usual amount can be passed by a unit or two.
        expect(asked).toBeLessThanOrEqual((run.usual[item.id] ?? 0) + m.orders.length);
      }
      const space = m.orders.reduce((sum, o) => sum + spaceOf(m, o.lines), 0);
      const capacity = m.trucks.reduce((sum, t) => sum + t.capacity, 0);
      expect(space / capacity).toBeGreaterThan(0.3);
      expect(space / capacity).toBeLessThan(0.8);
    }
  });

  it('is the same day for the same random source and a different day for another', () => {
    const run = { ...smallRun(), day: 2 };
    const a = generateDay(run, mulberry32(7));
    expect(generateDay(run, mulberry32(7))).toEqual(a);
    const orders = new Set<string>();
    const notes = new Set<string>();
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 10; seed++) {
      const m = generateDay(run, mulberry32(seed));
      orders.add(JSON.stringify(m.orders.map((o) => [o.client, o.lines])));
      notes.add(JSON.stringify(m.orders.map((o) => o.note ?? '')));
      kinds.add(JSON.stringify(m.callKinds));
    }
    expect(orders.size).toBe(10);
    expect(notes.size).toBeGreaterThan(3);
    expect(kinds.size).toBeGreaterThan(1);
  });

  it('draws its numbers from the source it is given and from nowhere else', () => {
    const run = { ...smallRun(), day: 2 };
    const zero = generateDay(run, () => 0);
    const high = generateDay(run, () => 0.999);
    expect(JSON.stringify(zero.orders)).not.toBe(JSON.stringify(high.orders));
  });

  it('puts what was promised on the client\'s order: more on a line it has, a new line if not', () => {
    const base = { ...smallRun(), day: 2 };
    const plain = generateDay(base, mulberry32(3));
    const lumen = plain.orders.find((o) => o.client === 'Café Lumen')!;
    const have = lumen.lines[0]!;
    const missing = plain.items.find((i) => !lumen.lines.some((l) => l.item === i.id))!;
    const promised = generateDay(
      { ...base, promises: [{ client: 'Café Lumen', item: have.item, qty: 4 }, { client: 'Café Lumen', item: missing.id, qty: 3 }] },
      mulberry32(3),
    );
    const order = promised.orders.find((o) => o.client === 'Café Lumen')!;
    expect(order.lines.find((l) => l.item === have.item)!.asked).toBe(have.asked + 4);
    expect(order.lines.find((l) => l.item === missing.id)!.asked).toBe(3);
    expect(order.lines).toHaveLength(lumen.lines.length + 1);
    expect(order.note).toContain('As promised: 4');
    expect(order.note).toContain('3');
    // Everyone else's order is as it was.
    for (const o of plain.orders.filter((x) => x.client !== 'Café Lumen')) {
      expect(promised.orders.find((x) => x.client === o.client)!.lines).toEqual(o.lines);
    }
  });

  it('makes a let-down client ask for less, with a note, and leaves the others alone', () => {
    const base = { ...smallRun(), day: 2 };
    const pleased = generateDay(base, mulberry32(11));
    const upset = generateDay({ ...base, moods: { 'The Anchor': 'let down', "Rosa's": 'a bit let down' } }, mulberry32(11));
    expect(total(upset, 'The Anchor')).toBeLessThan(total(pleased, 'The Anchor'));
    expect(total(upset, "Rosa's")).toBeLessThanOrEqual(total(pleased, "Rosa's"));
    expect(upset.orders.find((o) => o.client === 'The Anchor')!.note).toMatch(/counting on you/);
    expect(upset.orders.find((o) => o.client === "Rosa's")!.note).toMatch(/a bit thin/);
    for (const o of pleased.orders.filter((x) => !['The Anchor', "Rosa's"].includes(x.client))) {
      expect(upset.orders.find((x) => x.client === o.client)!.lines.map((l) => l.item)).toEqual(o.lines.map((l) => l.item));
    }
  });

  it('makes a pleased client ask just as much as ever', () => {
    const base = { ...smallRun(), day: 2 };
    const none = generateDay(base, mulberry32(11));
    const pleased = generateDay({ ...base, moods: Object.fromEntries(base.clients.map((c) => [c.name, 'pleased' as const])) }, mulberry32(11));
    expect(pleased.orders).toEqual(none.orders);
  });

  it('keeps a client\'s standing time on every day', () => {
    const base = { ...bigRun(), day: 2 };
    for (let seed = 1; seed <= 5; seed++) {
      const m = generateDay(base, mulberry32(seed));
      expect(m.orders.find((o) => o.client === "St Jude's Hospital")!.before).toBe(8 * 60);
      expect(m.orders.find((o) => o.client === "St Jude's Hospital")!.note).toContain('08:00');
      for (const o of m.orders) if (o.before != null) expect([8, 9, 10, 11].map((h) => h * 60)).toContain(o.before);
    }
  });

  it('has a new client sending orders from its first morning', () => {
    const client = NEW_CLIENTS[4]!;
    const run = nextDay(smallRun(), outcome({ growth: { kind: 'client', client } }));
    const m = generateDay(run, mulberry32(2));
    expect(m.orders).toHaveLength(8);
    const order = m.orders.find((o) => o.client === client.name)!;
    expect([order.place, order.contact]).toEqual([client.place, client.contact]);
    expect(order.lines.length).toBeGreaterThanOrEqual(3);
  });

  it('has one more truck, and a bigger room, when they were grown', () => {
    const grown = nextDay(nextDay(smallRun(), outcome({ growth: { kind: 'truck' } })), outcome({ growth: { kind: 'room', room: 'fridge' } }));
    const m = generateDay(grown, mulberry32(2));
    expect(m.trucks).toHaveLength(3);
    expect(m.capacity.fridge).toBe(ROOM_CAPACITY.fridge + ROOM_GROWTH.fridge);
    expect(m.capacity.freezer).toBe(ROOM_CAPACITY.freezer);
  });

  it('tells of the supplier\'s delivery in the overnight messages, only when there was one', () => {
    const base = { ...smallRun(), day: 2 };
    const arrived = generateDay({ ...base, delivery: { items: 5, units: 80 } }, mulberry32(4));
    expect(arrived.messages.some((m) => m.kind === 'supplier' && m.text.includes('5 items, 80 units'))).toBe(true);
    const nothing = generateDay(base, mulberry32(4));
    expect(nothing.messages.some((m) => m.kind === 'supplier' && /Your order is in/.test(m.text))).toBe(false);
  });

  it('has notes short enough to read whole on the order desk', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const run = { ...bigRun(), day: 2, moods: Object.fromEntries(bigRun().clients.map((c) => [c.name, 'let down' as const])) };
      for (const o of generateDay(run, mulberry32(seed)).orders) expect(`${o.contact} · "${o.note ?? ''}"`.length).toBeLessThanOrEqual(84);
    }
  });
});

describe('the next morning in the game', () => {
  it('needs the growth choice first: SPACE on the day only opens it', () => {
    const { app, press } = toDay();
    press(' ');
    expect(app.morning.day).toBe(1);
    press('Enter');
    expect(app.growth).not.toBeNull();
    expect(app.morning.day).toBe(1);
    expect(app.screen).toBe('day');
  });

  it('starts day 2 at the overnight messages with the date a day on', () => {
    const { app } = toNextMorning('1');
    expect(app.screen).toBe('messages');
    expect(app.morning.day).toBe(2);
    expect(app.run.day).toBe(2);
    const text = screen(app).join('\n');
    expect(text).toContain('WED 15 MAR');
    expect(text).not.toContain('TUE 14 MAR');
    expect(text).toContain('OVERNIGHT MESSAGES · day 2: 3 trucks, 7 orders');
    expect(text).toContain('05:31');
    expect(text).toContain('Your order is in');
  });

  it('goes on to a third day with the date still moving', () => {
    const { app, press } = toNextMorning('1');
    playToSupply(app, press);
    press('a');
    hold(app, ' ');
    press(' ', '1', 'Enter');
    hold(app, ' ');
    expect(app.morning.day).toBe(3);
    expect(screen(app).join('\n')).toContain('THU 16 MAR');
    expect(app.morning.trucks).toHaveLength(4);
  });

  it('has the stock the player ordered on top of what was left', () => {
    const { app, press } = toDay(0, 'small', ['a']);
    const left = stockAfterDeliveries(app.desk);
    const ordered = new Map(app.supply!.ordered().map((o) => [o.item.id, o.amount]));
    const units = app.supply!.total();
    expect(ordered.size).toBeGreaterThan(0);
    press(' ', '1', 'Enter');
    hold(app, ' ');
    for (const item of app.morning.items) expect(app.morning.stock[item.id]).toBe((left[item.id] ?? 0) + (ordered.get(item.id) ?? 0));
    expect(app.run.stock).toEqual(app.morning.stock);
    expect(app.run.delivery.units).toBe(units);
  });

  it('has only what was left when nothing was ordered of an item', () => {
    const { app, press } = toDay(0, 'small', ['1', 'ArrowDown']);
    const left = stockAfterDeliveries(app.desk);
    expect(app.supply!.ordered().map((o) => o.item.id)).toEqual(['chips']);
    press(' ', '1', 'Enter');
    hold(app, ' ');
    expect(app.morning.stock.pork).toBe(left.pork);
    expect(app.morning.stock.chips).toBe((left.chips ?? 0) + 1);
  });

  it('is shown on the order desk: the HEADS UP and the on-hand figures use the new stock', () => {
    const { app, press } = toNextMorning('1');
    press(' ');
    expect(app.screen).toBe('desk');
    const first = app.desk.order(0).lines[0]!;
    expect(app.desk.onHand(0, 0)).toBe(Math.min(app.morning.stock[first.item]!, app.morning.stock[first.item]!));
    expect(screen(app).join('\n')).toContain('WED 15 MAR');
  });

  it('puts one more truck on the desk and the sheets when a truck was chosen', () => {
    const { app, press } = toNextMorning('1');
    expect(app.morning.trucks.map((t) => t.id)).toEqual([1, 2, 3]);
    press(' ');
    expect(screen(app).join('\n')).toMatch(/3 Dev/);
    expect(app.desk.fullness(3)).toBe(0);
    playToSupply(app, press);
    expect(app.result!.trucks).toHaveLength(3);
    expect(app.desk.ordersOn(3).length).toBeGreaterThan(0);
  });

  it('puts one more truck on the big morning too, past nine, and still fits the screens', () => {
    const { app, press } = toNextMorning('1', 'big', 0, undefined, undefined, 99999);
    expect(app.morning.trucks).toHaveLength(10);
    press(' ');
    screen(app);
    expect(screen(app).join('\n')).toMatch(/10 /);
    press(' ');
    expect(app.screen).toBe('sheets');
    press('+');
    screen(app);
  });

  it('plays the big morning\'s second day with ten trucks to the end of the day, in 120 columns', () => {
    const { app, press } = toNextMorning('1', 'big', 0, undefined, undefined, 99999);
    playToSupply(app, press);
    expect(app.result!.trucks).toHaveLength(10);
    screen(app);
    press('a');
    hold(app, ' ');
    expect(app.screen).toBe('day');
    expect(app.day!.trucks).toHaveLength(10);
    screen(app);
    press(' ');
    screen(app);
    press('Enter');
    hold(app, ' ');
    expect(app.morning.day).toBe(3);
    expect(app.morning.trucks).toHaveLength(11);
    screen(app);
    press(' ');
    screen(app);
    press(' ');
    screen(app);
    expect(app.screen).toBe('sheets');
  });

  it('shows the bigger room on the supplier screen', () => {
    const { app, press } = toDay(0, 'small', ['9', '9', '9'], [], undefined, undefined, 99999);
    const room = app.growthOptions[1]!.growth as { kind: 'room'; room: 'freezer' | 'fridge' | 'dry' };
    press(' ', '2', 'Enter');
    hold(app, ' ');
    expect(app.morning.capacity[room.room]).toBe(ROOM_CAPACITY[room.room] + ROOM_GROWTH[room.room]);
    playToSupply(app, press);
    expect(app.screen).toBe('supply');
    expect(app.supply!.roomSpace(room.room).capacity).toBe(ROOM_CAPACITY[room.room] + ROOM_GROWTH[room.room]);
    const other = (['freezer', 'fridge', 'dry'] as const).find((r) => r !== room.room)!;
    expect(app.supply!.roomSpace(other).capacity).toBe(ROOM_CAPACITY[other]);
    // The same amounts fill the bigger room less than they would have filled the old one.
    press('a');
    const space = app.supply!.roomSpace(room.room);
    expect(space.pct).toBe(Math.round(((space.inStore + space.ordered) * 100) / space.capacity));
    screen(app);
  });

  it('has the new client send an order, and listed among the messages', () => {
    const { app, press } = toDay(0, 'small', ['a'], [], () => 0);
    const client = (app.growthOptions[2]!.growth as { kind: 'client'; client: { name: string } }).client;
    press(' ', '3', 'Enter');
    hold(app, ' ');
    expect(app.morning.orders).toHaveLength(8);
    expect(app.morning.orders.map((o) => o.client)).toContain(client.name);
    expect(screen(app).join('\n')).toContain('day 2: 2 trucks, 8 orders');
    press('End');
    const names = app.morning.messages.flatMap((m) => (m.kind === 'order' ? [app.desk.order(m.orderId - 1).client] : []));
    expect(names).toContain(client.name);
  });

  it('brings a promise made on the phone onto the client\'s next order', () => {
    const { app, press } = toDay(0);
    const promises = app.calls.filter((c) => c.item && c.options[0]?.addsToOrder).length;
    press(' ', '1', 'Enter');
    hold(app, ' ');
    expect(promises).toBeGreaterThan(0);
    expect(app.run.promises).toHaveLength(promises);
    for (const p of app.run.promises) {
      const order = app.morning.orders.find((o) => o.client === p.client)!;
      const line = order.lines.find((l) => l.item === p.item)!;
      expect(line.asked).toBeGreaterThanOrEqual(p.qty);
      expect(order.note).toContain('As promised');
    }
  });

  it('brings nothing over when every call was answered "not today"', () => {
    const { app, press } = toDay(1);
    press(' ', '1', 'Enter');
    hold(app, ' ');
    expect(app.run.promises).toEqual([]);
    expect(app.morning.orders.some((o) => o.note?.includes('As promised'))).toBe(false);
  });

  it('keeps how each client felt, and lets it change tomorrow\'s order', () => {
    const { app, press } = toDay(1);
    const moods = Object.fromEntries(app.day!.orders.map((o) => [o.client, o.mood]));
    press(' ', '1', 'Enter');
    hold(app, ' ');
    expect(app.run.moods).toEqual(moods);
    for (const o of app.morning.orders) {
      if (moods[o.client] === 'let down') expect(o.note).toMatch(/counting on you/);
      if (moods[o.client] === 'a bit let down') expect(o.note).toMatch(/a bit thin/);
    }
  });

  it('makes a different day each time, from the random source', () => {
    const seen = new Set<string>();
    for (const r of [0, 0.2, 0.4, 0.6, 0.8]) {
      const { app } = toNextMorning('1', 'small', 0, () => r);
      seen.add(JSON.stringify(app.morning.orders));
    }
    expect(seen.size).toBe(5);
  });

  it('is the same day for the same random source', () => {
    const a = toNextMorning('1', 'small', 0, () => 0.3).app;
    const b = toNextMorning('1', 'small', 0, () => 0.3).app;
    expect(a.morning).toEqual(b.morning);
  });

  it('plays day 2 with its own calls, and the road and the result still work', () => {
    const { app, press } = toNextMorning('1');
    const first = toDay().app;
    expect(app.morning.callKinds).toBeDefined();
    playToSupply(app, press);
    expect(app.calls.length).toBeGreaterThan(0);
    expect(app.calls.length).toBe(app.morning.callKinds!.length);
    expect(app.calls.map((c) => c.say)).not.toEqual(first.calls.map((c) => c.say));
  });

  it('plays day 2 again with R: the same day, nothing done, on the messages', () => {
    const { app, press } = toNextMorning('1');
    const orders = JSON.stringify(app.morning.orders);
    const stock = { ...app.morning.stock };
    playToSupply(app, press);
    press('Escape');
    hold(app, 'r');
    expect(app.screen).toBe('messages');
    expect(app.morning.day).toBe(2);
    expect(JSON.stringify(app.morning.orders)).toBe(orders);
    expect(app.morning.stock).toEqual(stock);
    expect(app.desk.unfinishedCount()).toBe(app.morning.orders.length);
    expect(app.growth).toBeNull();
    expect(app.run.day).toBe(2);
  });

  it('plays day 2 again with R from the end of the day, and after a different day-2 draw it is still that day', () => {
    let draws = 0;
    const { app, press } = toNextMorning('1', 'small', 0, () => (draws++ ? 0.7 : 0.1));
    const orders = JSON.stringify(app.morning.orders);
    playToSupply(app, press);
    press('a');
    hold(app, ' ');
    hold(app, 'r');
    expect(JSON.stringify(app.morning.orders)).toBe(orders);
    expect(app.screen).toBe('messages');
  });

  it.each([['b', 'big', 9], ['s', 'small', 2]] as const)('%s starts a new run from the fixed %s morning', (key, id, trucks) => {
    const { app, press } = toNextMorning('1');
    expect(app.morning.day).toBe(2);
    playToSupply(app, press);
    press('Escape');
    holdNewRun(app, key);
    expect(app.morning.day).toBe(1);
    expect(app.run.day).toBe(1);
    expect(app.morning.id).toBe(id);
    expect(app.morning.trucks).toHaveLength(trucks);
    expect(app.run.promises).toEqual([]);
    expect(screen(app).join('\n')).toContain('TUE 14 MAR');
  });

  it('starts the fixed first morning again with R on day 1, as before', () => {
    const { app, press } = toDay();
    press('r');
    expect(app.screen).toBe('day');
    hold(app, 'r');
    expect(app.morning).toEqual(smallMorning());
    expect(app.run.day).toBe(1);
  });

  it('offers both fixed mornings on later days, and the other one on the first', () => {
    const first = toDay();
    expect(screen(first.app).at(-1)).toContain('hold: big');
    expect(screen(first.app).at(-1)).not.toContain('hold: small');
    const { app, press } = toNextMorning('1');
    expect(screen(app).at(-1)).toContain('hold: big / small morning');
    playToSupply(app, press);
    press('Escape');
    expect(app.screen).toBe('result');
    expect(screen(app).at(-1)).toContain('hold: big/small');
    press(' ', 'a');
    hold(app, ' ');
    expect(app.screen).toBe('day');
    expect(screen(app).at(-1)).toContain('hold: big/small');
    press(' ');
    expect(screen(app).at(-1)).toContain('hold: big/small');
  });

  it('shows every screen of day 2 in 120 columns by 30 rows, in both colour schemes', () => {
    const { app, press } = toNextMorning('1', 'small', 0);
    const seen: string[] = [];
    const look = () => {
      seen.push(app.screen);
      screen(app);
      press('F2');
      screen(app);
      press('F2');
    };
    look();
    press(' ');
    look();
    for (let n = 0; n < app.desk.orderCount; n++) {
      const o = app.orderSel;
      for (let l = 0; l < app.desk.order(o).lines.length; l++) press('Enter');
      for (let i = 0; i < 3 && !app.desk.isFinished(o); i++) press('ArrowUp', 'ArrowUp', 'ArrowUp', ...Array((n + i) % 3).fill('ArrowDown'), 'Enter');
    }
    press(' ');
    look();
    hold(app, ' ');
    look();
    for (let n = 0; n < 60 && !app.roadOver; n++) press(app.roadCall ? 'Enter' : ' ');
    press(' ');
    look();
    press(' ', 'a');
    look();
    hold(app, ' ');
    look();
    press(' ');
    look();
    expect(seen).toEqual(['messages', 'desk', 'sheets', 'road', 'result', 'supply', 'day', 'day']);
  });

  it('shows the first screen of day 2: the date, the new stock in the messages and the headings', () => {
    const { app } = toNextMorning('1', 'small', 0);
    const lines = screen(app);
    expect(lines[0]).toContain('OVERNIGHT MESSAGES · day 2');
    expect(lines[0]).toContain('WED 15 MAR  05:31');
    expect(lines.join('\n')).toContain('▶  1');
    expect(lines.at(-1)).toContain('SPACE start the morning');
  });

  it('is not started by ENTER on the messages screen or on a day with nothing chosen', () => {
    const { app, press } = toNextMorning('1');
    press('Enter');
    expect(app.screen).toBe('messages');
    expect(app.morning.day).toBe(2);
  });

  it('keeps day 1 working for a fresh game', () => {
    const app = new App(fakeEffects(), () => {}, 'big');
    expect(app.morning.day).toBe(1);
    expect(app.run.kind).toBe('big');
    expect(screen(app).join('\n')).toContain('TUE 14 MAR');
  });
});
