import { describe, expect, it } from 'vitest';
import { buildDay } from '../src/game/day';
import { growthOptions } from '../src/game/growth';
import {
  canAfford,
  clientPrice,
  dayMoney,
  formatChange,
  formatMoney,
  growthPrice,
  LATE_PAYS,
  orderPay,
  PRICES,
  shortBy,
  STARTING_CASH,
  supplierCost,
  supplierPrice,
  supplierRooms,
  takenIn,
  tripCosts,
  truckCost,
  truckPrice,
  type Units,
} from '../src/game/money';
import { ITEM_LIST, smallMorning } from '../src/game/morning';
import { planRoute } from '../src/game/routes';
import { nextDay, runFromMorning, type DayOutcome } from '../src/game/run';
import { decodeRun, decodeSettings, encodeRun, encodeSettings, SAVE_VERSION } from '../src/game/save';
import { App, RUN_KEY, SETTINGS_KEY } from '../src/ui/app';
import { memoryStore } from '../src/ui/store';
import { screenLines } from '../src/ui/view';
import { DEPART_MINUTE } from '../src/game/clock';
import { fakeEffects, hold, playToSupply, screen, summary, toDay, toNextMorning } from './helpers';

const outcome = (over: Partial<DayOutcome> = {}): DayOutcome => ({ left: {}, ordered: {}, moods: {}, today: {}, promises: [], growth: null, earned: 0, ...over });

/** The text of every piece of the screen drawn in the warning colour. */
const amber = (app: App): string[] => screenLines(app).flatMap((l) => l.filter(([, c]) => c.split(' ').includes('w')).map(([t]) => t));

describe('the prices', () => {
  const room = (kept: 'freezer' | 'fridge' | 'dry') => ITEM_LIST.filter((i) => i.kept === kept).map((i) => i.id);
  const average = (ids: string[], price: (id: string) => number) => ids.reduce((sum, id) => sum + price(id), 0) / ids.length;

  it('give every item its own price, from the supplier and to the restaurants, in the one table', () => {
    expect(Object.keys(PRICES.items).sort()).toEqual(ITEM_LIST.map((i) => i.id).sort());
    for (const item of ITEM_LIST) {
      expect(supplierPrice(item.id)).toBe(PRICES.items[item.id]!.supplier);
      expect(clientPrice(item.id)).toBe(PRICES.items[item.id]!.client);
    }
    expect(() => supplierPrice('moonrock')).toThrow();
  });

  it('keep the freezer dearest and the dry store cheapest, room by room', () => {
    for (const price of [supplierPrice, clientPrice]) {
      expect(average(room('freezer'), price)).toBeGreaterThan(average(room('fridge'), price));
      expect(average(room('fridge'), price)).toBeGreaterThan(average(room('dry'), price));
      const dearestDry = Math.max(...room('dry').map(price));
      for (const id of room('freezer')) expect(price(id)).toBeGreaterThan(dearestDry);
    }
  });

  it('let the items in a room differ', () => {
    expect(supplierPrice('pork')).toBeGreaterThan(supplierPrice('eggs'));
    expect(supplierPrice('chips')).toBeGreaterThan(supplierPrice('peas'));
    expect(supplierPrice('oil')).toBeGreaterThan(supplierPrice('tomatoes'));
    for (const kept of ['freezer', 'fridge', 'dry'] as const) {
      expect(new Set(room(kept).map(supplierPrice)).size).toBeGreaterThan(1);
    }
  });

  it('let a restaurant pay more for a unit than the supplier charges for it', () => {
    for (const item of ITEM_LIST) {
      expect(clientPrice(item.id)).toBeGreaterThan(supplierPrice(item.id));
      expect(supplierPrice(item.id)).toBeGreaterThan(0);
    }
  });

  it('are whole pounds', () => {
    const all = [
      PRICES.startingCash, PRICES.truckDriver, PRICES.truckPerSquare, PRICES.truckPerTruck, PRICES.truckPerClient, PRICES.roomPerClient,
      ...Object.values(PRICES.items).flatMap((p) => [p.supplier, p.client]),
    ];
    for (const price of all) expect(Number.isInteger(price)).toBe(true);
  });
});

describe('writing money down', () => {
  it.each([
    [0, '£0'],
    [7, '£7'],
    [999, '£999'],
    [1000, '£1,000'],
    [1234567, '£1,234,567'],
    [-120, '-£120'],
    [-12345, '-£12,345'],
  ])('writes %i as %s', (amount, text) => {
    expect(formatMoney(amount)).toBe(text);
  });

  it('marks a gain with a plus', () => {
    expect(formatChange(340)).toBe('+£340');
    expect(formatChange(-60)).toBe('-£60');
    expect(formatChange(0)).toBe('£0');
  });
});

const units = (item: string, n: number): Units => ({ item, kept: ITEM_LIST.find((i) => i.id === item)!.kept, units: n });

describe('money in', () => {
  it('is what the restaurants pay for the units that arrive, at the price of each item', () => {
    expect(takenIn([units('chips', 2), units('pork', 3), units('eggs', 4), units('rice', 5)])).toBe(
      2 * clientPrice('chips') + 3 * clientPrice('pork') + 4 * clientPrice('eggs') + 5 * clientPrice('rice'),
    );
    expect(takenIn([])).toBe(0);
  });

  it('is half for an order that came after the time asked, rounded to the pound, and whole for one on time', () => {
    const lines = [units('chips', 2), units('eggs', 3)];
    const full = takenIn(lines);
    expect(LATE_PAYS).toBe(0.5);
    expect(orderPay(lines, false)).toEqual({ paid: full, cut: 0 });
    expect(orderPay(lines, true)).toEqual({ paid: Math.round(full / 2), cut: full - Math.round(full / 2) });
    expect(orderPay([units('eggs', 1)], true)).toEqual({ paid: 4, cut: 3 });
    expect(orderPay([], true)).toEqual({ paid: 0, cut: 0 });
  });

  it('takes what late orders did not pay off the day, and says how much', () => {
    const delivered = [units('chips', 10)];
    const plain = dayMoney(1000, delivered, [], []);
    const cut = dayMoney(1000, delivered, [], [], 60);
    expect(plain.lateCut).toBe(0);
    expect([cut.lateCut, cut.takenIn, cut.total, cut.cash]).toEqual([60, plain.takenIn - 60, plain.total - 60, plain.cash - 60]);
  });

  it('is what the desk gave to the orders that went out on a truck, whatever each restaurant is', () => {
    const { d, day } = summary(0);
    let expected = 0;
    d.morning.orders.forEach((order, o) => {
      if (d.truckFor(o) == null) return;
      order.lines.forEach((line, l) => (expected += (d.given(o, l) ?? 0) * clientPrice(line.item)));
    });
    expect(expected).toBeGreaterThan(0);
    expect(day.money.takenIn).toBe(expected);
  });

  it('is less for a short delivery, by the price of what did not come', () => {
    const full = summary(0).day.money.takenIn;
    const { d, day } = summary(0);
    const o = d.morning.orders.findIndex((x) => x.client === 'Hotel Bellevue');
    const line = d.morning.orders[o]!.lines[0]!;
    const given = d.given(o, 0)!;
    expect(given).toBeGreaterThan(0);
    // The same day with that line cut in half.
    const cut = summary(0);
    cut.d.setGive(o, 0, Math.floor(given / 2));
    const result = cutResult(cut);
    expect(result.money.takenIn).toBe(full - (given - Math.floor(given / 2)) * clientPrice(line.item));
    expect(day.money.takenIn).toBe(full);
  });

  it('pays nothing for an order that was not put on a truck', () => {
    const all = summary(0).day.money.takenIn;
    const left = summary(0, ["Rosa's"]).day.money.takenIn;
    expect(left).toBeLessThan(all);
  });

  it('is the same however late the trucks were for clients who asked for no time', () => {
    const { result, calls, answers, supply, day } = summary(0);
    const late = {
      ...result,
      orders: result.orders.map((o) => (o.arriveAt == null ? o : { ...o, before: null, arriveAt: 23 * 60, lateForAsk: false })),
    };
    expect(buildDay(late, calls, answers, supply).money).toEqual(day.money);
  });

  it('is half for an order that came after the time the client asked for, and nothing is taken off one that came on time', () => {
    const { result, calls, answers, supply, day } = summary(0);
    const lateOrder = result.orders.find((o) => o.arriveAt != null)!;
    const late = {
      ...result,
      orders: result.orders.map((o) => (o === lateOrder ? { ...o, before: 7 * 60, arriveAt: 8 * 60, lateForAsk: true } : o)),
    };
    const money = buildDay(late, calls, answers, supply).money;
    const full = day.orders.find((o) => o.client === lateOrder.client)!.paid;
    expect(money.lateCut).toBe(full - Math.round(full / 2));
    expect(money.takenIn).toBe(day.money.takenIn - money.lateCut);
    expect(money.total).toBe(day.money.total - money.lateCut);
    expect(day.money.lateCut).toBe(0);
  });

  it('is split by client: what each paid adds up to what was taken in, and nothing is paid for an order without a truck', () => {
    const { day, d } = summary(0, ["Rosa's"]);
    expect(day.orders.reduce((sum, o) => sum + o.paid, 0)).toBe(day.money.takenIn);
    expect(day.orders.find((o) => o.client === "Rosa's")!.paid).toBe(0);
    const hotel = day.orders.find((o) => o.client === 'Hotel Bellevue')!;
    const index = d.morning.orders.findIndex((x) => x.client === 'Hotel Bellevue');
    const expected = d.morning.orders[index]!.lines.reduce((sum, line, l) => sum + (d.given(index, l) ?? 0) * clientPrice(line.item), 0);
    expect(hotel.paid).toBe(expected);
  });
});

describe('money out', () => {
  it('is the supplier order, at the supplier price of each item', () => {
    expect(supplierCost([units('chips', 4), units('peas', 2), units('tomatoes', 10)])).toBe(
      4 * supplierPrice('chips') + 2 * supplierPrice('peas') + 10 * supplierPrice('tomatoes'),
    );
    const { day } = summary(0, [], { chips: 5, pork: 3, ketchup: 7 });
    expect(day.money.supplier).toBe(5 * supplierPrice('chips') + 3 * supplierPrice('pork') + 7 * supplierPrice('ketchup'));
  });

  it('prices the items of one room differently, so an order can afford one and not another', () => {
    const pork = supplierCost([units('pork', 10)]);
    const eggs = supplierCost([units('eggs', 10)]);
    expect(pork).toBeGreaterThan(eggs);
    expect(supplierRooms([units('pork', 10), units('eggs', 10), units('chips', 1)])).toEqual({ freezer: supplierPrice('chips'), fridge: pork + eggs, dry: 0 });
  });

  it('is split by room on the summary, and the rooms add up to the order', () => {
    const { day } = summary(0, [], { chips: 5, pork: 3, ketchup: 7 });
    expect(day.money.supplierRooms).toEqual({ freezer: 5 * supplierPrice('chips'), fridge: 3 * supplierPrice('pork'), dry: 7 * supplierPrice('ketchup') });
    expect(Object.values(day.money.supplierRooms).reduce((a, b) => a + b, 0)).toBe(day.money.supplier);
  });
});

describe('what a truck costs', () => {
  it('is a small cost for the driver and a cost for each square driven, and nothing at all for a truck in the yard', () => {
    expect(truckCost(0)).toBe(PRICES.truckDriver);
    expect(truckCost(6)).toBe(PRICES.truckDriver + 6 * PRICES.truckPerSquare);
    expect(truckCost(8) - truckCost(2)).toBe(6 * PRICES.truckPerSquare);
    expect(tripCosts([])).toEqual([]);
  });

  it('is worked out for each truck that went out from the squares its route drives', () => {
    expect(planRoute([{ orderId: 0, place: 'fenwick' }], 420).squares).toBe(2);
    expect(planRoute([{ orderId: 0, place: 'oakley' }], 420).squares).toBe(4);
    expect(planRoute([{ orderId: 0, place: 'saltmarket' }], 420).squares).toBe(0);
    // Millford and Ashby are corners: out to one, along the bottom row to the other and back.
    expect(planRoute([{ orderId: 0, place: 'millford' }, { orderId: 1, place: 'ashby' }], 420).squares).toBe(6);
    const { day, result } = summary(0);
    const out = result.trucks.filter((t) => t.backAt != null);
    expect(out.length).toBe(2);
    expect(day.money.truckTrips.map((t) => [t.truckId, t.squares, t.cost])).toEqual(out.map((t) => [t.truckId, t.squares, truckCost(t.squares)]));
    expect(out.every((t) => t.squares > 0)).toBe(true);
    expect(day.money.squares).toBe(out.reduce((n, t) => n + t.squares, 0));
    expect(day.money.trucksOut).toBe(2);
    expect(day.money.trucks).toBe(out.reduce((sum, t) => sum + truckCost(t.squares), 0));
  });

  it('is more for a truck that drives further', () => {
    const { day } = summary(0);
    const [near, far] = [...day.money.truckTrips].sort((a, b) => a.squares - b.squares);
    expect(far!.squares).toBeGreaterThan(near!.squares);
    expect(far!.cost).toBeGreaterThan(near!.cost);
  });

  it('is on each truck of the summary, and nothing for a truck that stayed in the yard', () => {
    const { day } = summary(0, ["Rosa's", 'The Anchor', 'The Plough']);
    const stayed = day.trucks.filter((t) => t.backAt == null);
    expect(stayed).toHaveLength(1);
    expect(stayed[0]).toMatchObject({ squares: 0, cost: 0 });
    const out = day.trucks.filter((t) => t.backAt != null);
    expect(out).toHaveLength(1);
    expect(out[0]!.cost).toBe(truckCost(out[0]!.squares));
    expect(day.money.trucksOut).toBe(1);
    expect(day.money.trucks).toBe(out[0]!.cost);
  });

  it('is paid for a truck that only goes to the depot, which drives no squares', () => {
    const m = dayMoney(0, [], [], [{ truckId: 1, driver: 'Sam', squares: 0 }]);
    expect(m.trucks).toBe(PRICES.truckDriver);
  });
});

describe("the day's total", () => {
  const trips = [{ truckId: 1, driver: 'Sam', squares: 4 }, { truckId: 2, driver: 'Ana', squares: 6 }];

  it('is what was taken in, less the supplier order and the trucks, and the cash moves by that much', () => {
    const m = dayMoney(1000, [units('chips', 10)], [units('rice', 20)], trips);
    expect(m.takenIn).toBe(10 * clientPrice('chips'));
    expect(m.supplier).toBe(20 * supplierPrice('rice'));
    expect(m.trucks).toBe(truckCost(4) + truckCost(6));
    expect(m.total).toBe(m.takenIn - m.supplier - m.trucks);
    expect(m.before).toBe(1000);
    expect(m.cash).toBe(1000 + m.total);
  });

  it('is the sum of its parts: what each client paid, the supplier order by room and each truck', () => {
    const { day } = summary(0, [], { chips: 5, pork: 3, ketchup: 7 });
    const paid = day.orders.reduce((sum, o) => sum + o.paid, 0);
    const rooms = Object.values(day.money.supplierRooms).reduce((a, b) => a + b, 0);
    const trucks = day.trucks.reduce((sum, t) => sum + t.cost, 0);
    expect(paid).toBe(day.money.takenIn);
    expect(rooms).toBe(day.money.supplier);
    expect(trucks).toBe(day.money.trucks);
    expect(paid - rooms - trucks).toBe(day.money.total);
    expect(day.money.cash).toBe(day.money.before + paid - rooms - trucks);
  });

  it('can be below zero on a day that brings little in', () => {
    const m = dayMoney(1000, [], [units('chips', 50)], trips);
    expect(m.total).toBeLessThan(0);
    expect(m.cash).toBe(1000 + m.total);
  });

  it('is on the end-of-day summary, from the cash the day began with', () => {
    const { result, calls, answers, supply, day } = summary(0);
    expect(day.money.before).toBe(STARTING_CASH);
    expect(day.money.cash).toBe(STARTING_CASH + day.money.total);
    expect(buildDay(result, calls, answers, supply, {}, 250).money).toMatchObject({ before: 250, cash: 250 + day.money.total });
  });

  it('is worked into the next morning as the cash that day starts with', () => {
    const run = runFromMorning(smallMorning());
    expect(run.cash).toBe(STARTING_CASH);
    expect(nextDay(run, outcome({ earned: 340 })).cash).toBe(STARTING_CASH + 340);
    expect(nextDay(run, outcome({ earned: -80 })).cash).toBe(STARTING_CASH - 80);
  });
});

describe('what growing costs', () => {
  it('is a price for a truck and for a room that depends on the size of the business, and nothing for a client', () => {
    const client = { kind: 'client', client: { name: 'The Salt Cellar', place: 'saltmarket', contact: 'Ines', shape: { size: 1 } } } as const;
    expect(growthPrice({ kind: 'truck' }, 7, 3)).toBe(3 * PRICES.truckPerTruck + 7 * PRICES.truckPerClient);
    expect(growthPrice({ kind: 'room', room: 'fridge' }, 7, 3)).toBe(7 * PRICES.roomPerClient);
    expect(growthPrice({ kind: 'room', room: 'fridge' }, 14, 3)).toBe(2 * growthPrice({ kind: 'room', room: 'fridge' }, 7, 3));
    expect(growthPrice(client, 7, 3)).toBe(0);
  });

  it('makes each truck cost more than the one before, and a fleet bigger than the clients need dearer still', () => {
    const prices = Array.from({ length: 12 }, (_, trucks) => truckPrice(10, trucks + 2));
    for (let i = 1; i < prices.length; i++) expect(prices[i]).toBeGreaterThan(prices[i - 1]!);
    expect(truckPrice(10, 20)).toBeGreaterThan(truckPrice(10, 5) * 2);
    expect(truckPrice(20, 5)).toBeGreaterThan(truckPrice(10, 5));
  });

  it('keeps a room\'s price to the clients alone, however many trucks there are', () => {
    expect(growthPrice({ kind: 'room', room: 'dry' }, 12, 2)).toBe(growthPrice({ kind: 'room', room: 'dry' }, 12, 30));
  });

  it('can be afforded with exactly the cash it costs, and not with a pound less', () => {
    expect(canAfford(500, 500)).toBe(true);
    expect(canAfford(499, 500)).toBe(false);
    expect(canAfford(-1, 0)).toBe(true);
    expect(canAfford(-1, 1)).toBe(false);
    expect(canAfford(0, 0)).toBe(true);
  });

  it('is on each option, which is affordable only when the cash covers the price', () => {
    const { day } = summary(0);
    const client = { name: 'The Salt Cellar', place: 'saltmarket', contact: 'Ines', shape: { size: 1 } } as const;
    const business = runFromMorning(smallMorning());
    const options = growthOptions(day, client, business);
    expect(options.map((o) => o.price)).toEqual([truckPrice(7, 2), 7 * PRICES.roomPerClient, 0]);
    expect(options.every((o) => o.affordable)).toBe(true);
    const poor = growthOptions({ ...day, money: { ...day.money, cash: 100 } }, client, business);
    expect(poor.map((o) => o.affordable)).toEqual([false, false, true]);
  });

  it('is taken from the cash when the choice is confirmed, and given back by U or BACKSPACE, to the pound', () => {
    const { app, press } = toDay();
    const before = app.day!.money.cash;
    const price = app.growthOptions[0]!.price;
    expect(price).toBeGreaterThan(0);
    expect(app.cash).toBe(before);
    press(' ', '1', 'Enter');
    expect(app.cash).toBe(before - price);
    expect(app.status).toContain(formatMoney(price));
    press('u');
    expect(app.growth).toBeNull();
    expect(app.cash).toBe(before);
    expect(app.status).toContain(formatMoney(price));
    press('2', 'Enter');
    expect(app.cash).toBe(before - app.growthOptions[1]!.price);
    press('Backspace');
    expect(app.cash).toBe(before);
    press('1', 'Enter', 'u', '1', 'Enter', 'u');
    expect(app.cash).toBe(before);
    expect(app.run.cash).toBe(STARTING_CASH);
  });

  it('shows the price on each option, the cash in the header, and the money paid once chosen', () => {
    const { app, press } = toDay();
    press(' ');
    const text = screen(app).join('\n');
    expect(text).toContain(`CASH ${formatMoney(app.cash)}`);
    for (const o of app.growthOptions) expect(text).toContain(o.price > 0 ? formatMoney(o.price) : 'free');
    const before = app.cash;
    press('Enter');
    const chosen = screen(app).join('\n');
    expect(chosen).toContain(`CASH ${formatMoney(before - app.growthOptions[0]!.price)}`);
    expect(chosen).toContain(`${formatMoney(app.growthOptions[0]!.price)} paid`);
    press('u');
    expect(screen(app).join('\n')).toContain(`CASH ${formatMoney(before)}`);
  });

  it('is final once the next morning starts: the next day begins with the cash that is left', () => {
    const { app, press } = toDay();
    const before = app.day!.money.cash;
    const price = app.growthOptions[1]!.price;
    press(' ', '2', 'Enter');
    hold(app, ' ');
    expect(app.run.day).toBe(2);
    expect(app.run.cash).toBe(before - price);
    expect(app.cash).toBe(before - price);
  });

  it('costs nothing for a new client, who is always on offer', () => {
    const { app, press } = toDay();
    const before = app.day!.money.cash;
    press(' ', '3', 'Enter');
    hold(app, ' ');
    expect(app.run.cash).toBe(before);
    expect(app.run.clients).toHaveLength(8);
  });
});

describe('growth that cannot be afforded', () => {
  it('is still listed, dim, with the reason, but cannot be picked', () => {
    const { app, press } = toDay(0, 'big');
    const [truck, room, client] = app.growthOptions;
    expect(app.day!.money.cash).toBeLessThan(truck!.price);
    expect([truck!.affordable, room!.affordable, client!.affordable]).toEqual([false, false, true]);
    press(' ');
    const text = screen(app).join('\n');
    expect(text).toContain(truck!.title);
    expect(text).toContain(room!.title);
    expect(text.match(/Not enough money yet/g)).toHaveLength(2);
    expect(screenLines(app).filter((l) => l.map(([t]) => t).join('').includes(truck!.title)).flat().every(([, c]) => !c.split(' ').includes('hl'))).toBe(true);
    press('Enter');
    expect(app.growth).toBeNull();
    expect(app.status).toBe('Not enough money yet.');
    expect(app.tone).toBe('warn');
    press('2', 'Enter');
    expect(app.growth).toBeNull();
    expect(app.cash).toBe(app.day!.money.cash);
  });

  it('leaves the pointer free to move over it, and the free client can still be picked', () => {
    const { app, press } = toDay(0, 'big');
    press(' ', '1');
    expect(app.growthSel).toBe(0);
    press('3', 'Enter');
    expect(app.growth?.kind).toBe('client');
    hold(app, ' ');
    expect(app.run.day).toBe(2);
  });

  it('can be afforded to the pound', () => {
    const { app } = toDay();
    const price = app.growthOptions[0]!.price;
    const total = app.day!.money.total;
    const exact = toDay(0, 'small', ['a'], [], undefined, undefined, price - total);
    expect(exact.app.day!.money.cash).toBe(price);
    exact.press(' ', '1', 'Enter');
    expect(exact.app.growth).toEqual({ kind: 'truck' });
    expect(exact.app.cash).toBe(0);
    const short = toDay(0, 'small', ['a'], [], undefined, undefined, price - total - 1);
    short.press(' ', '1', 'Enter');
    expect(short.app.growth).toBeNull();
    expect(short.app.status).toBe('Not enough money yet.');
  });
});

describe('cash below zero', () => {
  /** A day that ends in debt: nine hundred and ninety-nine of the first three items ordered from the supplier. */
  const broke = () => toDay(0, 'small', ['9', '9', '9']);

  it('is allowed, and shown in amber on the end of the day and the growth screen', () => {
    const { app, press } = broke();
    expect(app.day!.money.total).toBeLessThan(0);
    expect(app.cash).toBeLessThan(0);
    expect(app.screen).toBe('day');
    const negative = formatMoney(app.day!.money.cash);
    expect(negative.startsWith('-£')).toBe(true);
    expect(amber(app).some((t) => t.includes(negative))).toBe(true);
    expect(amber(app).some((t) => t.includes(formatChange(app.day!.money.total)))).toBe(true);
    press(' ');
    expect(amber(app).some((t) => t.includes(negative))).toBe(true);
    expect(screen(app).join('\n')).toContain(`CASH ${negative}`);
  });

  it('does not stop play: a free client can still be taken on, the next morning starts and the day plays on', () => {
    const { app, press } = broke();
    const cash = app.cash;
    press(' ');
    expect(app.growthOptions.map((o) => o.affordable)).toEqual([false, false, true]);
    press('3', 'Enter');
    hold(app, ' ');
    expect(app.run.day).toBe(2);
    expect(app.run.cash).toBe(cash);
    press(' ');
    expect(app.screen).toBe('desk');
    const negative = formatMoney(cash);
    expect(screen(app).join('\n')).toContain(`CASH ${negative}`);
    expect(amber(app)).toContain(negative);
    playToSupply(app, press);
    expect(app.screen).toBe('supply');
  });

  it('is not amber while the cash is in the black', () => {
    const { app } = toDay();
    expect(app.cash).toBeGreaterThan(0);
    expect(amber(app).some((t) => t.includes('£'))).toBe(false);
  });
});

describe('cash on the order desk', () => {
  it('shows in the header from the first morning, from the starting cash, in both colour schemes', () => {
    const app = new App(fakeEffects(), () => {}, 'small');
    app.press({ key: ' ' });
    expect(app.screen).toBe('desk');
    for (const blue of [false, true]) {
      if (app.blue !== blue) app.press({ key: 'F2' });
      expect(screen(app)[0]).toContain(`CASH ${formatMoney(STARTING_CASH)}`);
    }
  });

  it('shows each morning the cash that morning began with', () => {
    const { app, press } = toNextMorning('3');
    press(' ');
    expect(app.screen).toBe('desk');
    expect(screen(app)[0]).toContain(`CASH ${formatMoney(app.run.cash)}`);
    expect(app.run.cash).toBeGreaterThan(STARTING_CASH);
  });

  it('is the cash the day began with when the day is played again', () => {
    const { app, press } = toDay();
    const began = app.run.cash;
    hold(app, 'r');
    press(' ');
    expect(screen(app)[0]).toContain(`CASH ${formatMoney(began)}`);
  });
});

describe('cash in the save', () => {
  it('is kept with the run, above zero and below it', () => {
    for (const cash of [0, 1, STARTING_CASH, 123456, -1, -4321]) {
      const run = { ...runFromMorning(smallMorning()), cash };
      expect(decodeRun(encodeRun(run, 0))?.run.cash).toBe(cash);
    }
  });

  it('is saved when the next morning starts, with what the growth cost', () => {
    const store = memoryStore();
    const { app } = toNextMorning('1', 'small', 0, () => 0.37, store);
    const saved = decodeRun(store.data.get(RUN_KEY) ?? '');
    expect(saved?.run.cash).toBe(app.run.cash);
    expect(app.run.cash).not.toBe(STARTING_CASH);
  });

  it('is carried on with when the saved run is continued', () => {
    const store = memoryStore();
    const first = toNextMorning('3', 'small', 0, () => 0.37, store);
    const cash = first.app.run.cash;
    const again = new App(fakeEffects([], () => 0.9, store), () => {}, 'small');
    expect(again.screen).toBe('start');
    again.press({ key: 'c' });
    expect(again.run.cash).toBe(cash);
    again.press({ key: ' ' });
    expect(screen(again)[0]).toContain(`CASH ${formatMoney(cash)}`);
  });

  it('starts from the starting cash with a save from before there was any money', () => {
    const run = { ...runFromMorning(smallMorning()), day: 3, cash: 99999 } as Record<string, unknown>;
    delete run.cash;
    const old = JSON.stringify({ version: 1, daySeed: 12, run });
    const decoded = decodeRun(old);
    expect(decoded?.run.cash).toBe(STARTING_CASH);
    expect(decoded?.run.day).toBe(3);
    expect(decoded?.daySeed).toBe(12);
  });

  it('is the starting cash for an older save even if it carries a number of its own', () => {
    const old = JSON.stringify({ version: 1, daySeed: 0, run: { ...runFromMorning(smallMorning()), cash: 5 } });
    expect(decodeRun(old)?.run.cash).toBe(STARTING_CASH);
  });

  it('loads an older saved run into the game with the starting cash, and saves it again in the new version', () => {
    const run = { ...runFromMorning(smallMorning()), day: 2 } as Record<string, unknown>;
    delete run.cash;
    const store = memoryStore({ [RUN_KEY]: JSON.stringify({ version: 1, daySeed: 5, run }) });
    const app = new App(fakeEffects([], () => 0.9, store), () => {}, 'small');
    expect(app.screen).toBe('start');
    app.press({ key: 'c' });
    expect(app.run.day).toBe(2);
    expect(app.run.cash).toBe(STARTING_CASH);
    app.press({ key: ' ' });
    expect(screen(app)[0]).toContain(`CASH ${formatMoney(STARTING_CASH)}`);
    app.loadMorning('small');
    expect(JSON.parse(store.data.get(RUN_KEY) ?? '{}').version).toBe(SAVE_VERSION);
    expect(JSON.parse(store.data.get(RUN_KEY) ?? '{}').run.cash).toBe(STARTING_CASH);
  });

  it('writes the new version, which the old one was not', () => {
    expect(SAVE_VERSION).toBe(6);
    expect(JSON.parse(encodeRun(runFromMorning(smallMorning()), 0)).version).toBe(6);
  });

  it.each([
    ['no cash', undefined],
    ['cash in words', '1000'],
    ['cash that is not whole', 10.5],
    ['cash beyond a billion', 2e9],
    ['cash that is missing a number', null],
  ])('does not read a new save with %s', (_, cash) => {
    const text = JSON.stringify({ version: 2, daySeed: 0, run: { ...runFromMorning(smallMorning()), cash } });
    expect(decodeRun(text)).toBeNull();
  });

  it('keeps the colours and the sound from before the new version', () => {
    expect(decodeSettings(JSON.stringify({ version: 1, blue: true, soundOn: false }))).toEqual({ blue: true, soundOn: false });
    expect(decodeSettings(encodeSettings({ blue: false, soundOn: true }))).toEqual({ blue: false, soundOn: true });
    const store = memoryStore({ [SETTINGS_KEY]: JSON.stringify({ version: 1, blue: true, soundOn: true }) });
    expect(new App(fakeEffects([], () => 0.9, store), () => {}, 'small').blue).toBe(true);
  });
});

/** The text of the row for an item on the supplier order screen. */
const rowFor = (app: App, name: string): string => screen(app).find((l) => l.includes(name)) ?? '';

/** A new game played to the supplier order, with the cash the day began with replaced by `cash`. */
function atSupply(cash?: number, morning: 'small' | 'big' = 'small') {
  const app = new App(fakeEffects(), () => {}, morning);
  if (cash != null) app.run.cash = cash;
  const press = (...keys: string[]) => keys.forEach((key) => app.press({ key }));
  playToSupply(app, press);
  expect(app.screen).toBe('supply');
  return { app, press };
}

/** Moves the highlight on the supplier order screen to the row of an item. */
function goTo(app: App, press: (...keys: string[]) => void, item: string): number {
  const r = app.supply!.rows.findIndex((row) => row.item.id === item);
  press(...Array(app.supply!.count).fill('ArrowUp'), ...Array(r).fill('ArrowDown'));
  expect(app.supplySel).toBe(r);
  return r;
}

describe('the price of each row on the supplier order', () => {
  it('shows the unit price of every item and what its amount costs', () => {
    const { app, press } = atSupply();
    const supply = app.supply!;
    for (const row of supply.rows) expect(rowFor(app, row.item.name)).toContain(formatMoney(supplierPrice(row.item.id)));
    const r = goTo(app, press, 'pork');
    press('1', '2');
    expect(supply.cost(r)).toBe(12 * supplierPrice('pork'));
    const line = rowFor(app, supply.rows[r]!.item.name);
    expect(line).toContain(formatMoney(supplierPrice('pork')));
    expect(line).toContain('[ 12_]');
    expect(line).toContain(formatMoney(12 * supplierPrice('pork')));
    press('Enter');
    expect(rowFor(app, supply.rows[r]!.item.name)).toContain(formatMoney(12 * supplierPrice('pork')));
  });

  it('shows a dash for a row with nothing ordered', () => {
    const { app } = atSupply();
    expect(rowFor(app, 'Tomatoes, tin')).toMatch(/ —\s{2}/);
    expect(app.supply!.totalCost()).toBe(0);
  });

  it('keeps a running total that follows typing, nudging, backspace, U and A', () => {
    const { app, press } = atSupply();
    const supply = app.supply!;
    const total = () => screen(app).join('\n').match(/Order costs +(-?£[\d,]+)/)?.[1];
    expect(total()).toBe('£0');
    const chips = goTo(app, press, 'chips');
    press('4');
    expect(total()).toBe(formatMoney(4 * supplierPrice('chips')));
    press('0');
    expect(total()).toBe(formatMoney(40 * supplierPrice('chips')));
    press('Backspace');
    expect(total()).toBe(formatMoney(4 * supplierPrice('chips')));
    press('ArrowRight');
    expect(total()).toBe(formatMoney(5 * supplierPrice('chips')));
    press('ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft');
    expect(total()).toBe('£0');
    press('u');
    expect(supply.amount(chips)).toBe(supply.gap(chips));
    expect(total()).toBe(formatMoney(supply.gap(chips) * supplierPrice('chips')));
    press('a');
    const expected = supply.rows.reduce((sum, row, r) => sum + supply.amount(r) * supplierPrice(row.item.id), 0);
    expect(expected).toBeGreaterThan(supply.gap(chips) * supplierPrice('chips'));
    expect(total()).toBe(formatMoney(expected));
    expect(supply.totalCost()).toBe(expected);
  });

  it('adds up the rows: the order costs the sum of amount times price', () => {
    const { app } = atSupply();
    const supply = app.supply!;
    supply.fillAll();
    expect(supply.totalCost()).toBe(supply.rows.reduce((sum, _, r) => sum + supply.cost(r), 0));
    expect(supply.totalCost()).toBe(supply.ordered().reduce((sum, o) => sum + o.amount * supplierPrice(o.item.id), 0));
    expect(supplierCost(supply.ordered().map((o) => ({ item: o.item.id, kept: o.item.kept, units: o.amount })))).toBe(supply.totalCost());
  });

  it('puts an item that costs a lot beside one that costs little: the same amount of each costs differently', () => {
    const { app, press } = atSupply();
    const supply = app.supply!;
    const pork = goTo(app, press, 'pork');
    press('5');
    const eggs = goTo(app, press, 'eggs');
    press('5');
    expect(supply.cost(pork)).toBeGreaterThan(supply.cost(eggs));
  });
});

describe('the cash and what is left of it on the supplier order', () => {
  const money = (app: App) => {
    const text = screen(app).join('\n');
    const get = (label: string) => text.match(new RegExp(`${label} +(-?£[\\d,]+)`))?.[1];
    return { cost: get('Order costs'), now: get('Cash now'), after: get('Cash after'), text };
  };

  it('shows the cash now and the cash after the order, which follow the amounts as they are typed', () => {
    const { app, press } = atSupply();
    const supply = app.supply!;
    const now = app.cash;
    expect(money(app)).toMatchObject({ cost: '£0', now: formatMoney(now), after: formatMoney(now) });
    goTo(app, press, 'pork');
    press('3', '0');
    expect(money(app)).toMatchObject({ cost: formatMoney(30 * supplierPrice('pork')), now: formatMoney(now), after: formatMoney(now - 30 * supplierPrice('pork')) });
    press('a');
    expect(money(app).after).toBe(formatMoney(now - supply.totalCost()));
  });

  it('counts what the restaurants paid and the trucks cost today, so the cash now is what is really in the bank', () => {
    const { app } = atSupply();
    const result = app.result!;
    const paid = takenIn(result.orders.flatMap((o) => o.delivered.map((d) => units(d.item, d.units))));
    const trucks = tripCosts(result.trucks.filter((t) => t.backAt != null)).reduce((sum, t) => sum + t.cost, 0);
    expect(app.run.cash).toBe(STARTING_CASH);
    expect(app.cash).toBe(STARTING_CASH + paid - trucks);
    expect(app.morningMoney()).toEqual({ takenIn: paid, lateCut: 0, trucks });
    // Placing the order takes only the order off it: the day's total is the same as the cash change.
    app.supply!.fillAll();
    const after = app.cash - app.supply!.totalCost();
    hold(app, ' ');
    expect(app.day!.money.cash).toBe(after);
    expect(app.cash).toBe(after);
  });

  it('is explained on the result: what the restaurants paid and what the trucks cost, the same as in the header', () => {
    const app = new App(fakeEffects(), () => {}, 'small');
    const press = (...keys: string[]) => keys.forEach((key) => app.press({ key }));
    playToSupply(app, press);
    app.press({ key: 'Escape' });
    expect(app.screen).toBe('result');
    const { takenIn: paid, trucks } = app.morningMoney();
    expect(screen(app).join('\n')).toContain(`restaurants paid ${formatMoney(paid)}, trucks cost ${formatMoney(trucks)}`);
    expect(screen(app)[0]).toContain(`CASH ${formatMoney(STARTING_CASH + paid - trucks)}`);
  });

  it('says nothing about being short while the cash covers the order', () => {
    const { app, press } = atSupply();
    press('a');
    expect(app.supply!.shortfall(app.cash)).toBe(0);
    const { text } = money(app);
    expect(text).not.toContain('short');
    expect(amber(app).some((text) => text.includes('£'))).toBe(false);
  });

  it('shows the cash after in amber, with a line saying how short, when the order takes the cash below zero', () => {
    const { app, press } = atSupply();
    const supply = app.supply!;
    goTo(app, press, 'chips');
    press('9', '9', '9');
    const short = supply.totalCost() - app.cash;
    expect(short).toBeGreaterThan(0);
    expect(supply.shortfall(app.cash)).toBe(short);
    const { text, after } = money(app);
    expect(after).toBe(formatMoney(-short));
    expect(text).toContain(`This order leaves you ${formatMoney(short)} short.`);
    expect(amber(app).some((text) => text.includes(formatMoney(-short)))).toBe(true);
    expect(screenLines(app).some((l) => l.some(([t, c]) => t.includes('short') && c.split(' ').includes('w')))).toBe(true);
    // Taking some of it back makes the warning go away again.
    press('Backspace', 'Backspace', 'Backspace');
    expect(money(app).text).not.toContain('short');
  });

  it('is exactly zero short when the cash after is zero, and one pound short when it is a pound below', () => {
    const { app, press } = atSupply();
    const supply = app.supply!;
    goTo(app, press, 'ketchup');
    press('5');
    const cost = supply.totalCost();
    app.run.cash += cost - app.cash;
    expect(app.cash).toBe(cost);
    expect(supply.shortfall(app.cash)).toBe(0);
    expect(money(app).text).not.toContain('short');
    app.run.cash -= 1;
    expect(supply.shortfall(app.cash)).toBe(1);
    expect(money(app).text).toContain('This order leaves you £1 short.');
  });

  it('still lets the order be placed when it is short: the cash goes below zero', () => {
    const { app, press } = atSupply();
    goTo(app, press, 'chips');
    press('9', '9', '9');
    const after = app.cash - app.supply!.totalCost();
    expect(after).toBeLessThan(0);
    hold(app, ' ');
    expect(app.screen).toBe('day');
    expect(app.cash).toBe(after);
  });

  it('is in amber when the cash is already below zero, and a short line only for an order that costs something', () => {
    const { app, press } = atSupply(-2000);
    expect(app.cash).toBeLessThan(0);
    expect(app.supply!.shortfall(app.cash)).toBe(0);
    expect(money(app).text).not.toContain('short');
    expect(amber(app).some((text) => text.includes(formatMoney(app.cash)))).toBe(true);
    goTo(app, press, 'ketchup');
    press('1');
    expect(money(app).text).toContain(`This order leaves you ${formatMoney(app.supply!.totalCost() - app.cash)} short.`);
  });

  it('fits 120 columns by 30 rows with the biggest order, in both colour schemes', () => {
    const { app, press } = atSupply(undefined, 'big');
    press('a');
    for (const blue of [false, true]) {
      if (app.blue !== blue) press('F2');
      screen(app);
    }
    goTo(app, press, 'chips');
    press('9', '9', '9');
    screen(app);
    app.supply!.rows.forEach((_, r) => app.supply!.set(r, 999));
    const text = screen(app).join('\n');
    expect(text).toContain('short');
  });
});

describe('the cash in the header', () => {
  const header = (app: App) => screen(app)[0]!;

  it('is on every screen of the day, from the overnight messages to the growth choice', () => {
    const app = new App(fakeEffects(), () => {}, 'small');
    const press = (...keys: string[]) => keys.forEach((key) => app.press({ key }));
    const seen: string[] = [];
    const check = () => {
      seen.push(app.screen === 'day' && app.growthOpen ? 'growth' : app.screen);
      expect(header(app)).toContain(`CASH ${formatMoney(app.cash)}`);
    };
    check();
    press(' ');
    check();
    playToSupply(app, press);
    check();
    press('a');
    hold(app, ' ');
    check();
    press(' ');
    check();
    expect(seen).toEqual(['messages', 'desk', 'supply', 'day', 'growth']);
  });

  it('is on the truck sheets, the road and the result as well', () => {
    const app = new App(fakeEffects(), () => {}, 'small');
    const press = (...keys: string[]) => keys.forEach((key) => app.press({ key }));
    press(' ');
    for (let n = 0; n < app.desk.orderCount; n++) {
      const o = app.orderSel;
      for (let l = 0; l < app.desk.order(o).lines.length; l++) press('Enter');
      for (let i = 0; i < 2 && !app.desk.isFinished(o); i++) press('ArrowUp', 'ArrowUp', ...Array((n + i) % 2).fill('ArrowDown'), 'Enter');
    }
    press(' ');
    expect(app.screen).toBe('sheets');
    expect(header(app)).toContain(`CASH ${formatMoney(STARTING_CASH)}`);
    hold(app, ' ');
    expect(app.screen).toBe('road');
    expect(header(app)).toContain(`CASH ${formatMoney(STARTING_CASH)}`);
    for (let n = 0; n < 60 && !app.roadOver; n++) press(...(app.roadCall ? ['Enter'] : [' ']));
    press(' ');
    expect(app.screen).toBe('result');
    expect(header(app)).toContain(`CASH ${formatMoney(app.cash)}`);
    expect(app.cash).not.toBe(STARTING_CASH);
  });

  it('is in amber below zero on every one of those screens, and in both colour schemes', () => {
    const app = new App(fakeEffects(), () => {}, 'small');
    app.run.cash = -250;
    const press = (...keys: string[]) => keys.forEach((key) => app.press({ key }));
    for (const blue of [false, true]) {
      if (app.blue !== blue) press('F2');
      expect(header(app)).toContain('CASH -£250');
      expect(amber(app)).toContain('-£250');
    }
    press(' ');
    expect(header(app)).toContain('CASH -£250');
    expect(amber(app)).toContain('-£250');
  });

  it('shows a long run of debt in full in the header', () => {
    const app = new App(fakeEffects(), () => {}, 'small');
    app.run.cash = -12345;
    expect(header(app)).toContain('CASH -£12,345');
  });
});

describe('the truck sheets', () => {
  it('show how far each truck drives and what that costs, and what sending them all costs', () => {
    const app = new App(fakeEffects(), () => {}, 'small');
    const press = (...keys: string[]) => keys.forEach((key) => app.press({ key }));
    press(' ');
    for (let n = 0; n < app.desk.orderCount; n++) {
      const o = app.orderSel;
      for (let l = 0; l < app.desk.order(o).lines.length; l++) press('Enter');
      for (let i = 0; i < 2 && !app.desk.isFinished(o); i++) press('ArrowUp', 'ArrowUp', ...Array((n + i) % 2).fill('ArrowDown'), 'Enter');
    }
    press(' ');
    const text = screen(app).join('\n');
    expect(text).toContain('SQ');
    expect(text).toContain('COST');
    let all = 0;
    for (const t of app.desk.morning.trucks) {
      const route = app.desk.routeOf(t.id, DEPART_MINUTE);
      expect(route.squares).toBeGreaterThan(0);
      all += truckCost(route.squares);
      const row = screen(app).find((l) => l.includes(` ${t.id} ${t.driver}`))!;
      expect(row).toContain(`${route.squares}${formatMoney(truckCost(route.squares)).padStart(6)}`);
    }
    expect(text).toContain(`Sending these trucks costs ${formatMoney(all)}`);
    press('Enter');
    const open = screen(app).join('\n');
    const route = app.desk.routeOf(1, DEPART_MINUTE);
    expect(open).toContain(`${route.squares} squares driven`);
    expect(open).toContain(`${formatMoney(PRICES.truckDriver)} driver + ${formatMoney(route.squares * PRICES.truckPerSquare)} road`);
    expect(open).toContain(`costs ${formatMoney(truckCost(route.squares))}`);
  });

  it('show a truck with nothing loaded without a distance or a cost', () => {
    const app = new App(fakeEffects(), () => {}, 'small');
    app.press({ key: ' ' });
    app.press({ key: ' ' });
    const row = screen(app).find((l) => l.includes(' 1 '))!;
    expect(row).toContain('not used');
    expect(row).toMatch(/0 +— +— +—/);
  });
});

describe('the end-of-day breakdown', () => {
  it('lists what was taken in, the supplier order with its rooms, the trucks with their distance and cost, the total and the cash', () => {
    const { app } = toDay(0, 'small', ['a']);
    const day = app.day!;
    const text = screen(app).join('\n');
    expect(text).toMatch(new RegExp(`Taken in +${formatMoney(day.money.takenIn)}`));
    expect(text).toMatch(new RegExp(`Supplier order +${formatMoney(-day.money.supplier)}`));
    expect(text).toMatch(new RegExp(`Trucks \\(2 out\\) +${formatMoney(-day.money.trucks)}`));
    expect(text).toContain(`${day.money.squares} squares driven`);
    expect(text).toMatch(new RegExp(`Today +${formatChange(day.money.total).replace('+', '\\+')}`));
    expect(text).toMatch(new RegExp(`Cash now +${formatMoney(day.money.cash)}`));
    for (const [kept, label] of [['freezer', 'freezer'], ['fridge', 'fridge'], ['dry', 'dry store']] as const) {
      expect(text).toContain(`${label} ${formatMoney(day.money.supplierRooms[kept])}`);
    }
    for (const t of day.trucks) {
      const row = screen(app).find((l) => l.includes(` ${t.truckId} ${t.driver}`) && l.includes('back'))!;
      expect(row).toContain(formatMoney(t.cost));
      expect(row).toContain(`${t.squares} squares`);
    }
  });

  it('adds up: the parts shown are the day total, and the day total moves the cash', () => {
    const { app } = toDay(0, 'small', ['a']);
    const { money, orders, trucks } = app.day!;
    const paid = orders.reduce((sum, o) => sum + o.paid, 0);
    const rooms = Object.values(money.supplierRooms).reduce((a, b) => a + b, 0);
    const out = trucks.reduce((sum, t) => sum + t.cost, 0);
    expect(paid).toBe(money.takenIn);
    expect(rooms).toBe(money.supplier);
    expect(out).toBe(money.trucks);
    expect(paid - rooms - out).toBe(money.total);
    expect(money.before + money.total).toBe(money.cash);
    expect(app.cash).toBe(money.cash);
  });

  it("says what the highlighted client paid in the story under the list, for each client in turn", () => {
    const { app, press } = toDay(0, 'small', ['a']);
    const day = app.day!;
    for (let i = 0; i < day.orders.length; i++) {
      expect(screen(app).join('\n')).toContain(`They paid ${formatMoney(day.orders[i]!.paid)} for what arrived.`);
      press('ArrowDown');
    }
  });

  it('says so when a client paid nothing because the order had no truck', () => {
    const app = new App(fakeEffects(), () => {}, 'small');
    const press = (...keys: string[]) => keys.forEach((key) => app.press({ key }));
    press(' ');
    // Hand out every order but the first, which is left without a truck.
    for (let n = 0; n < app.desk.orderCount; n++) {
      const o = app.orderSel;
      for (let l = 0; l < app.desk.order(o).lines.length; l++) press('Enter');
      if (n === 0) {
        app.desk.finishOrder(o);
        app.orderSel = app.desk.nextUnfinished(o);
        continue;
      }
      for (let i = 0; i < 2 && !app.desk.isFinished(o); i++) press('ArrowUp', 'ArrowUp', ...Array((n + i) % 2).fill('ArrowDown'), 'Enter');
    }
    press(' ');
    hold(app, ' ');
    for (let n = 0; n < 60 && !app.roadOver; n++) press(...(app.roadCall ? ['Enter'] : [' ']));
    press(' ', ' ', 'a');
    hold(app, ' ');
    expect(app.screen).toBe('day');
    const first = app.day!.orders.findIndex((o) => o.truckId == null);
    expect(first).toBeGreaterThanOrEqual(0);
    press(...Array(first).fill('ArrowDown'));
    expect(screen(app).join('\n')).toContain('They paid nothing: no truck took the order.');
  });

  it('keeps the whole screen in view with nine trucks and every call, and lists the three rooms and the money', () => {
    for (const day of [1, 2]) {
      const { app, press } = toDay(0, 'big');
      if (day === 2) {
        press(' ', '3', 'Enter');
        hold(app, ' ');
        press(' ');
        playToSupply(app, press);
        press(' ', 'a');
        hold(app, ' ');
      }
      expect(app.screen).toBe('day');
      const text = screen(app).join('\n');
      for (const room of ['FREEZER', 'FRIDGE', 'DRY STORE']) expect(text).toMatch(new RegExp(`${room} +\\d+% full tomorrow`));
      for (const word of ['MONEY', 'Taken in', 'Supplier order', `Trucks (${app.day!.trucks.filter((t) => t.backAt != null).length} out)`, 'Cash now', 'squares driven', "TOMORROW'S ORDER"]) expect(text).toContain(word);
      for (const t of app.day!.trucks.filter((x) => x.backAt != null)) expect(text).toContain(formatMoney(t.cost));
    }
  });
});

describe('saves from before the prices of each item', () => {
  it('still load: the saved run holds no prices, so an older save is read as before', () => {
    expect(SAVE_VERSION).toBe(6);
    const run = { ...runFromMorning(smallMorning()), day: 4, cash: 1888 };
    const text = JSON.stringify({ version: 2, daySeed: 99, run });
    const decoded = decodeRun(text);
    expect(decoded?.run.cash).toBe(1888);
    expect(decoded?.run.day).toBe(4);
    expect(decoded?.daySeed).toBe(99);
    expect(Object.keys(JSON.parse(text).run)).not.toContain('prices');
  });

  it('continues a saved day with the new prices and the cash it was saved with', () => {
    const run = { ...runFromMorning(smallMorning()), day: 3, cash: 1500 };
    const store = memoryStore({ [RUN_KEY]: JSON.stringify({ version: 2, daySeed: 5, run }) });
    const app = new App(fakeEffects([], () => 0.9, store), () => {}, 'small');
    app.press({ key: 'c' });
    app.press({ key: ' ' });
    expect(app.run.cash).toBe(1500);
    expect(screen(app)[0]).toContain('CASH £1,500');
    const press = (...keys: string[]) => keys.forEach((key) => app.press({ key }));
    playToSupply(app, press);
    expect(app.screen).toBe('supply');
    press('a');
    expect(screen(app).join('\n')).toContain('Order costs');
    expect(app.supply!.totalCost()).toBeGreaterThan(0);
  });
});

describe('shortBy', () => {
  it('is how far below zero paying leaves the cash', () => {
    expect(shortBy(100, 50)).toBe(0);
    expect(shortBy(100, 100)).toBe(0);
    expect(shortBy(100, 220)).toBe(120);
    expect(shortBy(-30, 20)).toBe(50);
  });
});

describe('the balance', () => {
  /**
   * Plays days in a row the plain way: every order on a truck as asked, the supplier order filled up to the usual
   * amounts, and a new client each evening so that nothing is spent. With `weak`, every second order is left without a
   * truck. Returns the money of each day.
   */
  function play(morning: 'small' | 'big', days: number, weak = false) {
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const app = new App(fakeEffects([], random), () => {}, morning);
    const press = (...keys: string[]) => keys.forEach((key) => app.press({ key }));
    const out: Array<{ money: ReturnType<typeof dayMoney> }> = [];
    for (let day = 1; day <= days; day++) {
      if (weak) {
        const trucks = app.morning.trucks.length;
        press(' ');
        for (let n = 0; n < app.desk.orderCount; n++) {
          const o = app.orderSel;
          for (let l = 0; l < app.desk.order(o).lines.length; l++) press('Enter');
          if (n % 2 === 0) for (let i = 0; i < trucks && !app.desk.isFinished(o); i++) press(...Array(trucks).fill('ArrowUp'), ...Array((n + i) % trucks).fill('ArrowDown'), 'Enter');
          else app.desk.finishOrder(o);
          app.orderSel = app.desk.nextUnfinished(o);
        }
        press(' ');
        hold(app, ' ');
        for (let n = 0; n < 60 && !app.roadOver; n++) press(...(app.roadCall ? ['Enter'] : [' ']));
        press(' ', ' ');
      } else {
        playToSupply(app, press);
      }
      press('a');
      hold(app, ' ');
      out.push({ money: app.day!.money });
      press(' ', '3', 'Enter');
      hold(app, ' ');
    }
    return out;
  }

  it('lets a weak day, with every second order left without a truck, earn well under a good one', () => {
    const good = play('small', 3);
    const weak = play('small', 3, true);
    weak.forEach(({ money }, i) => {
      expect(money.takenIn).toBeLessThan(good[i]!.money.takenIn);
      expect(money.total).toBeLessThan(good[i]!.money.total);
    });
  });

  it('lets a day end in debt when far too much is ordered from the supplier', () => {
    const { app } = toDay(0, 'small', ['9', '9', '9']);
    expect(app.day!.money.total).toBeLessThan(-STARTING_CASH);
  });
});

/** The end-of-day summary for a played summary whose desk was changed afterwards. */
function cutResult(played: ReturnType<typeof summary>) {
  const { d, calls, answers, supply } = played;
  const result = {
    ...played.result,
    orders: played.result.orders.map((o) => ({
      ...o,
      delivered: d.order(o.orderIndex).lines.map((line, l) => ({ item: line.item, units: o.truckId == null ? 0 : (d.given(o.orderIndex, l) ?? 0) })),
    })),
  };
  return buildDay(result, calls, answers, supply);
}
