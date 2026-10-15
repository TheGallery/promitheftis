import { describe, expect, it } from 'vitest';
import { buildDay } from '../src/game/day';
import { growthOptions } from '../src/game/growth';
import {
  canAfford,
  dayMoney,
  formatChange,
  formatMoney,
  growthPrice,
  PRICES,
  STARTING_CASH,
  supplierCost,
  takenIn,
  truckCost,
} from '../src/game/money';
import { smallMorning } from '../src/game/morning';
import { nextDay, runFromMorning, type DayOutcome } from '../src/game/run';
import { decodeRun, decodeSettings, encodeRun, encodeSettings, SAVE_VERSION } from '../src/game/save';
import { App, RUN_KEY, SETTINGS_KEY } from '../src/ui/app';
import { memoryStore } from '../src/ui/store';
import { screenLines } from '../src/ui/view';
import { fakeEffects, playToSupply, screen, summary, toDay, toNextMorning } from './helpers';

const outcome = (over: Partial<DayOutcome> = {}): DayOutcome => ({ left: {}, ordered: {}, moods: {}, today: {}, promises: [], growth: null, earned: 0, ...over });

/** The text of every piece of the screen drawn in the warning colour. */
const amber = (app: App): string[] => screenLines(app).flatMap((l) => l.filter(([, c]) => c.split(' ').includes('w')).map(([t]) => t));

describe('the prices', () => {
  it('make the freezer dearest and the dry store cheapest, from the supplier and to the restaurants', () => {
    for (const price of [PRICES.supplierPerUnit, PRICES.clientPerUnit]) {
      expect(price.freezer).toBeGreaterThan(price.fridge);
      expect(price.fridge).toBeGreaterThan(price.dry);
      expect(price.dry).toBeGreaterThan(0);
    }
  });

  it('let a restaurant pay more for a unit than the supplier charges for it', () => {
    for (const kept of ['freezer', 'fridge', 'dry'] as const) expect(PRICES.clientPerUnit[kept]).toBeGreaterThan(PRICES.supplierPerUnit[kept]);
  });

  it('are whole pounds', () => {
    const all = [PRICES.startingCash, PRICES.truckPerDay, PRICES.truckPerClient, PRICES.roomPerClient, ...Object.values(PRICES.supplierPerUnit), ...Object.values(PRICES.clientPerUnit)];
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

describe('money in', () => {
  it('is what the restaurants pay for the units that arrive, at the price of the room they come from', () => {
    expect(takenIn([{ kept: 'freezer', units: 2 }, { kept: 'fridge', units: 3 }, { kept: 'dry', units: 5 }])).toBe(
      2 * PRICES.clientPerUnit.freezer + 3 * PRICES.clientPerUnit.fridge + 5 * PRICES.clientPerUnit.dry,
    );
    expect(takenIn([])).toBe(0);
  });

  it('is what the desk gave to the orders that went out on a truck, whatever each restaurant is', () => {
    const { d, day } = summary(0);
    let expected = 0;
    d.morning.orders.forEach((order, o) => {
      if (d.truckFor(o) == null) return;
      order.lines.forEach((line, l) => (expected += (d.given(o, l) ?? 0) * PRICES.clientPerUnit[d.item(line.item).kept]));
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
    expect(result.money.takenIn).toBe(full - (given - Math.floor(given / 2)) * PRICES.clientPerUnit[d.item(line.item).kept]);
    expect(day.money.takenIn).toBe(full);
  });

  it('pays nothing for an order that was not put on a truck', () => {
    const all = summary(0).day.money.takenIn;
    const left = summary(0, ["Rosa's"]).day.money.takenIn;
    expect(left).toBeLessThan(all);
  });

  it('is the same however late the trucks were', () => {
    const { result, calls, answers, supply, day } = summary(0);
    const late = {
      ...result,
      orders: result.orders.map((o) => (o.arriveAt == null ? o : { ...o, arriveAt: 23 * 60, lateForAsk: true })),
    };
    expect(buildDay(late, calls, answers, supply).money).toEqual(day.money);
  });
});

describe('money out', () => {
  it('is the supplier order, at the supplier price of each room', () => {
    expect(supplierCost([{ kept: 'freezer', units: 4 }, { kept: 'fridge', units: 2 }, { kept: 'dry', units: 10 }])).toBe(
      4 * PRICES.supplierPerUnit.freezer + 2 * PRICES.supplierPerUnit.fridge + 10 * PRICES.supplierPerUnit.dry,
    );
    const { day } = summary(0, [], { chips: 5, pork: 3, ketchup: 7 });
    expect(day.money.supplier).toBe(5 * PRICES.supplierPerUnit.freezer + 3 * PRICES.supplierPerUnit.fridge + 7 * PRICES.supplierPerUnit.dry);
  });

  it('is a flat cost for every truck that went out', () => {
    expect(truckCost(0)).toBe(0);
    expect(truckCost(3)).toBe(3 * PRICES.truckPerDay);
    const { day } = summary(0);
    expect(day.money.trucksOut).toBe(2);
    expect(day.money.trucks).toBe(2 * PRICES.truckPerDay);
  });

  it('costs nothing for a truck that stayed in the yard', () => {
    const { day } = summary(0, ["Rosa's", 'The Anchor', 'The Plough']);
    expect(day.trucks.filter((t) => t.backAt == null)).toHaveLength(1);
    expect(day.money.trucksOut).toBe(1);
    expect(day.money.trucks).toBe(PRICES.truckPerDay);
  });
});

describe("the day's total", () => {
  it('is what was taken in, less the supplier order and the trucks, and the cash moves by that much', () => {
    const m = dayMoney(1000, [{ kept: 'freezer', units: 10 }], [{ kept: 'dry', units: 20 }], 2);
    expect(m.takenIn).toBe(10 * PRICES.clientPerUnit.freezer);
    expect(m.supplier).toBe(20 * PRICES.supplierPerUnit.dry);
    expect(m.trucks).toBe(2 * PRICES.truckPerDay);
    expect(m.total).toBe(m.takenIn - m.supplier - m.trucks);
    expect(m.before).toBe(1000);
    expect(m.cash).toBe(1000 + m.total);
  });

  it('can be below zero on a day that brings little in', () => {
    const m = dayMoney(1000, [], [{ kept: 'freezer', units: 50 }], 2);
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
    const client = { kind: 'client', client: { name: 'The Salt Cellar', place: 'saltmarket', contact: 'Ines' } } as const;
    expect(growthPrice({ kind: 'truck' }, 7)).toBe(7 * PRICES.truckPerClient);
    expect(growthPrice({ kind: 'room', room: 'fridge' }, 7)).toBe(7 * PRICES.roomPerClient);
    expect(growthPrice({ kind: 'truck' }, 14)).toBe(2 * growthPrice({ kind: 'truck' }, 7));
    expect(growthPrice(client, 7)).toBe(0);
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
    const client = { name: 'The Salt Cellar', place: 'saltmarket', contact: 'Ines' } as const;
    const options = growthOptions(day, client, 7);
    expect(options.map((o) => o.price)).toEqual([7 * PRICES.truckPerClient, 7 * PRICES.roomPerClient, 0]);
    expect(options.every((o) => o.affordable)).toBe(true);
    const poor = growthOptions({ ...day, money: { ...day.money, cash: 100 } }, client, 7);
    expect(poor.map((o) => o.affordable)).toEqual([false, false, true]);
  });

  it('is taken from the cash when the choice is confirmed, and given back by U or BACKSPACE, to the pound', () => {
    const { app, press } = toDay();
    const before = app.day!.money.cash;
    const price = app.growthOptions[0]!.price;
    expect(price).toBeGreaterThan(0);
    expect(app.cash).toBe(before);
    press('Enter', '1', 'Enter');
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
    press('Enter');
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
    press('Enter', '2', 'Enter', 'Enter');
    expect(app.run.day).toBe(2);
    expect(app.run.cash).toBe(before - price);
    expect(app.cash).toBe(before - price);
  });

  it('costs nothing for a new client, who is always on offer', () => {
    const { app, press } = toDay();
    const before = app.day!.money.cash;
    press('Enter', '3', 'Enter', 'Enter');
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
    press('Enter');
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
    press('Enter', '1');
    expect(app.growthSel).toBe(0);
    press('3', 'Enter');
    expect(app.growth?.kind).toBe('client');
    press('Enter');
    expect(app.run.day).toBe(2);
  });

  it('can be afforded to the pound', () => {
    const { app } = toDay();
    const price = app.growthOptions[0]!.price;
    const total = app.day!.money.total;
    const exact = toDay(0, 'small', ['a'], [], undefined, undefined, price - total);
    expect(exact.app.day!.money.cash).toBe(price);
    exact.press('Enter', '1', 'Enter');
    expect(exact.app.growth).toEqual({ kind: 'truck' });
    expect(exact.app.cash).toBe(0);
    const short = toDay(0, 'small', ['a'], [], undefined, undefined, price - total - 1);
    short.press('Enter', '1', 'Enter');
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
    press('Enter');
    expect(amber(app).some((t) => t.includes(negative))).toBe(true);
    expect(screen(app).join('\n')).toContain(`CASH ${negative}`);
  });

  it('does not stop play: a free client can still be taken on, the next morning starts and the day plays on', () => {
    const { app, press } = broke();
    const cash = app.cash;
    press('Enter');
    expect(app.growthOptions.map((o) => o.affordable)).toEqual([false, false, true]);
    press('3', 'Enter', 'Enter');
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
    press('r', ' ');
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
    expect(SAVE_VERSION).toBe(2);
    expect(JSON.parse(encodeRun(runFromMorning(smallMorning()), 0)).version).toBe(2);
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

describe('the balance', () => {
  /**
   * Plays days in a row as a careful player would: every order on a truck as asked, the supplier order filled up to the
   * usual amounts, and a new client each evening so that nothing is spent. With `weak`, every second order is
   * left without a truck. Returns the money of each day with what a truck would have cost that morning.
   */
  function play(morning: 'small' | 'big', days: number, weak = false) {
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const app = new App(fakeEffects([], random), () => {}, morning);
    const press = (...keys: string[]) => keys.forEach((key) => app.press({ key }));
    const out: Array<{ money: ReturnType<typeof dayMoney>; truck: number; room: number }> = [];
    for (let day = 1; day <= days; day++) {
      const clients = app.run.clients.length;
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
        press('F10', 'F10', 'F9');
        for (let n = 0; n < 60 && !app.roadOver; n++) press(...(app.roadCall ? ['Enter'] : [' ']));
        press('Enter', 'Enter');
      } else {
        playToSupply(app, press);
      }
      press('a', 'F9');
      out.push({ money: app.day!.money, truck: growthPrice({ kind: 'truck' }, clients), room: growthPrice({ kind: 'room', room: 'dry' }, clients) });
      press('Enter', '3', 'Enter', 'Enter');
    }
    return out;
  }

  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

  it.each([['small', 8], ['big', 5]] as const)('ends every good day on the %s morning in profit', (morning, days) => {
    for (const { money } of play(morning, days)) expect(money.total).toBeGreaterThan(0);
  });

  it.each([['small', 8], ['big', 5]] as const)('makes a truck and a room cost about two or three good days on the %s morning', (morning, days) => {
    const later = play(morning, days).slice(1);
    for (const price of ['truck', 'room'] as const) {
      const inDays = median(later.map((d) => d[price] / d.money.total));
      expect(inDays).toBeGreaterThanOrEqual(1.5);
      expect(inDays).toBeLessThanOrEqual(3);
    }
  });

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
