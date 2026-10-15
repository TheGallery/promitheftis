import { describe, expect, it } from 'vitest';
import { ROAD_STEP_MINUTES, ROAD_TICK_MS } from '../src/game/road';
import { App, RUN_KEY, type Effects } from '../src/ui/app';
import { HELP_PAGES } from '../src/ui/help';
import { plain } from '../src/ui/grid';
import { helpLines, HELP_ROOM } from '../src/ui/screens/help';
import { screenLines } from '../src/ui/view';
import { memoryStore, type Store } from '../src/ui/store';
import { fakeEffects, playToSupply, screen, toDay, toNextMorning } from './helpers';

/** An app whose road ticks wait for the test to run them, with the sounds it makes. */
function newApp(store: Store = memoryStore()) {
  const cues: string[] = [];
  const ticks: (() => void)[] = [];
  let sound = true;
  const effects: Effects = {
    ...fakeEffects(cues, () => 0, store),
    later: (fn, ms) => (ms === ROAD_TICK_MS ? void ticks.push(fn) : fn()),
    toggleSound: () => (sound = !sound),
  };
  const app = new App(effects, () => {}, 'small');
  const press = (...keys: string[]) => keys.forEach((key) => app.press({ key }));
  /** Runs the road ticks that are waiting, as the timer would. */
  const runTicks = () => ticks.splice(0).forEach((fn) => fn());
  return { app, press, cues, ticks, runTicks };
}

/** Every piece of state the game keeps, as plain data, to compare before and after how to play. */
function snapshot(app: App) {
  const a = app as unknown as Record<string, unknown>;
  const keys = [
    'screen', 'msgSel', 'pane', 'orderSel', 'lineSel', 'truckSel', 'typed', 'sheetSel', 'roadClock', 'callSel', 'resultSel', 'supplySel',
    'supplyTyped', 'daySel', 'growthOpen', 'growthSel', 'status', 'tone', 'newRunAsk', 'confirmEnd', 'blue', 'soundOn',
  ];
  return {
    ...Object.fromEntries(keys.map((k) => [k, a[k]])),
    sheetOpen: [...app.sheetOpen],
    answers: [...app.answers],
    run: app.run,
    clock: app.desk.clock,
    given: app.desk.morning.orders.map((o, i) => o.lines.map((_, l) => app.desk.given(i, l))),
    cash: app.cash,
    growth: app.growth,
  };
}

/** The bar along the bottom of the screen, as text. */
const keyBar = (app: App) => plain(screenLines(app)).at(-1) as string;

/** Plays the small morning as far as each screen, leaving the app on it, and names the screen it is on. */
const SCREENS: ReadonlyArray<[string, () => { app: App; press: (...keys: string[]) => void }]> = [
  ['the overnight messages', () => newApp()],
  [
    'the order desk',
    () => {
      const x = newApp();
      x.press(' ', 'Enter', '4');
      return x;
    },
  ],
  [
    'the truck sheets',
    () => {
      const x = newApp();
      x.press(' ', 'F10', 'F10', 'Enter');
      return x;
    },
  ],
  [
    'the road',
    () => {
      const x = newApp();
      playToSupply(x.app, x.press);
      x.press('Escape', 'Escape');
      return x;
    },
  ],
  [
    'the result',
    () => {
      const x = newApp();
      playToSupply(x.app, x.press);
      x.press('Escape');
      return x;
    },
  ],
  [
    'the supplier order',
    () => {
      const x = newApp();
      playToSupply(x.app, x.press);
      x.press('3', '2');
      return x;
    },
  ],
  [
    'the end of the day',
    () => {
      const x = toDay();
      x.press('ArrowDown');
      return x;
    },
  ],
  [
    'the growth choice',
    () => {
      const x = toDay();
      x.press('Enter', 'ArrowDown');
      return x;
    },
  ],
  [
    'the welcome back screen',
    () => {
      const store = memoryStore();
      toNextMorning('1', 'small', 0, () => 0.37, store);
      const x = newApp(store);
      x.press('ArrowDown');
      return x;
    },
  ],
];

describe('how to play', () => {
  it.each(SCREENS)('opens with H on %s, and H or ESC puts everything back as it was', (name, make) => {
    for (const closeWith of ['h', 'Escape']) {
      const { app, press } = make();
      const before = snapshot(app);
      const text = screen(app);
      expect(keyBar(app)).toContain('H how to play');
      press('h');
      expect(app.helpOpen).toBe(true);
      expect(screen(app).join('\n')).toContain('HOW TO PLAY');
      press(closeWith);
      expect(app.helpOpen).toBe(false);
      expect(screen(app)).toEqual(text);
      expect(snapshot(app), name).toEqual(before);
    }
  });

  it('takes a capital H too, and ignores a held key repeating it', () => {
    const { app } = newApp();
    app.press({ key: 'H' });
    expect(app.helpOpen).toBe(true);
    app.press({ key: 'h', repeat: true });
    app.press({ key: 'H', repeat: true });
    expect(app.helpOpen).toBe(true);
    app.press({ key: 'H' });
    expect(app.helpOpen).toBe(false);
    app.press({ key: 'h', repeat: true });
    expect(app.helpOpen).toBe(false);
  });

  it('opens on the page that goes with the screen it was asked for from', () => {
    const wanted = [0, 0, 0, 1, 1, 1, 2, 2, 4];
    SCREENS.forEach(([name, make], i) => {
      const { app, press } = make();
      press('h');
      expect(app.helpPage, name).toBe(wanted[i]);
      expect(screen(app).join('\n')).toContain(`page ${wanted[i]! + 1} of ${HELP_PAGES.length}`);
    });
  });

  it('is 120 columns by 30 rows on every page, in both colour schemes, and every page fits', () => {
    const { app, press } = newApp();
    press('h');
    for (const blue of [false, true]) {
      app.blue = blue;
      for (let page = 0; page < HELP_PAGES.length; page++) {
        app.helpPage = page;
        const lines = screen(app);
        expect(lines[0]).toContain('HOW TO PLAY');
        expect(lines.at(-1)).toContain('turn the page');
        expect(lines.at(-1)).toContain('back to the game');
        expect(helpLines(HELP_PAGES[page]!.blocks).length).toBeLessThanOrEqual(HELP_ROOM);
      }
    }
  });

  it('covers the day in order, the markers, the money and the hold', () => {
    const all = HELP_PAGES.flatMap((p) => p.blocks.map((b) => `${b.head ?? ''} ${b.text}`)).join('\n');
    const heads = HELP_PAGES.flatMap((p) => p.blocks.map((b) => b.head ?? ''));
    const order = ['OVERNIGHT MESSAGES', 'ORDER DESK', 'ON THE ROAD', 'PHONE CALLS', 'RESULT', 'SUPPLIER ORDER', 'END OF THE DAY', 'MONEY', 'WHAT TO GROW', 'SHORT DELIVERIES', 'SAVING', 'STARTING OVER'];
    const at = order.map((o) => heads.findIndex((h) => h.includes(o)));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    for (const word of ['{!}', '{!!}', '£1,000', 'hold', '{F2}', '{F4}']) expect(all).toContain(word);
  });

  it('turns the page with the arrows and PgUp / PgDn, and stops at the first and the last', () => {
    const { app, press, cues } = newApp();
    press('h');
    expect(app.helpPage).toBe(0);
    press('ArrowLeft', 'PageUp');
    expect(app.helpPage).toBe(0);
    press('ArrowRight');
    expect(app.helpPage).toBe(1);
    expect(screen(app).join('\n')).toContain(`page 2 of ${HELP_PAGES.length}`);
    press('PageDown');
    expect(app.helpPage).toBe(2);
    press('ArrowLeft');
    expect(app.helpPage).toBe(1);
    press('PageUp');
    expect(app.helpPage).toBe(0);
    press(...Array(HELP_PAGES.length + 2).fill('ArrowRight'));
    expect(app.helpPage).toBe(HELP_PAGES.length - 1);
    press('PageDown');
    expect(app.helpPage).toBe(HELP_PAGES.length - 1);
    // A move sound for each page turned, and none at the ends.
    expect(cues.filter((c) => c === 'move')).toHaveLength(4 + (HELP_PAGES.length - 1));
  });

  it('opens at the page for the screen each time, not where it was left', () => {
    const { app, press } = newApp();
    press('h', 'ArrowRight', 'ArrowRight', 'h');
    press('h');
    expect(app.helpPage).toBe(0);
  });

  it('makes a soft key sound when it opens and when it closes, and a move sound for a page', () => {
    const { press, cues } = newApp();
    press('h');
    expect(cues).toEqual(['confirm']);
    press('ArrowRight');
    expect(cues).toEqual(['confirm', 'move']);
    press('Escape');
    expect(cues).toEqual(['confirm', 'move', 'confirm']);
    press('h', 'h');
    expect(cues.slice(3)).toEqual(['confirm', 'confirm']);
  });

  it('keeps the game under it out of reach: no key but its own does anything', () => {
    const { app, press } = newApp();
    press(' ', '4', 'Tab');
    press('h');
    const before = snapshot(app);
    press('ArrowDown', 'ArrowUp', 'Tab', 'Enter', '7', 'Backspace', ' ', 'F10', 'F9', 'r', 'R', 'b', 's', 'B', 'S', 'p', 'u', 'a', 'x');
    expect(snapshot(app)).toEqual(before);
    expect(screen(app).join('\n')).toContain('HOW TO PLAY');
    press('Escape');
    expect(snapshot(app)).toEqual(before);
    expect(app.screen).toBe('desk');
  });

  it('leaves the message that was showing, and a pending F10, for when it closes', () => {
    const { app, press } = newApp();
    press(' ', 'F10');
    expect(app.status).toContain('not handed out');
    const shown = screen(app).join('\n');
    press('h');
    expect(screen(app).join('\n')).not.toContain('not handed out');
    press('Escape');
    expect(screen(app).join('\n')).toBe(shown);
    press('F10');
    expect(app.screen).toBe('sheets');
  });

  it('does the colours and the sound keys, which stay as set when it closes', () => {
    const store = memoryStore();
    const { app, press } = newApp(store);
    press('h', 'F2');
    expect(app.blue).toBe(true);
    press('F4');
    expect(app.soundOn).toBe(false);
    expect(screen(app).join('\n')).toContain('Sound off.');
    press('Escape');
    expect(app.blue).toBe(true);
    expect(app.soundOn).toBe(false);
    expect(screen(app).join('\n')).not.toContain('Sound off.');
  });

  it('does not touch a saved run, or start a new one, even for the keys that do on the screen below', () => {
    const store = memoryStore();
    toNextMorning('1', 'small', 0, () => 0.37, store);
    const saved = store.data.get(RUN_KEY);
    const { app, press } = newApp(store);
    expect(app.screen).toBe('start');
    press('h', 'b', 's', 'Enter', 'c');
    expect(app.newRunAsk).toBeNull();
    expect(app.holding).toBe(false);
    expect(app.screen).toBe('start');
    press('Escape');
    expect(app.screen).toBe('start');
    expect(app.saved).not.toBeNull();
    expect(store.data.get(RUN_KEY)).toBe(saved);
  });

  it('drops a question to start a new run when it is opened, and starts nothing', () => {
    const store = memoryStore();
    toNextMorning('1', 'small', 0, () => 0.37, store);
    const saved = store.data.get(RUN_KEY);
    const { app, press } = newApp(store);
    press('b');
    expect(app.newRunAsk).toBe('big');
    press('h');
    expect(app.newRunAsk).toBeNull();
    app.tick();
    press('Escape');
    expect(app.screen).toBe('start');
    expect(store.data.get(RUN_KEY)).toBe(saved);
  });

  it('can be opened from the first screen of every day, over the day-2 messages, without a hold', () => {
    const x = toNextMorning('1', 'small', 0, () => 0.37);
    expect(x.app.run.day).toBe(2);
    const before = snapshot(x.app);
    x.press('h', 'b', 'Escape');
    expect(x.app.newRunAsk).toBeNull();
    expect(snapshot(x.app)).toEqual(before);
  });
});

describe('how to play on the road', () => {
  /** On the road with the trucks just out and the first tick waiting. */
  function onTheRoad() {
    const x = newApp();
    const { app, press } = x;
    const count = app.morning.trucks.length;
    press(' ');
    for (let n = 0; n < app.desk.orderCount; n++) {
      const o = app.orderSel;
      for (let l = 0; l < app.desk.order(o).lines.length; l++) press('Enter');
      for (let i = 0; i < count && !app.desk.isFinished(o); i++) press(...Array(count).fill('ArrowUp'), ...Array((n + i) % count).fill('ArrowDown'), 'Enter');
    }
    press('F10', 'F10', 'F9');
    expect(app.screen).toBe('road');
    expect(x.ticks).toHaveLength(1);
    return x;
  }

  it('waits: the clock does not move and the log does not fill while it is open', () => {
    const { app, press, runTicks } = onTheRoad();
    runTicks();
    const clock = app.roadClock;
    const log = screen(app).join('\n');
    expect(app.roadOver).toBe(false);
    // The tick that was already waiting when it opened is spent without effect, and nothing new is set going.
    press('h');
    runTicks();
    runTicks();
    press('ArrowRight');
    runTicks();
    expect(app.roadClock).toBe(clock);
    press('Escape');
    expect(screen(app).join('\n')).toBe(log);
    expect(app.roadClock).toBe(clock);
  });

  it('goes on from where it stood after it closes, a tick at a time', () => {
    const { app, press, runTicks } = onTheRoad();
    runTicks();
    const clock = app.roadClock;
    press('h', 'h');
    runTicks();
    expect(app.roadClock).toBe(clock + ROAD_STEP_MINUTES);
    for (let n = 0; n < 200 && !app.roadOver; n++) {
      if (app.roadCall) press('Enter');
      else runTicks();
    }
    expect(app.roadOver).toBe(true);
  });

  it('keeps a ringing phone ringing, with the same answer highlighted', () => {
    const { app, press, runTicks } = onTheRoad();
    for (let n = 0; n < 200 && !app.roadCall; n++) runTicks();
    expect(app.roadCall).not.toBeNull();
    press('ArrowDown');
    const call = app.roadCall;
    const text = screen(app).join('\n');
    press('h', 'Enter', ' ', 'ArrowDown');
    expect(app.answers.size).toBe(0);
    press('Escape');
    expect(app.roadCall).toBe(call);
    expect(app.callSel).toBe(1);
    expect(screen(app).join('\n')).toBe(text);
  });

  it('does not start the clock again after the road is left', () => {
    const { app, press, runTicks } = onTheRoad();
    press('h');
    // Nothing is waiting once it is open, and leaving it for the screen it came from starts one ticker only.
    press('h');
    runTicks();
    const first = app.roadClock;
    press('h', 'h', 'h', 'h');
    runTicks();
    expect(app.roadClock).toBe(first + ROAD_STEP_MINUTES);
  });
});
