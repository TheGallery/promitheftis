import { describe, expect, it } from 'vitest';
import { buildCalls } from '../src/game/calls';
import { DEPART_MINUTE } from '../src/game/clock';
import { buildDay } from '../src/game/day';
import { Desk } from '../src/game/desk';
import { smallMorning } from '../src/game/morning';
import { moodFacts, moodOf, moodPoints, moodReasons, promiseOutcome, type MoodFacts } from '../src/game/moods';
import { buildResult } from '../src/game/results';
import { buildRoad } from '../src/game/road';
import { decodeRun, encodeRun, SAVE_VERSION } from '../src/game/save';
import { runFromMorning, type Promised } from '../src/game/run';
import { stockAfterDeliveries, Supply } from '../src/game/supply';
import { App } from '../src/ui/app';
import { memoryStore } from '../src/ui/store';
import { fakeEffects, handOut, hold, playToSupply, screen, SMALL_TRUCKS, toNextMorning } from './helpers';

const callText = (app: App) =>
  screen(app)
    .map((row) => [...row].slice(0, 80).join('').trim())
    .filter(Boolean)
    .join(' ');

const facts = (over: Partial<MoodFacts> = {}): MoodFacts => ({ percent: 100, late: false, shortCall: null, ...over });

function smallDay() {
  const d = new Desk(smallMorning());
  for (const [client, truck] of Object.entries(SMALL_TRUCKS)) handOut(d, client, truck);
  const result = buildResult(d, DEPART_MINUTE);
  const road = buildRoad(d, result);
  return { d, result, calls: buildCalls(d, result, road) };
}

/** The small morning played on the keys as far as the trucks leaving, and then the road one step at a time. */
function onTheRoad() {
  const app = new App(fakeEffects(), () => {}, 'small');
  const press = (...keys: string[]) => keys.forEach((key) => app.press({ key }));
  press(' ');
  for (let n = 0; n < 7; n++) {
    const name = app.desk.order(app.orderSel).client;
    for (let l = 0; l < app.desk.order(app.orderSel).lines.length; l++) press('Enter');
    press(...Array(9).fill('ArrowUp'), ...Array((SMALL_TRUCKS[name] as number) - 1).fill('ArrowDown'), 'Enter');
  }
  press(' ');
  hold(app, ' ');
  return { app, press };
}

describe('a call about an item shows the stock', () => {
  it('knows what is left in the store and what the usual order would bring, for the short and the forgot calls only', () => {
    const { d, calls } = smallDay();
    const left = stockAfterDeliveries(d);
    expect(calls.some((c) => c.item)).toBe(true);
    for (const c of calls) {
      if (c.kind === 'time') {
        expect(c.inStore).toBeUndefined();
        expect(c.usualOrder).toBeUndefined();
        continue;
      }
      expect(c.inStore).toBe(left[c.item!]);
      expect(c.usualOrder).toBe(Math.max(0, d.morning.usual[c.item!]! - left[c.item!]!));
    }
  });

  it('puts it in the call box while the phone rings, with what promising means', () => {
    const { app, press } = onTheRoad();
    let seen = 0;
    for (let n = 0; n < 60 && !app.roadOver; n++) {
      const call = app.roadCall;
      if (!call) {
        press(' ');
        continue;
      }
      const text = screen(app).join('\n');
      if (call.kind === 'time') expect(text).not.toContain('In stock:');
      else {
        seen++;
        expect(text).toContain(`In stock: ${call.inStore} `);
        const flowing = callText(app);
        expect(flowing).toContain(`The usual order brings ${call.usualOrder} more, enough for the usual orders only.`);
        expect(flowing).toContain(`To keep this promise, order ${call.qty} more than usual tomorrow.`);
      }
      press('Enter');
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('adds up what is already promised for the same item', () => {
    const { app, press } = onTheRoad();
    for (let n = 0; n < 60 && !(app.roadCall && app.roadCall.item); n++) press(app.roadCall ? 'Enter' : ' ');
    const ringing = app.roadCall!;
    app.calls = [...app.calls, { ...ringing, id: 99, qty: 3, client: 'Elsewhere' }];
    app.answers.set(99, 0);
    expect(callText(app)).toContain(`3 already promised for tomorrow. To keep this promise too, order ${3 + ringing.qty!} more than usual tomorrow.`);
  });
});

describe('a promise is checked the next morning', () => {
  const order = (over: Partial<ReturnType<typeof smallDay>['result']['orders'][number]> = {}) => ({
    ...smallDay().result.orders[0]!,
    client: 'Rosa\'s',
    truckId: 1,
    percent: 100,
    shortLines: [],
    ...over,
  });
  const promised: Promised[] = [{ client: "Rosa's", item: 'peas', qty: 4 }];

  it('has nothing to check for a client who was promised nothing', () => {
    expect(promiseOutcome(order(), [])).toBeNull();
    expect(promiseOutcome(order(), [{ client: 'Another', item: 'peas', qty: 4 }])).toBeNull();
  });

  it('is kept when the promised item comes in full, whatever else is short', () => {
    expect(promiseOutcome(order(), promised)).toBe('kept');
    expect(promiseOutcome(order({ percent: 80, shortLines: [{ item: 'pork', asked: 5, given: 2 }] }), promised)).toBe('kept');
  });

  it('is broken when the promised item is short, or the order got no truck', () => {
    expect(promiseOutcome(order({ percent: 80, shortLines: [{ item: 'peas', asked: 9, given: 5 }] }), promised)).toBe('broken');
    expect(promiseOutcome(order({ truckId: null, percent: 0 }), promised)).toBe('broken');
  });

  it('leaves a client pleased when it is kept, as before', () => {
    expect(moodPoints(facts({ promise: 'kept' }))).toBe(moodPoints(facts()));
    expect(moodOf(facts({ promise: 'kept' }))).toBe('pleased');
    expect(moodReasons(facts({ promise: 'kept' }))).toContain('got what was promised on the phone');
  });

  it('costs one more point when it is broken, and the story says the promise was broken', () => {
    const short = { percent: 80, shortBefore: true };
    expect(moodPoints(facts({ ...short, promise: 'broken' }))).toBe(moodPoints(facts(short)) + 1);
    expect(moodReasons(facts({ ...short, promise: 'broken' })).join(' ')).toContain('the promise was broken');
  });

  it('is worse than being told "sorry, nothing more today", added up over the two days', () => {
    // Refused: let down on the day, then the item is not on the order, so tomorrow is a full delivery.
    const refused = moodPoints(facts({ percent: 80, shortCall: 'refused' })) + moodPoints(facts());
    // Promised and broken: pleased on the day, then short of the promised item again, and the promise gone.
    const broken =
      moodPoints(facts({ percent: 80, shortCall: 'promised' })) + moodPoints(facts({ percent: 80, shortBefore: true, promise: 'broken' }));
    expect(broken).toBeGreaterThan(refused);
    // Kept, it is the best of the three.
    const kept = moodPoints(facts({ percent: 80, shortCall: 'promised' })) + moodPoints(facts({ promise: 'kept' }));
    expect(kept).toBeLessThan(refused);
  });

  it('leaves the refusal as it was: one point on the day, and nothing to check later', () => {
    expect(moodPoints(facts({ percent: 80, shortCall: 'refused' }))).toBe(moodPoints(facts({ percent: 80 })) + 1);
    expect(moodOf(facts({ percent: 80, shortCall: 'refused' }))).toBe('let down');
    expect(promiseOutcome(order(), [])).toBeNull();
  });

  it('is read from the day\'s result into the mood and the story of the client', () => {
    const { result, calls } = smallDay();
    const shortOrder = result.orders.find((o) => o.shortLines.length > 0)!;
    const item = shortOrder.shortLines[0]!.item;
    const supply = (d: Desk) => new Supply(d.morning, stockAfterDeliveries(d));
    const d = new Desk(smallMorning());
    const broken = buildDay(result, calls, new Map(), supply(d), {}, 1000, [{ client: shortOrder.client, item, qty: 2 }]);
    const mine = broken.orders[shortOrder.orderIndex]!;
    expect(mine.reasons.join(' ')).toContain('the promise was broken');
    const plain = buildDay(result, calls, new Map(), supply(d));
    expect(moodPoints(moodFacts(shortOrder, [], new Map(), undefined, [{ client: shortOrder.client, item, qty: 2 }]))).toBe(
      moodPoints(moodFacts(shortOrder, [], new Map())) + 1,
    );
    expect(plain.orders[shortOrder.orderIndex]!.reasons.join(' ')).not.toContain('promise');
    const fine = result.orders.find((o) => o.shortLines.length === 0 && o.truckId != null)!;
    const kept = buildDay(result, calls, new Map(), supply(d), {}, 1000, [{ client: fine.client, item: 'chips', qty: 2 }]);
    expect(kept.orders[fine.orderIndex]!.reasons.join(' ')).toContain('got what was promised');
  });
});

describe('a promise through the whole game', () => {
  function secondDay(stock: number) {
    const { app, press } = toNextMorning('1', 'small', 0);
    expect(app.run.promises.length).toBeGreaterThan(0);
    for (const p of app.run.promises) app.morning.stock[p.item] = stock;
    playToSupply(app, press);
    press('a');
    hold(app, ' ');
    expect(app.screen).toBe('day');
    return app;
  }

  it('is broken, and the client let down, when the promised item has run out', () => {
    const app = secondDay(0);
    for (const p of app.run.promises) {
      const mine = app.day!.orders.find((o) => o.client === p.client)!;
      expect(mine.reasons.join(' ')).toContain('the promise was broken');
      expect(mine.mood).not.toBe('pleased');
    }
  });

  it('is kept when there is plenty, and nothing about it is held against the client', () => {
    const app = secondDay(999);
    for (const p of app.run.promises) {
      const mine = app.day!.orders.find((o) => o.client === p.client)!;
      expect(mine.reasons.join(' ')).toContain('got what was promised');
      expect(mine.reasons.join(' ')).not.toContain('broken');
    }
  });

  it('shows on the supplier order who was promised what, so it can be ordered', () => {
    const { app, press } = toNextMorning('1', 'small', 0);
    expect(app.run.promises.length).toBeGreaterThan(0);
    playToSupply(app, press);
    const text = screen(app).join('\n');
    expect(text).toContain('SUPPLIER ORDER');
    const first = app.supply!.rows.findIndex((r) => app.supply!.notes.has(r.item.id));
    if (first >= 0) {
      for (let i = 0; i < first; i++) press('ArrowDown');
      expect(screen(app).join('\n')).toContain('promised for tomorrow');
    }
  });
});

describe('a saved run from before', () => {
  it('still loads with its promises, and the promises are checked the morning they come due', () => {
    expect(SAVE_VERSION).toBe(4);
    const run = {
      ...runFromMorning(smallMorning()),
      day: 2,
      promises: [{ client: 'Café Lumen', item: 'peas', qty: 4 }],
      ahead: [{ client: "Rosa's", event: 'halfterm' as const }],
    };
    const { spoiled, ahead, ...before } = run;
    const text = JSON.stringify({ version: 2, daySeed: 7, run: before });
    // A save from before the rooms could spoil stock has nothing spoiled and nothing announced.
    expect(decodeRun(text)).toEqual({ run: { ...before, spoiled: [], ahead: [] }, daySeed: 7 });
    expect(spoiled).toEqual([]);
    expect(ahead.length).toBeGreaterThan(0);
    expect(decodeRun(encodeRun(run, 7))?.run.promises).toEqual(run.promises);
    const store = memoryStore({ 'promitheftis.run': text });
    const app = new App(fakeEffects([], () => 0, store), () => {}, 'small');
    expect(app.screen).toBe('start');
  });
});
