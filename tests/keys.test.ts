import { describe, expect, it } from 'vitest';
import { ARRIVAL_PAUSE_MS, App, COMMIT_HOLD_MS, HOLD_MS, RUN_KEY, type Effects } from '../src/ui/app';
import { COLS, plain } from '../src/ui/grid';
import { BAR_CELLS, BOX_W, holdBox } from '../src/ui/screens/hold';
import { screenLines } from '../src/ui/view';
import { memoryStore } from '../src/ui/store';
import { fakeEffects, hold, playToSupply, screen, toDay, toNextMorning } from './helpers';

/** An app whose clock the test moves, as a player's keys are slow or quick. */
function timed(morning: 'small' | 'big' = 'small', store = memoryStore()) {
  const clock = { t: 0 };
  const cues: string[] = [];
  const effects: Effects = { ...fakeEffects(cues, () => 0.5, store), now: () => clock.t };
  const app = new App(effects, () => {}, morning);
  /** Presses each key `gap` ms after the one before. */
  const press = (gap: number, ...keys: string[]) =>
    keys.forEach((key) => {
      clock.t += gap;
      app.press({ key });
    });
  const wait = (ms: number) => {
    clock.t += ms;
    app.tick();
  };
  return { app, clock, cues, press, wait, store };
}

/** Plays the small morning on a clock the test moves, as far as the truck sheets with every order on a truck. */
function atSheets() {
  const t = timed();
  t.press(1000, ' ');
  const trucks: Record<string, number> = { 'Café Lumen': 1, "Rosa's": 2, 'The Anchor': 2, 'Golden Dragon': 1, 'Hotel Bellevue': 1, 'Burger Shack': 1, 'The Plough': 2 };
  for (let n = 0; n < 7; n++) {
    const name = t.app.desk.order(t.app.orderSel).client;
    for (let l = 0; l < t.app.desk.order(t.app.orderSel).lines.length; l++) t.press(1000, 'Enter');
    t.press(1000, ...Array(9).fill('ArrowUp'), ...Array((trucks[name] as number) - 1).fill('ArrowDown'), 'Enter');
  }
  t.press(1000, ' ');
  return t;
}

const barText = (app: App) => plain(screenLines(app)).at(-1)!.trimEnd();

describe('ENTER never leaves a screen', () => {
  it('does nothing on the end of the day, however often it is pressed: no choice opens, no money is spent', () => {
    const { app, press } = toDay();
    const cash = app.cash;
    press('Enter', 'Enter', 'Enter');
    for (let i = 0; i < 4; i++) app.press({ key: 'Enter', repeat: i > 0 });
    expect(app.screen).toBe('day');
    expect(app.growthOpen).toBe(false);
    expect(app.growth).toBeNull();
    expect(app.cash).toBe(cash);
    expect(app.run.day).toBe(1);
  });

  it('stays on the same screen on every screen of the day, held or tapped', () => {
    const t = timed();
    const stay = (screenName: string, expectedGrowthOpen = false) => {
      for (const repeat of [false, false, true, true]) t.app.press({ key: 'Enter', repeat });
      expect(t.app.screen).toBe(screenName);
      expect(t.app.growthOpen).toBe(expectedGrowthOpen);
      expect(t.app.ask).toBeNull();
    };
    t.press(1000, 'F4');
    stay('messages');
    t.press(1000, ' ');
    expect(t.app.screen).toBe('desk');
    t.press(1000, ' ');
    expect(t.app.screen).toBe('sheets');
    stay('sheets');
    t.app.screen = 'result';
    stay('result');
    t.app.screen = 'supply';
    t.app.supply = null;
    stay('supply');
  });

  it('does not skip on the road, and not from the road to the result', () => {
    const t = atSheets();
    expect(t.app.screen).toBe('sheets');
    t.press(1000, ' ');
    t.wait(COMMIT_HOLD_MS);
    t.app.release(' ');
    expect(t.app.screen).toBe('road');
    const clock = t.app.roadClock;
    t.press(1000, 'Enter', 'Enter');
    expect(t.app.roadClock).toBe(clock);
    for (let n = 0; n < 40 && !t.app.roadOver; n++) t.press(1000, t.app.roadCall ? 'Enter' : ' ');
    expect(t.app.roadOver).toBe(true);
    t.press(1000, 'Enter');
    for (let i = 0; i < 3; i++) t.app.press({ key: 'Enter', repeat: true });
    expect(t.app.screen).toBe('road');
    t.press(1000, ' ');
    expect(t.app.screen).toBe('result');
  });
});

describe('a held SPACE goes one step at most', () => {
  it('goes from the messages to the desk and no further while the key is held', () => {
    const { app } = timed();
    app.press({ key: ' ' });
    for (let i = 0; i < 5; i++) app.press({ key: ' ', repeat: true });
    expect(app.screen).toBe('desk');
  });

  it('does not go on from the desk to the sheets, and the sheets do not ask to send, while the key is still held', () => {
    const { app, press } = timed();
    press(1000, ' ', ' ');
    for (let i = 0; i < 5; i++) app.press({ key: ' ', repeat: true });
    expect(app.screen).toBe('sheets');
    expect(app.ask).toBeNull();
  });

  it('does not take the end of the day on to the next morning', () => {
    const { app, press } = toDay();
    press(' ', '1', 'Enter');
    app.press({ key: ' ' });
    for (let i = 0; i < 5; i++) app.press({ key: ' ', repeat: true });
    expect(app.run.day).toBe(1);
    expect(app.growth).not.toBeNull();
  });

  it('has no F9 or F10 any more', () => {
    const { app, press } = toDay();
    press('F2');
    for (const key of ['F9', 'F10']) expect(app.press({ key })).toBe(false);
    const day = new App(fakeEffects(), () => {}, 'small');
    day.press({ key: ' ' });
    expect(day.press({ key: 'F10' })).toBe(false);
    expect(day.screen).toBe('desk');
  });
});

describe('a double tap of SPACE goes one step, not two', () => {
  it('ignores a second SPACE within the pause after a screen changes, and takes one after it', () => {
    const t = timed();
    t.press(1000, ' ');
    expect(t.app.screen).toBe('desk');
    t.press(ARRIVAL_PAUSE_MS - 1, ' ');
    expect(t.app.screen).toBe('desk');
    t.press(1, ' ');
    expect(t.app.screen).toBe('sheets');
    t.press(ARRIVAL_PAUSE_MS - 1, ' ');
    expect(t.app.ask).toBeNull();
  });

  it('counts from the moment the screen changed, not from the last key', () => {
    const t = timed();
    t.press(1000, ' ');
    t.press(100, 'ArrowDown', 'ArrowDown');
    t.press(100, ' ');
    expect(t.app.screen).toBe('desk');
    t.press(ARRIVAL_PAUSE_MS, ' ');
    expect(t.app.screen).toBe('sheets');
  });
});

describe('the steps that cannot be taken back need SPACE (or R) held down', () => {
  it('sends the trucks only once the hold is done', () => {
    const t = atSheets();
    expect(t.app.screen).toBe('sheets');
    t.press(1000, ' ');
    expect(t.app.screen).toBe('sheets');
    expect(t.app.ask).toEqual({ action: 'send' });
    t.wait(COMMIT_HOLD_MS - 1);
    expect(t.app.screen).toBe('sheets');
    t.wait(1);
    expect(t.app.screen).toBe('road');
    expect(t.app.ask).toBeNull();
  });

  it('does nothing for a tap, a double tap or letting go early', () => {
    const t = atSheets();
    t.press(1000, ' ');
    t.app.release(' ');
    t.press(1000, ' ');
    t.app.release(' ');
    t.wait(COMMIT_HOLD_MS * 3);
    expect(t.app.screen).toBe('sheets');
    t.press(1000, ' ');
    t.wait(COMMIT_HOLD_MS - 100);
    t.app.release(' ');
    t.wait(COMMIT_HOLD_MS * 3);
    expect(t.app.screen).toBe('sheets');
  });

  it('is cancelled by ESC or any other key', () => {
    const t = atSheets();
    t.press(1000, ' ', 'Escape');
    expect(t.app.ask).toBeNull();
    expect(t.app.screen).toBe('sheets');
    t.press(1000, ' ', 'ArrowDown');
    expect(t.app.ask).toBeNull();
    t.wait(COMMIT_HOLD_MS * 3);
    expect(t.app.screen).toBe('sheets');
  });

  it('places the supplier order only once the hold is done, and an empty order is not placed', () => {
    const { app, press } = toNextMorning('1');
    playToSupply(app, press);
    expect(app.screen).toBe('supply');
    press(' ');
    expect(app.ask).toBeNull();
    expect(app.tone).toBe('warn');
    expect(app.status).toContain('Nothing is on the order');
    press('a', ' ');
    expect(app.ask).toEqual({ action: 'order' });
    expect(app.screen).toBe('supply');
    app.release(' ');
    expect(app.supply?.placed).toBe(false);
    hold(app, ' ');
    expect(app.screen).toBe('day');
    expect(app.supply?.placed).toBe(true);
  });

  it('starts the next morning only once the hold is done, and only with a choice made', () => {
    const { app, press } = toDay();
    press(' ');
    expect(app.growthOpen).toBe(true);
    press(' ');
    expect(app.ask).toBeNull();
    expect(app.tone).toBe('warn');
    expect(app.status).toContain('Choose one');
    press('1', 'Enter', ' ');
    expect(app.ask).toEqual({ action: 'morning' });
    expect(app.run.day).toBe(1);
    app.release(' ');
    press(' ');
    expect(app.run.day).toBe(1);
    app.release(' ');
    hold(app, ' ');
    expect(app.run.day).toBe(2);
    expect(app.screen).toBe('messages');
  });

  it('plays the day again from the end of the day or the growth choice only once R is held', () => {
    const { app, press } = toDay();
    press('r');
    expect(app.screen).toBe('day');
    expect(app.ask).toEqual({ action: 'again' });
    app.release('r');
    expect(app.screen).toBe('day');
    hold(app, 'r');
    expect(app.screen).toBe('messages');

    const growth = toDay();
    growth.press(' ', '2', 'Enter', 'R');
    expect(growth.app.screen).toBe('day');
    expect(growth.app.growth).not.toBeNull();
    hold(growth.app, 'R');
    expect(growth.app.screen).toBe('messages');
    expect(growth.app.growth).toBeNull();
  });

  it('keeps the hold for a new run at the longer time, and the others at the shorter', () => {
    expect(COMMIT_HOLD_MS).toBeLessThan(HOLD_MS);
    const store = memoryStore();
    toNextMorning('1', 'small', 0, () => 0.5, store);
    expect(store.data.get(RUN_KEY)).toBeDefined();
    const t = timed('small', store);
    t.press(1000, 'Enter');
    expect(t.app.screen).toBe('messages');
    t.press(1000, 'b');
    t.wait(COMMIT_HOLD_MS);
    expect(t.app.run.day).toBe(2);
    t.wait(HOLD_MS - COMMIT_HOLD_MS);
    expect(t.app.run.day).toBe(1);
  });

  it('does not carry a held key on into the next hold', () => {
    const { app, press } = toDay();
    press(' ', '1', 'Enter');
    app.press({ key: ' ' });
    app.tick();
    expect(app.run.day).toBe(2);
    for (let i = 0; i < 4; i++) app.press({ key: ' ', repeat: true });
    expect(app.screen).toBe('messages');
    expect(app.ask).toBeNull();
  });
});

/** The most rows the box takes up, with and without a warning in it. */
const BOX_ROWS = 9;
const BOX_ROWS_WARNED = 14;

describe('the hold box', () => {
  /** An app with the box for each step on show, as the key for it has just gone down. */
  const asking: Record<string, () => App> = {
    send: () => {
      const t = atSheets();
      t.press(1000, ' ');
      return t.app;
    },
    order: () => {
      const { app, press } = toNextMorning('1');
      playToSupply(app, press);
      press('a');
      app.press({ key: ' ' });
      return app;
    },
    morning: () => {
      const { app, press } = toDay();
      press(' ', '1', 'Enter', ' ');
      return app;
    },
    again: () => {
      const { app, press } = toDay();
      press('r');
      return app;
    },
  };

  it.each([
    ['send', 'HOLD SPACE TO SEND THE TRUCKS'],
    ['order', 'HOLD SPACE TO PLACE THE ORDER'],
    ['morning', 'HOLD SPACE TO START THE NEXT MORNING'],
    ['again', 'HOLD R TO PLAY THE DAY AGAIN'],
  ] as const)('names the action and the key to %s, and says how to cancel', (step, title) => {
    const app = asking[step]!();
    expect(app.ask?.action).toBe(step);
    const text = screen(app).join('\n');
    expect(text).toContain(title);
    expect(text).toContain('ESC to cancel');
  });

  it('fits within its bounds for every hold, with and without the warning', () => {
    const warned = timed();
    warned.press(1000, ' ', 'Enter', 'Tab', 'Enter', ' ', ' ');
    const store = memoryStore();
    toNextMorning('1', 'small', 0, () => 0.5, store);
    const fresh = timed('small', store);
    fresh.press(1000, 's');
    const boxes: Array<[string, App, number]> = [
      ['send with a warning', warned.app, BOX_ROWS_WARNED],
      ['newRun', fresh.app, BOX_ROWS_WARNED],
      ['again', asking.again!(), BOX_ROWS_WARNED],
      ...(['send', 'order', 'morning'] as const).map((step): [string, App, number] => [step, asking[step]!(), BOX_ROWS]),
    ];
    for (const [name, app, rows] of boxes) {
      const box = holdBox(app);
      expect(box, name).not.toBeNull();
      expect(box!.length, name).toBeLessThanOrEqual(rows);
      expect(box!.length, name).toBeGreaterThanOrEqual(rows - 4);
      for (const line of box!) expect(line.reduce((n, [text]) => n + [...text].length, 0), name).toBe(BOX_W);
      const text = plain(box!).join('\n');
      expect(text, name).toContain('ESC to cancel');
    }
    expect(holdBox(warned.app)!.length).toBeGreaterThan(holdBox(boxes[3]![1])!.length);
  });

  it('warns in the box for R that what was done since the trucks left is dropped', () => {
    const box = holdBox(asking.again!())!;
    const text = plain(box);
    expect(text.join('\n')).toContain('HOLD R TO PLAY THE DAY AGAIN');
    expect(text.filter((l) => l.includes('Drops all you did since the trucks left.'))).toHaveLength(1);
    expect(box.length).toBeLessThanOrEqual(BOX_ROWS_WARNED);
    for (const line of text) expect([...line]).toHaveLength(BOX_W);
  });

  it('shows the key, a bar that fills while it is held, and what letting go or ESC does, over any screen', () => {
    const t = atSheets();
    t.press(1000, ' ');
    const rows = () => plain(screenLines(t.app));
    const text = rows().join('\n');
    expect(text).toContain('HOLD SPACE TO SEND THE TRUCKS');
    expect(text).toContain('ESC to cancel');
    expect(rows()).toHaveLength(30);
    for (const row of rows()) expect([...row]).toHaveLength(COLS);
    const cells = () => [...(rows().find((r) => r.includes('█') && r.startsWith(' '.repeat(20))) ?? '')].filter((c) => c === '█').length;
    expect(cells()).toBe(0);
    t.wait(COMMIT_HOLD_MS / 2);
    expect(cells()).toBe(BAR_CELLS / 2);
    t.wait(COMMIT_HOLD_MS / 4);
    expect(cells()).toBe(Math.round(BAR_CELLS * 0.75));
    t.app.release(' ');
    expect(cells()).toBe(0);
  });

  it('is a box in the middle of the screen, between two rules, the same size for every step', () => {
    const t = atSheets();
    t.press(1000, ' ');
    const lines = plain(screenLines(t.app));
    const rules = lines.map((l, i) => (l.includes('═'.repeat(BOX_W)) ? i : -1)).filter((i) => i >= 0);
    expect(rules).toHaveLength(2);
    const [top, bottom] = rules as [number, number];
    expect(top).toBeGreaterThan(2);
    expect(bottom).toBeLessThan(27);
    const left = lines[top]!.indexOf('═');
    const width = [...lines[top]!.trim()].length;
    expect(left * 2 + width).toBe(COLS);
    expect(bottom - top).toBeLessThanOrEqual(BOX_ROWS);
    expect(lines.slice(top, bottom).filter((l) => l.includes('░')).length).toBe(1);
  });

  it('shows the orders not handed out inside the box that sends the trucks', () => {
    const t = timed();
    t.press(1000, ' ', 'Enter', 'Tab', 'Enter', ' ', ' ');
    const text = plain(screenLines(t.app)).join('\n');
    expect(text).toContain('HOLD SPACE TO SEND THE TRUCKS');
    expect(text).toMatch(/\d+ orders not handed out\./);
  });

  it('is drawn in both colour schemes on its own colours, and goes when the hold ends', () => {
    const t = atSheets();
    for (const blue of [false, true]) {
      if (t.app.blue !== blue) t.press(1000, 'F2');
      t.press(1000, ' ');
      const classes = screenLines(t.app).flatMap((l) => l.map(([, c]) => c));
      expect(classes.some((c) => c.split(' ').includes('box'))).toBe(true);
      screen(t.app);
      if (!blue) t.press(1000, 'Escape');
    }
    t.press(1000, 'Escape');
    const gone = screenLines(t.app).flatMap((l) => l.map(([, c]) => c));
    expect(gone.some((c) => c.split(' ').includes('box'))).toBe(false);
    expect(plain(screenLines(t.app)).join('\n')).not.toContain('═'.repeat(BOX_W));
  });

  it('is the box for a new run on the welcome back screen too, over the list', () => {
    const store = memoryStore();
    toNextMorning('1', 'small', 0, () => 0.5, store);
    const t = timed('small', store);
    expect(t.app.screen).toBe('start');
    t.press(1000, 's');
    const text = plain(screenLines(t.app)).join('\n');
    expect(text).toContain('HOLD S TO START A NEW RUN');
    expect(text).toContain('Replaces your saved day 2.');
    expect(text).toContain('ESC to cancel');
    t.wait(HOLD_MS / 2);
    const cells = plain(screenLines(t.app)).find((r) => r.includes('█') && r.startsWith(' '.repeat(20))) ?? '';
    expect([...cells].filter((c) => c === '█').length).toBe(BAR_CELLS / 2);
  });
});

describe('the welcome back screen', () => {
  it('picks a line with 1, 2 or 3 and goes on with SPACE, ENTER or C', () => {
    const store = memoryStore();
    toNextMorning('1', 'small', 0, () => 0.5, store);
    const t = timed('small', store);
    expect(t.app.startSel).toBe(0);
    t.press(1000, '3');
    expect(t.app.startSel).toBe(2);
    t.press(1000, '2');
    expect(t.app.startSel).toBe(1);
    expect(t.app.screen).toBe('start');
    t.press(1000, '1');
    expect(t.app.startSel).toBe(0);
    t.press(1000, ' ');
    expect(t.app.screen).toBe('messages');
    expect(t.app.run.day).toBe(2);
  });
});

describe('every key bar', () => {
  it('fits in 120 columns, lists SPACE for the way on and never F9 or F10, in both colour schemes', () => {
    const t = timed();
    const seen: string[] = [];
    const look = (name: string, onward: boolean) => {
      for (const blue of [false, true]) {
        if (t.app.blue !== blue) t.press(1000, 'F2');
        const bar = barText(t.app);
        expect([...bar].length).toBeLessThanOrEqual(COLS);
        expect(bar).not.toMatch(/F9|F10/);
        if (onward) expect(bar).toContain('SPACE');
        screen(t.app);
      }
      if (!seen.includes(name)) seen.push(name);
    };
    look('messages', true);
    t.press(1000, ' ');
    look('desk', true);
    const trucks: Record<string, number> = { 'Café Lumen': 1, "Rosa's": 2, 'The Anchor': 2, 'Golden Dragon': 1, 'Hotel Bellevue': 1, 'Burger Shack': 1, 'The Plough': 2 };
    for (let n = 0; n < 7; n++) {
      const name = t.app.desk.order(t.app.orderSel).client;
      for (let l = 0; l < t.app.desk.order(t.app.orderSel).lines.length; l++) t.press(1000, 'Enter');
      t.press(1000, ...Array(9).fill('ArrowUp'), ...Array((trucks[name] as number) - 1).fill('ArrowDown'), 'Enter');
    }
    t.press(1000, ' ');
    look('sheets', true);
    t.press(1000, ' ');
    t.wait(COMMIT_HOLD_MS);
    t.app.release(' ');
    look('road', true);
    for (let n = 0; n < 40 && !t.app.roadOver; n++) {
      if (t.app.roadCall) {
        look('call', false);
        t.press(1000, 'Enter');
      } else t.press(1000, ' ');
    }
    look('road over', true);
    t.press(1000, ' ');
    look('result', true);
    t.press(1000, ' ');
    look('supply', true);
    t.press(1000, 'a', ' ');
    t.wait(COMMIT_HOLD_MS);
    t.app.release(' ');
    look('day', true);
    t.press(1000, ' ');
    look('growth', false);
    t.press(1000, '1', 'Enter');
    look('growth chosen', true);
    expect(seen).toEqual(['messages', 'desk', 'sheets', 'road', 'call', 'road over', 'result', 'supply', 'day', 'growth', 'growth chosen']);
  });

  it('says on each screen how to go on, in the same words as the how to play pages', () => {
    const { app } = toDay();
    expect(barText(app)).toContain('SPACE what to grow');
    expect(barText(app)).toContain('PgUp PgDn clients');
  });
});
