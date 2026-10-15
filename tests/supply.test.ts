import { describe, expect, it } from 'vitest';
import { Desk } from '../src/game/desk';
import { bigMorning, smallMorning } from '../src/game/morning';
import { callNotes, KEPT_ORDER, stockAfterDeliveries, Supply } from '../src/game/supply';
import { ROAD_TICK_MS } from '../src/game/road';
import { App, type Effects } from '../src/ui/app';
import { memoryStore } from '../src/ui/store';
import { COLS, plain, ROWS } from '../src/ui/grid';
import { screenLines } from '../src/ui/view';
import { hold } from './helpers';

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

  it('leaves a row that already has an amount alone when filling it', () => {
    const s = supply();
    s.set(0, 7);
    expect(s.fillRow(0)).toBe(7);
    expect(s.amount(0)).toBe(7);
  });

  it('fills only the rows at zero when filling every row', () => {
    const s = supply();
    s.set(0, 7);
    s.set(1, 1);
    s.fillAll();
    expect(s.amount(0)).toBe(7);
    expect(s.amount(1)).toBe(1);
    s.rows.forEach((row, r) => {
      if (r > 1) expect(s.amount(r)).toBe(Math.max(0, row.usual - row.onHand));
    });
  });
});

function fakeEffects(): Effects {
  return {
    cue: () => {},
    print: () => 100,
    later: (fn, ms) => (ms === ROAD_TICK_MS ? undefined : fn()),
    toggleSound: () => true,
    setSound: () => {},
    store: memoryStore(),
    now: (() => {
      let t = 0;
      return () => (t += 1000);
    })(),
    random: () => 0,
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
  press(' ');
  hold(app, ' ');
  for (let n = 0; n < 30 && !app.roadOver; n++) {
    if (app.roadCall) press(...Array(answer).fill('ArrowDown'), 'Enter');
    else press(' ');
  }
  press(' ');
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
  it('is reached with SPACE from the result and shows each item with its room, stock and usual amount', () => {
    const { app, press } = toResult();
    expect(app.screen).toBe('result');
    expect(screen(app).join('\n')).toContain('SPACE supplier order');
    press(' ');
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
      expect(row).toContain(`${String(left[item.id]).padStart(8)}${String(app.morning.usual[item.id]).padStart(7)}`);
    }
  });

  it('types an amount, nudges it with the arrows, and ENTER confirms the row and moves on', () => {
    const { app, press } = toResult();
    press(' ');
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
    press(' ', 'ArrowDown', 'u');
    const s = app.supply!;
    expect(s.amount(0)).toBe(0);
    expect(s.amount(1)).toBe(s.gap(1));
    press('a');
    s.rows.forEach((row, r) => expect(s.amount(r)).toBe(Math.max(0, row.usual - row.onHand)));
    expect(screen(app).join('\n')).toContain('U row');
    expect(screen(app).join('\n')).toContain('A all');
  });

  it('shows a call note below the room bars only while its item is the highlighted row', () => {
    const { app, press } = toResult(0);
    press(' ');
    const noted = app.calls.filter((c) => c.item && c.options[0]?.addsToOrder);
    expect(noted.length).toBeGreaterThan(0);
    const supply = app.supply!;
    const bars = (lines: string[]) => lines.findIndex((l) => l.includes('DRY STORE') && l.includes('░'));
    for (let r = 0; r < supply.count; r++) {
      const row = supply.rows[r]!;
      const lines = screen(app);
      const here = noted.filter((c) => c.item === row.item.id);
      const noteLines = lines.filter((l) => l.includes('rang:') || l.includes("tomorrow's order") && l.includes('←'));
      if (here.length > 0) {
        expect(noteLines).toHaveLength(1);
        expect(noteLines[0]).toContain(here[0]!.client);
        // Below the last bar, in the panel on the right, never on the item's own line.
        expect(lines.indexOf(noteLines[0]!)).toBeGreaterThan(bars(lines));
        expect(noteLines[0]!.indexOf('←')).toBeGreaterThanOrEqual(56);
        expect(rowOf(lines, row.item.name)).not.toContain('rang');
      } else {
        expect(noteLines).toHaveLength(0);
      }
      press('ArrowDown');
    }
  });

  it('marks every row with a note in amber, whether or not it is highlighted, and no other row', () => {
    const { app, press } = toResult(0);
    press(' ', 'a');
    const supply = app.supply!;
    const noted = new Set(supply.rows.flatMap((row) => (supply.notes.get(row.item.id)?.length ? [row.item.id] : [])));
    expect(noted.size).toBeGreaterThan(0);
    for (const blue of [false, true]) {
      expect(app.blue).toBe(blue);
      for (let r = 0; r < supply.count; r++) {
        const row = supply.rows[r]!;
        const name = screenLines(app).flat().find(([t]) => t.trim() === row.item.name)!;
        const classes = name[1].split(' ');
        expect(classes.includes('w')).toBe(noted.has(row.item.id));
        expect(classes.includes('hl')).toBe(r === app.supplySel);
        press('ArrowDown');
      }
      press('F2');
    }
  });

  it('does not dim a confirmed row while it is highlighted', () => {
    const { app, press } = toResult(0);
    press(' ', 'Enter', 'ArrowUp');
    const supply = app.supply!;
    expect(supply.isConfirmed(0)).toBe(true);
    expect(app.supplySel).toBe(0);
    const line = screenLines(app).find((l) => l.some(([t]) => t.trim() === supply.rows[0]!.item.name))!;
    const marked = line.filter(([, cls]) => cls.split(' ').includes('hl'));
    expect(marked.length).toBeGreaterThan(0);
    for (const [, cls] of marked) expect(cls.split(' ')).not.toContain('d');
  });

  it('leaves the supplier screen without amounts, and the result screen shows them', () => {
    const { app, press } = toResult(0);
    const text = screen(app).join('\n');
    for (const call of app.calls.filter((c) => c.qty != null)) expect(text).toContain(`added ${call.qty} to tomorrow`);
    press(' ');
    const supplier = screen(app).join('\n');
    expect(supplier).not.toContain('PROMISED');
    expect(supplier).not.toContain('promised');
    expect(supplier).not.toMatch(/added \d+ to tomorrow/);
  });

  it('keeps the amounts typed when going back to the result screen and in again', () => {
    const { app, press } = toResult(0);
    press(' ', '5', 'ArrowDown', '7', 'Escape');
    expect(app.screen).toBe('result');
    press(' ');
    expect(app.supply!.amount(0)).toBe(5);
    expect(app.supply!.amount(1)).toBe(7);
  });

  it('shows no notes when every call was answered "not today"', () => {
    const { app, press } = toResult(1);
    press(' ');
    expect(screen(app).join('\n')).not.toContain('rang:');
    expect(callNotes(app.calls, app.answers).size).toBe(0);
  });

  it('warns about an empty order, then holding SPACE places it and opens the end of the day', () => {
    const { app, press } = toResult();
    press(' ');
    hold(app, ' ');
    expect(app.supply!.placed).toBe(false);
    expect(app.screen).toBe('supply');
    expect(screen(app).join('\n')).toContain('Nothing is on the order yet');
    press('3', 'ArrowDown', '4');
    hold(app, ' ');
    expect(app.supply!.placed).toBe(true);
    expect(app.screen).toBe('day');
    const text = screen(app).join('\n');
    expect(text).toContain('Order placed for tomorrow: 2 items, 7 units in all.');
    expect(text).toContain(`3 ${app.supply!.rows[0]!.item.name.split(',')[0]!.toLowerCase()}`);
  });

  it('goes back to the result with ESC and keeps the order', () => {
    const { app, press } = toResult();
    press(' ', '6', 'Escape');
    expect(app.screen).toBe('result');
    press(' ');
    expect(app.supply!.amount(0)).toBe(6);
    hold(app, ' ');
    hold(app, 'r');
    expect(app.screen).toBe('messages');
    expect(app.supply).toBeNull();
    expect(app.day).toBeNull();
  });

  it('fits 120 columns in both colour schemes and in the big morning', () => {
    const { app, press } = toResult(0, 'big');
    press(' ', 'a');
    screen(app);
    for (let i = 0; i < 14; i++) {
      press('ArrowDown');
      screen(app);
    }
    press('F2');
    screen(app);
    hold(app, ' ');
    screen(app);
    expect(app.blue).toBe(true);
  });

  describe('the room bars', () => {
    const heading = (lines: string[], room: string) => lines.find((l) => l.includes(room) && l.includes('%')) ?? '';
    const shades = (line: string) => ({ ...Object.fromEntries(['█', '▓', '░'].map((g) => [g, [...line].filter((c) => c === g).length])) });

    it('sit in a panel on the right under the legend, one per room with its per cent', () => {
      const { app, press } = toResult();
      press(' ');
      const lines = screen(app);
      const text = lines.join('\n');
      for (const word of ['█ in store', '▓ ordered', '░ free']) expect(text).toContain(word);
      expect(text).not.toContain('this row');
      expect(text).not.toContain('▒');
      const legend = lines.findIndex((l) => l.includes('█ in store'));
      for (const room of ['FREEZER', 'FRIDGE', 'DRY STORE']) {
        const line = heading(lines, room);
        const space = app.supply!.roomSpace(room === 'FREEZER' ? 'freezer' : room === 'FRIDGE' ? 'fridge' : 'dry');
        expect(line).toMatch(/[█▓░]{26} +\d+%/);
        expect(line).toContain(`${space.pct}%`);
        expect(line).not.toContain('over by');
        // To the right of the item columns, and at least one empty line below the legend.
        expect(line.indexOf('█') === -1 ? line.indexOf('░') : line.indexOf('█')).toBeGreaterThanOrEqual(56);
        expect(lines.indexOf(line)).toBeGreaterThan(legend + 1);
      }
      expect(lines[legend + 1]!.slice(50).trim()).toBe('');
    });

    it('update as an amount is typed, nudged or filled', () => {
      const { app, press } = toResult();
      press(' ');
      const freezer = () => heading(screen(app), 'FREEZER');
      const chips = app.supply!.rows.findIndex((r) => r.item.id === 'chips');
      const before = shades(freezer());
      expect(before['▓']).toBe(0);
      press(...Array(chips).fill('ArrowDown'), '4');
      const typed = shades(freezer());
      expect(typed['▓']).toBeGreaterThan(0);
      expect(typed['░']).toBeLessThan(before['░']!);
      press('0');
      const more = shades(freezer())['▓']!;
      expect(more).toBeGreaterThan(typed['▓']!);
      press('ArrowLeft');
      expect(shades(freezer())['▓']).toBeLessThanOrEqual(more);
      press('Enter');
      const after = shades(freezer());
      expect(after['▓']).toBeGreaterThan(0);
      // A fill with A adds the rest of the usual amounts.
      press('a');
      expect(shades(freezer())['▓']).toBeGreaterThan(after['▓']!);
      expect(freezer()).toContain(`${app.supply!.roomSpace('freezer').pct}%`);
    });

    it('cap at full and warn in amber when the order is more than a room holds, and holding SPACE still places it', () => {
      const { app, press } = toResult(0, 'big');
      press(' ');
      const chips = app.supply!.rows.findIndex((r) => r.item.id === 'chips');
      press(...Array(chips).fill('ArrowDown'), '9', '9', '9');
      const space = app.supply!.roomSpace('freezer');
      expect(space.overPct).toBeGreaterThan(0);
      const lines = screen(app);
      const line = heading(lines, 'FREEZER');
      expect(line).toContain(`over by ${space.overPct}%`);
      expect(line).toContain(`${space.pct}%`);
      expect(shades(line)['░']).toBe(0);
      expect([...line].filter((c) => '█▓'.includes(c))).toHaveLength(26);
      const amber = screenLines(app).find((l) => l.some(([t]) => t.includes('over by')));
      expect(amber!.filter(([t]) => t.includes('over by') || /^ +\d+%$/.test(t)).every(([, cls]) => cls === 'w')).toBe(true);
      // The other rooms are not over, so say nothing about them.
      expect(lines.join('\n').match(/over by/g)).toHaveLength(1);
      hold(app, ' ');
      expect(app.supply!.placed).toBe(true);
      expect(app.screen).toBe('day');
    });

    it('draw the three shades with their own colour in both colour schemes', () => {
      const { app, press } = toResult(0, 'big');
      press(' ', 'a');
      for (const theme of [false, true]) {
        expect(app.blue).toBe(theme);
        const classes = new Map<string, string>();
        for (const line of screenLines(app)) for (const [t, cls] of line) for (const g of '█▓░') if (t.includes(g)) classes.set(g, cls);
        expect(new Set(classes.keys())).toEqual(new Set(['█', '▓', '░']));
        expect(new Set(classes.values()).size).toBe(3);
        press('F2');
      }
    });
  });

  it('makes only the sounds the other screens use', () => {
    const cues: string[] = [];
    const fx = fakeEffects();
    fx.cue = (m) => void cues.push(m);
    const app = new App(fx, () => {}, 'small');
    app.screen = 'supply';
    app.supply = new Supply(app.morning, app.morning.stock);
    for (const key of ['1', 'ArrowRight', 'ArrowDown', 'u', 'a', 'Enter']) app.press({ key });
    hold(app, ' ');
    expect(new Set(cues)).toEqual(new Set(['digit', 'nudge', 'move', 'confirm', 'finish']));
  });
});
