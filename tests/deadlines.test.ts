import { describe, expect, it } from 'vitest';
import { DEPART_MINUTE, START_MINUTE } from '../src/game/clock';
import { buildDay } from '../src/game/day';
import { Desk } from '../src/game/desk';
import { generateDay } from '../src/game/generate';
import { bigMorning, smallMorning } from '../src/game/morning';
import { mulberry32 } from '../src/game/random';
import { runFromMorning } from '../src/game/run';
import { STOP_MINUTES } from '../src/game/routes';
import { App } from '../src/ui/app';
import { arrivalText } from '../src/ui/format';
import { moneyBlock } from '../src/ui/screens/day';
import { plain } from '../src/ui/grid';
import { fakeEffects, screen, summary } from './helpers';

describe('how many clients ask for a time', () => {
  it('has the hospital and the schools ask on every day, and about three in ten of the others', () => {
    const run = { ...runFromMorning(bigMorning()), day: 2 };
    const always = run.clients.filter((c) => c.before != null).map((c) => c.name);
    expect(always.length).toBeGreaterThan(0);
    const others = run.clients.filter((c) => c.before == null).map((c) => c.name);
    let asked = 0;
    let seen = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const m = generateDay(run, mulberry32(seed));
      for (const o of m.orders) {
        if (always.includes(o.client)) expect(o.before).toBeDefined();
        else if (others.includes(o.client)) {
          seen++;
          if (o.before != null) asked++;
        }
      }
    }
    expect(asked / seen).toBeGreaterThan(0.24);
    expect(asked / seen).toBeLessThan(0.36);
  });
});

describe('when a truck would get there', () => {
  it('reaches a client one square from the depot twenty minutes after leaving, and the next stop at the same place later', () => {
    const m = smallMorning();
    const desk = new Desk(m);
    const rosa = m.orders.findIndex((o) => o.client === "Rosa's");
    expect(desk.arrivalOn(rosa, 1, DEPART_MINUTE)).toBe(DEPART_MINUTE + 20);
    expect(desk.arrivalOn(rosa, 1, DEPART_MINUTE + 15)).toBe(DEPART_MINUTE + 35);
  });

  it('counts the orders already on the truck, but only those with something to deliver', () => {
    const m = smallMorning();
    m.trucks.forEach((t) => (t.capacity = 9999));
    // The first order, which is handed out before Rosa's, goes to the same place.
    m.orders[0]!.place = 'fenwick';
    const desk = new Desk(m);
    const rosa = m.orders.findIndex((o) => o.client === "Rosa's");
    desk.assignTruck(0, 1);
    const alone = desk.arrivalOn(rosa, 1, DEPART_MINUTE)!;
    expect(alone).toBe(DEPART_MINUTE + 20);
    m.orders[0]!.lines.forEach((_, l) => desk.acceptLine(0, l));
    expect(desk.arrivalOn(rosa, 1, DEPART_MINUTE)).toBe(alone + STOP_MINUTES);
    expect(desk.arrivalOn(rosa, 2, DEPART_MINUTE)).toBe(alone);
  });

  it('gives nothing for an order that is finished with nothing given', () => {
    const m = smallMorning();
    const desk = new Desk(m);
    m.orders[0]!.lines.forEach((_, l) => desk.setGive(0, l, 0));
    desk.assignTruck(0, 1);
    desk.finishOrder(0);
    expect(desk.arrivalOn(0, 1, DEPART_MINUTE)).toBeNull();
  });

  it('expects the trucks to leave at 07:00 unless the work still to do runs past it', () => {
    const desk = new Desk(smallMorning());
    expect(desk.projectedDeparture()).toBe(DEPART_MINUTE);
    desk.clock = DEPART_MINUTE - 5;
    // Seven orders each need a truck and a finish: fourteen minutes.
    expect(desk.projectedDeparture()).toBe(DEPART_MINUTE + 9);
    desk.clock = START_MINUTE;
    expect(desk.projectedDeparture()).toBe(DEPART_MINUTE);
  });

  it('reads as the time with a tick when in time, and with the minutes late when not', () => {
    expect(arrivalText(7 * 60 + 20, 9 * 60)).toEqual({ text: '~07:20 ✓', late: false, minutes: 0 });
    expect(arrivalText(9 * 60, 9 * 60).late).toBe(false);
    expect(arrivalText(9 * 60 + 10, 8 * 60)).toEqual({ text: '~09:10 ✗ 70 min late', late: true, minutes: 70 });
    expect(arrivalText(7 * 60 + 20, undefined).text).toBe('~07:20');
  });
});

describe('what a late delivery pays', () => {
  it('shows what coming late took off, and the client\'s story says it paid half', () => {
    const { result, calls, answers, supply, day } = summary(0);
    const o = result.orders.findIndex((x) => x.truckId === 1);
    const late = { ...result, orders: result.orders.map((x, i) => (i === o ? { ...x, before: 7 * 60, arriveAt: 8 * 60, lateForAsk: true } : x)) };
    const later = buildDay(late, calls, answers, supply);
    const order = later.orders[o]!;
    expect(order.cut).toBe(day.orders[o]!.paid - order.paid);
    expect(order.paid).toBe(Math.round(day.orders[o]!.paid / 2));
    expect(later.orders.filter((_, i) => i !== o).every((x) => x.cut === 0)).toBe(true);
    expect(plain(moneyBlock(later)).join('\n')).toContain(`Late, paid half: £${order.cut} less`);
    expect(plain(moneyBlock(day)).join('\n')).not.toContain('Late, paid half');
  });
});

/** The small morning at the order desk with Rosa's, who asks for 09:00, highlighted. */
function atRosa(mutate: (app: App) => void = () => {}) {
  const app = new App(fakeEffects(), () => {}, 'small');
  app.press({ key: ' ' });
  mutate(app);
  app.orderSel = app.desk.morning.orders.findIndex((o) => o.client === "Rosa's");
  return app;
}

describe('the deadlines on the order desk', () => {
  it('shows when the truck under the cursor would reach a client who asked for a time', () => {
    const app = atRosa();
    app.pane = 'trucks';
    const text = screen(app).join('\n');
    expect(text).toContain('DEADLINES');
    expect(text).toContain("Rosa's before 09:00");
    expect(text).toContain('on truck 1: ~07:20 ✓');
  });

  it('flags a client it would reach late, with the minutes', () => {
    const app = atRosa((a) => (a.morning.orders.find((o) => o.client === "Rosa's")!.before = 7 * 60));
    app.pane = 'trucks';
    expect(screen(app).join('\n')).toContain('on truck 1: ~07:20 ✗ 20 min late');
  });

  it('asks for a truck while there is none, and lists the other clients who would be late', () => {
    const app = atRosa();
    app.pane = 'lines';
    expect(screen(app).join('\n')).toContain('pick a truck to see when it gets there');
    const other = app.desk.morning.orders.findIndex((o) => o.client === 'The Anchor');
    app.desk.morning.orders[other]!.before = 7 * 60 + 5;
    app.desk.assignTruck(other, 1);
    expect(screen(app).join('\n')).toMatch(/✗ The Anchor\s+~\d\d:\d\d · \d+ min late/);
    expect(screen(app).join('\n')).toMatch(/1 timed on trucks · 1 late/);
  });

  it('says nothing about deadlines for an order with no time asked, and still fits when there is little room', () => {
    const app = atRosa();
    app.orderSel = app.desk.morning.orders.findIndex((o) => o.client === 'The Anchor');
    app.pane = 'trucks';
    const text = screen(app).join('\n');
    expect(text).toContain('DEADLINES');
    expect(text).not.toContain('on truck 1: ~');
  });
});

/** The small morning with every order handed out in turn onto the first truck with room, on the truck sheets. */
function toSheets(mutate: (app: App) => void = () => {}) {
  const app = new App(fakeEffects(), () => {}, 'small');
  const press = (...keys: string[]) => keys.forEach((key) => app.press({ key }));
  press(' ');
  mutate(app);
  const trucks: Record<string, number> = {
    'Café Lumen': 1, "Rosa's": 2, 'The Anchor': 2, 'Golden Dragon': 1, 'Hotel Bellevue': 1, 'Burger Shack': 1, 'The Plough': 2,
  };
  for (let n = 0; n < 7; n++) {
    const name = app.desk.order(app.orderSel).client;
    for (let l = 0; l < app.desk.order(app.orderSel).lines.length; l++) press('Enter');
    press(...Array(9).fill('ArrowUp'), ...Array(trucks[name]! - 1).fill('ArrowDown'), 'Enter');
  }
  press(' ');
  return { app, press };
}

describe('the deadlines on the truck sheets', () => {
  it('shows each stop with when the truck gets there, and for a client who asked for a time whether that is in time', () => {
    const { app, press } = toSheets();
    press('+');
    const text = screen(app).join('\n');
    expect(text).toMatch(/Rosa's\s+Fenwick\s+\d+ items?\s+before 09:00 · ~\d\d:\d\d ✓/);
    expect(text).toMatch(/Café Lumen\s+Saltmarket\s+\d+ items?\s+~\d\d:\d\d/);
    expect(text).toContain('DEADLINES');
    expect(text).toContain('the one timed client is reached in time.');
  });

  it('flags a late stop in the list, on the truck\'s row and in the line along the bottom', () => {
    const { app, press } = toSheets((a) => (a.morning.orders.find((o) => o.client === "Rosa's")!.before = 7 * 60));
    press('+');
    const lines = screen(app);
    const text = lines.join('\n');
    expect(text).toMatch(/Rosa's\s+Fenwick\s+\d+ items?\s+before 07:00 · ~\d\d:\d\d ✗ \d+ min late/);
    expect(text).toMatch(/DEADLINES\s+1 of 1 timed client would be late and pay half: Rosa's \d+ min/);
    expect(lines.find((l) => l.includes('2 Ana'))).toContain('✗');
    expect(lines.find((l) => l.includes('1 Sam'))).not.toContain('✗');
  });

  it('lists the clients with a time under their place on the route, with a tick or a cross', () => {
    const { app, press } = toSheets();
    press('ArrowDown', 'Enter');
    expect(screen(app).join('\n')).toMatch(/✓ Rosa's\s+before 09:00/);
  });
});
