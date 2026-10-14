import { describe, expect, it } from 'vitest';
import { Desk } from '../src/game/desk';
import { bigMorning, smallMorning } from '../src/game/morning';
import { callNotes, KEPT_ORDER, stockAfterDeliveries, Supply } from '../src/game/supply';
import { ROAD_TICK_MS } from '../src/game/road';
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

/** The small morning with every order handed out, except the clients named, who get no truck. */
function smallDesk(leaveOut: string[] = []) {
  const d = new Desk(smallMorning());
  for (const [client, truck] of Object.entries(SMALL_TRUCKS)) {
    if (leaveOut.includes(client)) {
      const o = d.morning.orders.findIndex((x) => x.client === client);
      d.morning.orders[o]!.lines.forEach((_, l) => d.acceptLine(o, l));
    } else handOut(d, client, truck);
  }
  return d;
}

describe('stock after the deliveries', () => {
  it('is the morning stock less what the delivering orders were given', () => {
    const d = smallDesk();
    const left = stockAfterDeliveries(d);
    for (const item of d.morning.items) {
      let given = 0;
      d.morning.orders.forEach((order, o) =>
        order.lines.forEach((line, l) => {
          if (line.item === item.id) given += d.given(o, l) ?? 0;
        }),
      );
      expect(left[item.id]).toBe((d.morning.stock[item.id] ?? 0) - given);
    }
    // Ketchup ran short this morning, so none is left.
    expect(left.ketchup).toBe(0);
  });

  it('does not count what was given on an order that has no truck', () => {
    const all = stockAfterDeliveries(smallDesk());
    const without = stockAfterDeliveries(smallDesk(['The Anchor']));
    // The Anchor asked for 6 chips, 12 pork, 4 potatoes, 3 ketchup and 2 gravy.
    expect((without.pork ?? 0) - (all.pork ?? 0)).toBe(12);
    expect((without.gravy ?? 0) - (all.gravy ?? 0)).toBe(2);
  });
});

describe('the supplier order', () => {
  function supply() {
    const d = smallDesk();
    return new Supply(d.morning, stockAfterDeliveries(d));
  }

  it('lists every item once, grouped freezer, fridge, dry store', () => {
    for (const morning of [smallMorning(), bigMorning()]) {
      const s = new Supply(morning, morning.stock);
      expect(s.rows).toHaveLength(morning.items.length);
      const rooms = s.rows.map((r) => r.kept);
      expect(rooms).toEqual([...rooms].sort((a, b) => KEPT_ORDER.indexOf(a) - KEPT_ORDER.indexOf(b)));
      expect(new Set(rooms)).toEqual(new Set(KEPT_ORDER));
      for (const item of morning.items) expect(morning.usual[item.id]).toBeGreaterThan(0);
    }
  });

  it('starts at nothing and keeps an amount between 0 and 999', () => {
    const s = supply();
    expect(s.total()).toBe(0);
    expect(s.nudge(0, -1)).toBe(0);
    expect(s.set(0, 5)).toBe(5);
    expect(s.nudge(0, 1)).toBe(6);
    expect(s.set(0, 5000)).toBe(999);
  });

  it('fills a row up to the usual amount, and not past it', () => {
    const s = supply();
    const r = s.rows.findIndex((row) => row.item.id === 'pork');
    const row = s.rows[r]!;
    expect(s.fillRow(r)).toBe(row.usual - row.onHand);
    const full = s.rows.findIndex((x) => x.onHand >= x.usual);
    if (full !== -1) expect(s.fillRow(full)).toBe(0);
  });

  it('fills every row at once', () => {
    const s = supply();
    s.fillAll();
    s.rows.forEach((row, r) => expect(s.amount(r)).toBe(Math.max(0, row.usual - row.onHand)));
  });
});

function fakeEffects(): Effects {
  return {
    cue: () => {},
    print: () => 100,
    later: (fn, ms) => (ms === ROAD_TICK_MS ? undefined : fn()),
    toggleSound: () => true,
    now: (() => {
      let t = 0;
      return () => (t += 1000);
    })(),
  };
}

/** Plays the small morning to the result screen, answering every call with the given option. */
function toResult(answer = 0, morning: 'small' | 'big' = 'small') {
  const app = new App(fakeEffects(), () => {}, morning);
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
  press('Enter');
  return { app, press };
}

function screen(app: App): string[] {
  const lines = plain(screenLines(app));
  expect(lines).toHaveLength(ROWS);
  for (const l of lines) expect([...l]).toHaveLength(COLS);
  return lines;
}

const rowOf = (lines: string[], word: string) => lines.find((l) => l.includes(word)) ?? '';

describe('the supplier ordering screen', () => {
  it('is reached with ENTER from the result and shows each item with its room, stock and usual amount', () => {
    const { app, press } = toResult();
    expect(app.screen).toBe('result');
    expect(screen(app).join('\n')).toContain('ENTER supplier order');
    press('Enter');
    expect(app.screen).toBe('supply');
    const lines = screen(app);
    const text = lines.join('\n');
    expect(text).toContain('SUPPLIER ORDER');
    expect(text).toContain('13:00');
    for (const room of ['FREEZER', 'FRIDGE', 'DRY STORE']) expect(text).toContain(room);
    expect(text.indexOf('FREEZER')).toBeLessThan(text.indexOf('FRIDGE'));
    expect(text.indexOf('FRIDGE')).toBeLessThan(text.indexOf('DRY STORE'));
    const left = stockAfterDeliveries(app.desk);
    for (const item of app.morning.items) {
      const row = rowOf(lines, item.name);
      expect(row).toContain(item.name);
      expect(row).toContain(`${String(left[item.id]).padStart(9)}${String(app.morning.usual[item.id]).padStart(8)}`);
    }
  });

  it('types an amount, nudges it with the arrows, and ENTER confirms the row and moves on', () => {
    const { app, press } = toResult();
    press('Enter');
    press('1', '2');
    expect(app.supply!.amount(0)).toBe(12);
    expect(rowOf(screen(app), app.supply!.rows[0]!.item.name)).toContain('[ 12_]');
    press('Backspace');
    expect(app.supply!.amount(0)).toBe(1);
    press('ArrowRight', 'ArrowRight', 'ArrowLeft');
    expect(app.supply!.amount(0)).toBe(2);
    press('ArrowLeft', 'ArrowLeft', 'ArrowLeft');
    expect(app.supply!.amount(0)).toBe(0);
    press('7', 'Enter');
    expect(app.supply!.amount(0)).toBe(7);
    expect(app.supplySel).toBe(1);
    expect(app.supply!.isConfirmed(0)).toBe(true);
    press('5');
    expect(app.supply!.amount(1)).toBe(5);
    press('ArrowUp');
    expect(app.supplySel).toBe(0);
  });

  it('fills the highlighted row with U and every row with A', () => {
    const { app, press } = toResult();
    press('Enter', 'ArrowDown', 'u');
    const s = app.supply!;
    expect(s.amount(0)).toBe(0);
    expect(s.amount(1)).toBe(s.gap(1));
    press('a');
    s.rows.forEach((row, r) => expect(s.amount(r)).toBe(Math.max(0, row.usual - row.onHand)));
    expect(screen(app).join('\n')).toContain('U fill row');
    expect(screen(app).join('\n')).toContain('A fill all');
  });

  it('puts a note on the rows whose calls were answered with "add it to tomorrow\'s order"', () => {
    const { app, press } = toResult(0);
    press('Enter');
    const lines = screen(app);
    const noted = app.calls.filter((c) => c.item && c.options[0]?.addsToOrder);
    expect(noted.length).toBeGreaterThan(0);
    for (const call of noted) {
      const name = app.morning.items.find((i) => i.id === call.item)!.name;
      const row = rowOf(lines, name);
      expect(row).toContain(call.client);
      expect(row).toContain("add it to tomorrow's order");
    }
    const withNote = lines.filter((l) => l.includes("add it to tomorrow's order"));
    expect(withNote).toHaveLength(new Set(noted.map((c) => c.item)).size);
  });

  it('leaves the supplier screen without amounts, and the result screen shows them', () => {
    const { app, press } = toResult(0);
    const text = screen(app).join('\n');
    for (const call of app.calls.filter((c) => c.qty != null)) expect(text).toContain(`added ${call.qty} to tomorrow`);
    press('Enter');
    const supplier = screen(app).join('\n');
    expect(supplier).not.toContain('PROMISED');
    expect(supplier).not.toContain('promised');
    expect(supplier).not.toMatch(/added \d+ to tomorrow/);
  });

  it('keeps the amounts typed when going back to the result screen and in again', () => {
    const { app, press } = toResult(0);
    press('Enter', '5', 'ArrowDown', '7', 'Escape');
    expect(app.screen).toBe('result');
    press('Enter');
    expect(app.supply!.amount(0)).toBe(5);
    expect(app.supply!.amount(1)).toBe(7);
  });

  it('shows no notes when every call was answered "not today"', () => {
    const { app, press } = toResult(1);
    press('Enter');
    expect(screen(app).join('\n')).not.toContain('rang:');
    expect(callNotes(app.calls, app.answers).size).toBe(0);
  });

  it('warns about an empty order, then F9 places it and confirms what was ordered', () => {
    const { app, press } = toResult();
    press('Enter', 'F9');
    expect(app.supply!.placed).toBe(false);
    expect(screen(app).join('\n')).toContain('Nothing is on the order yet');
    press('3', 'ArrowDown', '4', 'F9');
    expect(app.supply!.placed).toBe(true);
    const text = screen(app).join('\n');
    expect(text).toContain('ORDER PLACED FOR TOMORROW');
    expect(text).toContain(`3 × ${app.supply!.rows[0]!.item.name.split(',')[0]!.toLowerCase()}`);
    expect(text).toContain('Order placed for tomorrow: 2 items, 7 units in all.');
    // Nothing else changes: the amounts are locked and F9 again only says so.
    press('9');
    expect(app.supply!.amount(1)).toBe(4);
    press('F9');
    expect(screen(app).join('\n')).toContain('already placed');
  });

  it('goes back to the result with ESC and keeps the order; R plays the morning again once placed', () => {
    const { app, press } = toResult();
    press('Enter', '6', 'Escape');
    expect(app.screen).toBe('result');
    press('Enter');
    expect(app.supply!.amount(0)).toBe(6);
    press('r');
    expect(app.screen).toBe('supply');
    press('F9', 'r');
    expect(app.screen).toBe('messages');
    expect(app.supply).toBeNull();
  });

  it('fits 120 columns in both colour schemes and in the big morning', () => {
    const { app, press } = toResult(0, 'big');
    press('Enter', 'a');
    screen(app);
    for (let i = 0; i < 14; i++) {
      press('ArrowDown');
      screen(app);
    }
    press('F2');
    screen(app);
    press('F9');
    screen(app);
    expect(app.blue).toBe(true);
  });

  it('makes only the sounds the other screens use', () => {
    const cues: string[] = [];
    const fx = fakeEffects();
    fx.cue = (m) => void cues.push(m);
    const app = new App(fx, () => {}, 'small');
    app.screen = 'supply';
    app.supply = new Supply(app.morning, app.morning.stock);
    for (const key of ['1', 'ArrowRight', 'ArrowDown', 'u', 'a', 'Enter', 'F9']) app.press({ key });
    expect(new Set(cues)).toEqual(new Set(['digit', 'nudge', 'move', 'confirm', 'finish']));
  });
});
