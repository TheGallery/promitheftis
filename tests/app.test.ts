import { describe, expect, it } from 'vitest';
import { App, type Effects } from '../src/ui/app';
import { allowCue, REPEAT_GAP, type CueArg, type Moment } from '../src/ui/cues';
import { COLS, plain, ROWS } from '../src/ui/grid';
import { screenLines } from '../src/ui/view';

function fakeEffects() {
  const log = { cues: [] as { moment: Moment; arg?: CueArg }[], printed: 0, sound: true };
  const effects: Effects = {
    cue: (moment, arg) => void log.cues.push({ moment, arg }),
    print: (lines) => {
      log.printed = lines;
      return 100;
    },
    later: (fn) => fn(),
    toggleSound: () => (log.sound = !log.sound),
  };
  return { effects, log };
}

function newApp(morning: 'small' | 'big' = 'small') {
  const fx = fakeEffects();
  const app = new App(fx.effects, () => {}, morning);
  const press = (...keys: string[]) => {
    for (const k of keys) app.press({ key: k });
  };
  /** The sounds made by pressing each key in turn; an empty entry is a silent key. */
  const heard = (...keys: string[]) =>
    keys.map((k) => {
      const before = fx.log.cues.length;
      app.press({ key: k });
      return fx.log.cues.slice(before).map((c) => c.moment);
    });
  return { app, press, heard, ...fx };
}

/** Every screen is exactly 120 columns by 30 rows. */
function expectFullScreen(app: App) {
  const lines = plain(screenLines(app));
  expect(lines).toHaveLength(ROWS);
  for (const l of lines) expect([...l]).toHaveLength(COLS);
  return lines;
}

/** Gives every line what is asked, as far as possible, and puts the order on a truck. */
function handOutNext(press: (...k: string[]) => void, app: App, truck: number) {
  const lines = app.desk.order(app.orderSel).lines.length;
  for (let l = 0; l < lines; l++) press('Enter');
  press('t', String(truck));
}

/** Like handOutNext, but tries the following trucks when one is too full. */
function handOutSomewhere(press: (...k: string[]) => void, app: App, first: number) {
  const o = app.orderSel;
  const lines = app.desk.order(o).lines.length;
  for (let l = 0; l < lines; l++) press('Enter');
  const count = app.morning.trucks.length;
  for (let i = 0; i < count && !app.desk.isFinished(o); i++) press('t', String(1 + ((first - 1 + i) % count)));
}

describe('overnight messages', () => {
  it('lists the messages and moves through them', () => {
    const { app, press } = newApp();
    expect(app.screen).toBe('messages');
    const text = expectFullScreen(app).join('\n');
    expect(text).toContain('OVERNIGHT MESSAGES');
    expect(text).toContain('SPACE');
    press('ArrowDown', 'ArrowDown');
    expect(app.msgSel).toBe(2);
    press('ArrowUp', 'ArrowUp', 'ArrowUp');
    expect(app.msgSel).toBe(0);
  });

  it('starts the morning on SPACE', () => {
    const { app, press } = newApp();
    press(' ');
    expect(app.screen).toBe('desk');
  });

  it('loads the big morning with B and the small one with S', () => {
    const { app, press } = newApp();
    press('b');
    expect(app.morning.trucks).toHaveLength(9);
    expect(app.morning.orders).toHaveLength(38);
    expectFullScreen(app);
    for (let i = 0; i < 60; i++) press('ArrowDown');
    expectFullScreen(app);
    press('s');
    expect(app.morning.trucks).toHaveLength(2);
    expect(app.screen).toBe('messages');
    expect(app.msgSel).toBe(0);
  });

  it('turns the colours over on F2 and the sound off on F4', () => {
    const { app, press, log } = newApp();
    press('F2');
    expect(app.blue).toBe(true);
    press('F2');
    expect(app.blue).toBe(false);
    press('F4');
    expect(app.soundOn).toBe(false);
    expect(log.sound).toBe(false);
  });

  it('makes no sound for keys it does not use', () => {
    const { heard } = newApp();
    expect(heard('ArrowDown', 'q')).toEqual([['move'], []]);
  });
});

describe('sounds', () => {
  it('makes a sound for each way of moving through the messages, and none at the ends', () => {
    const { heard } = newApp();
    expect(heard('ArrowUp', 'ArrowDown', 'PageDown', 'PageUp', 'ArrowUp')).toEqual([[], ['move'], ['move'], ['move'], []]);
  });

  it('makes the confirm sound for SPACE, B and S, and for F2 and F4', () => {
    const { heard } = newApp();
    expect(heard('b', 's', ' ', 'F2', 'F4')).toEqual([['confirm'], ['confirm'], ['confirm'], ['confirm'], ['confirm']]);
  });

  it('makes the move, tab and truck key sounds on the desk, and none when a move changes nothing', () => {
    const { heard } = newApp();
    heard(' ');
    expect(heard('ArrowUp')).toEqual([[]]);
    expect(heard('ArrowDown')).toEqual([['move']]);
    expect(heard('Tab', 'Tab', 'ArrowDown', 'ArrowDown')).toEqual([['tab'], ['tab'], ['move'], ['move']]);
    expect(heard('t')).toEqual([['truckKey']]);
  });

  it('tells a digit, a nudge either way and a backspace apart, and keeps still when the line cannot change', () => {
    const { app, press, log } = newApp();
    press(' ');
    log.cues.length = 0;
    press('3', 'ArrowRight', 'ArrowLeft', 'Backspace');
    expect(log.cues).toEqual([
      { moment: 'digit', arg: undefined },
      { moment: 'nudge', arg: { dir: 1 } },
      { moment: 'nudge', arg: { dir: -1 } },
      { moment: 'digit', arg: undefined },
    ]);
    // Nothing more to take off: the key changes nothing and stays silent.
    log.cues.length = 0;
    press('Backspace', 'ArrowLeft');
    expect(app.desk.given(0, 0)).toBe(0);
    expect(log.cues.map((c) => c.moment)).toEqual([]);
  });

  it('makes the confirm sound for ENTER on a line and on an order, and no sound for a digit in another pane', () => {
    const { heard } = newApp();
    heard(' ');
    expect(heard('Enter')).toEqual([['confirm']]);
    heard('Tab', 'Tab');
    expect(heard('5')).toEqual([[]]);
    expect(heard('Enter')).toEqual([['confirm']]);
  });

  it('makes the truck sound when an order goes on a truck with lines still to do', () => {
    const { heard } = newApp();
    heard(' ');
    expect(heard('t', '1')).toEqual([['truckKey'], ['truck']]);
  });

  it('makes the finish sound, not the confirm or truck sound, when an order is finished', () => {
    const { app, press, heard } = newApp();
    press(' ');
    const lines = app.desk.order(0).lines.length;
    const confirms = Array.from({ length: lines }, () => 'Enter');
    expect(heard(...confirms)).toEqual(confirms.map(() => ['confirm']));
    expect(heard('t', '2')).toEqual([['truckKey'], ['finish']]);

    // The same, when ENTER on the last line is what finishes an order that already has a truck.
    press('t', '2');
    const next = app.desk.order(app.orderSel).lines.length;
    const keys = Array.from({ length: next }, () => 'Enter');
    const sounds = heard(...keys);
    expect(sounds.slice(0, -1).every((s) => s[0] === 'confirm')).toBe(true);
    expect(sounds.at(-1)).toEqual(['finish']);
  });

  it('makes the warning sound instead of the ordinary one', () => {
    const { heard, press } = newApp();
    press(' ');
    expect(heard('t', '7')).toEqual([['truckKey'], ['warn']]);
    // Ending the morning with orders left asks to be pressed again: a warning, then the ordinary sound.
    expect(heard('F10', 'F10')).toEqual([['warn'], ['confirm']]);
  });

  it('makes the warning sound, and only that, when a truck is too full for an order', () => {
    const { app, press, log } = newApp();
    press(' ');
    for (let i = 0; i < app.desk.orderCount && app.tone !== 'warn'; i++) handOutNext(press, app, 1);
    expect(app.status).toContain('too full');
    expect(log.cues.at(-1)).toEqual({ moment: 'warn', arg: undefined });
    expect(log.cues.at(-2)?.moment).toBe('truckKey');
  });

  it('makes the sheet open and close sounds on the truck sheets, and keeps the printer to itself', () => {
    const { app, press, heard, log } = newApp();
    press(' ', 'Enter', 't', '1', 'F10', 'F10');
    expect(app.screen).toBe('sheets');
    expect(heard('ArrowUp')).toEqual([[]]);
    expect(heard('ArrowDown')).toEqual([['move']]);
    expect(heard('ArrowUp', 'Enter', 'Enter')).toEqual([['move'], ['sheetOpen'], ['sheetClose']]);
    expect(heard('+', '+', '-', '-')).toEqual([['sheetOpen'], [], ['sheetClose'], []]);
    expect(heard('p')).toEqual([[]]);
    expect(log.printed).toBeGreaterThan(0);
    expect(heard('Escape')).toEqual([['sheetClose']]);
    expect(app.screen).toBe('desk');
  });

  it('makes the confirm sound when the trucks are sent and the move sound on the result', () => {
    const { app, press, heard } = newApp();
    press(' ', 'Enter', 't', '1', 'F10', 'F10');
    expect(heard('F9')).toEqual([['confirm']]);
    expect(app.screen).toBe('result');
    expect(heard('ArrowUp', 'ArrowDown', 'q', 'r')).toEqual([[], ['move'], [], ['confirm']]);
  });

  it('plays nothing when the sounds are off: the effects decide, the app still asks', () => {
    const { heard, log } = newApp();
    expect(heard('F4')).toEqual([['confirm']]);
    expect(log.sound).toBe(false);
  });
});

describe('repeated sounds', () => {
  it('drops the same moment within the repeat gap and lets a different one through', () => {
    const last = new Map<Moment, number>();
    expect(allowCue(last, 'move', 1)).toBe(true);
    expect(allowCue(last, 'move', 1 + REPEAT_GAP / 2)).toBe(false);
    expect(allowCue(last, 'warn', 1 + REPEAT_GAP / 2)).toBe(true);
    expect(allowCue(last, 'move', 1 + REPEAT_GAP)).toBe(true);
  });

  it('measures the gap from the last sound that was played, not the last that was dropped', () => {
    const last = new Map<Moment, number>();
    expect(allowCue(last, 'move', 0)).toBe(true);
    expect(allowCue(last, 'move', 0.02)).toBe(false);
    expect(allowCue(last, 'move', 0.03)).toBe(true);
  });
});

describe('order desk', () => {
  it('shows the three panes, the heads up line and the map', () => {
    const { app, press } = newApp();
    press(' ');
    const text = expectFullScreen(app).join('\n');
    for (const word of ['ORDERS', 'LINES', 'TRUCKS', 'HEADS UP', 'ketchup: 16 asked today, 12 on hand', 'TOWN', 'Oakley', 'Ashby']) {
      expect(text).toContain(word);
    }
  });

  it('moves between panes with TAB and back with shift-TAB', () => {
    const { app, press } = newApp();
    press(' ');
    expect(app.pane).toBe('lines');
    press('Tab');
    expect(app.pane).toBe('trucks');
    press('Tab');
    expect(app.pane).toBe('orders');
    app.press({ key: 'Tab', shift: true });
    expect(app.pane).toBe('trucks');
  });

  it('moves within a pane with the arrows', () => {
    const { app, press } = newApp();
    press(' ', 'ArrowDown', 'ArrowDown');
    expect(app.lineSel).toBe(2);
    press('Tab', 'Tab', 'ArrowDown');
    expect(app.pane).toBe('orders');
    expect(app.orderSel).toBe(1);
    expect(app.lineSel).toBe(0);
  });

  it('types an amount, and the line shows it', () => {
    const { app, press } = newApp();
    press(' ', '3');
    expect(app.desk.given(0, 0)).toBe(3);
    press('9');
    // Only 5 pork were asked for, so 39 is cut back to the most that can be given.
    expect(app.desk.given(0, 0)).toBe(5);
    press('Backspace');
    expect(app.desk.given(0, 0)).toBe(0);
  });

  it('adds and takes off one with the arrow keys', () => {
    const { app, press } = newApp();
    press(' ', 'ArrowLeft');
    expect(app.desk.given(0, 0)).toBe(4);
    press('ArrowLeft', 'ArrowLeft', 'ArrowRight');
    expect(app.desk.given(0, 0)).toBe(3);
  });

  it('takes ENTER as "give it" and moves to the next line', () => {
    const { app, press } = newApp();
    press(' ', 'Enter');
    expect(app.desk.given(0, 0)).toBe(5);
    expect(app.lineSel).toBe(1);
  });

  it('asks for a truck after the last line and then moves on to the next order', () => {
    const { app, press } = newApp();
    press(' ');
    const lines = app.desk.order(0).lines.length;
    for (let l = 0; l < lines; l++) press('Enter');
    expect(app.pane).toBe('trucks');
    expect(app.status).toContain('pick a truck');
    expect(app.desk.isFinished(0)).toBe(false);
    press('t', '2');
    expect(app.desk.truckFor(0)).toBe(2);
    expect(app.desk.isFinished(0)).toBe(true);
    expect(app.orderSel).toBe(1);
    expect(app.pane).toBe('lines');
    expect(app.lineSel).toBe(0);
  });

  it('picks a truck with T then 1-9 from any pane, and goes back to the lines still to do', () => {
    const { app, press } = newApp();
    press(' ', 'Tab', 'Tab', 't', '1');
    expect(app.desk.truckFor(0)).toBe(1);
    expect(app.desk.isFinished(0)).toBe(false);
    expect(app.pane).toBe('lines');
    expect(app.orderSel).toBe(0);
  });

  it('picks the truck under the cursor with ENTER in the trucks pane', () => {
    const { app, press } = newApp();
    press(' ', 'Tab', 'ArrowDown', 'Enter');
    expect(app.desk.truckFor(0)).toBe(2);
  });

  it('says so when there is no such truck, and lets ESC drop the T', () => {
    const { app, press } = newApp();
    press(' ', 't', '7');
    expect(app.desk.truckFor(0)).toBeNull();
    expect(app.status).toContain('no truck 7');
    press('t', 'Escape');
    expect(app.truckPending).toBe(false);
    press('5');
    expect(app.desk.given(0, 0)).toBe(5);
  });

  it('moves the clock a minute per action, not for keystrokes', () => {
    const { app, press } = newApp();
    press(' ');
    const start = app.desk.clock;
    press('3', 'ArrowRight', 'ArrowLeft', 'Tab', 'Tab');
    expect(app.desk.clock).toBe(start);
    press('Tab');
    handOutNext(press, app, 1);
    expect(app.desk.clock).toBe(start + 2);
  });

  it('warns before leaving orders unhandled and goes on with a second F10', () => {
    const { app, press } = newApp();
    press(' ', 'F10');
    expect(app.screen).toBe('desk');
    expect(app.status).toContain('not handed out');
    press('F10');
    expect(app.screen).toBe('sheets');
  });

  it("lights the current order's square on the map", () => {
    const { app, press } = newApp();
    press(' ');
    expect(expectFullScreen(app).join('\n')).toContain('▶ no truck');
    press('t', '1');
    expect(expectFullScreen(app).join('\n')).toContain('▶ 1');
  });
});

describe('a whole small morning', () => {
  function play() {
    const t = newApp();
    t.press(' ');
    // Truck 1: Town and Docks. Truck 2: Fenwick and Millford.
    const trucks: Record<string, number> = {
      'Café Lumen': 1, "Rosa's": 2, 'The Anchor': 2, 'Golden Dragon': 1, 'Hotel Bellevue': 1, 'Burger Shack': 1, 'The Plough': 2,
    };
    for (let n = 0; n < 7; n++) {
      const name = t.app.desk.order(t.app.orderSel).client;
      handOutNext(t.press, t.app, trucks[name] as number);
      expectFullScreen(t.app);
    }
    return t;
  }

  it('finishes every order and says so', () => {
    const { app } = play();
    expect(app.desk.unfinishedCount()).toBe(0);
    expect(app.status).toContain('Every order is handed out');
  });

  it('shows the truck sheets with an accordion and a route', () => {
    const { app, press } = play();
    press('F10');
    expect(app.screen).toBe('sheets');
    let text = expectFullScreen(app).join('\n');
    expect(text).toContain('TRUCK SHEETS');
    expect(text).toContain('LOADING');
    expect(text).toContain('STORE ROOM');
    expect(text).toContain('Town, Docks');
    press('Enter');
    text = expectFullScreen(app).join('\n');
    expect(text).toContain('TRUCK 1 · ROUTE');
    expect(text).toContain('back at the depot');
    expect(text).toContain('Café Lumen');
    press('-');
    expect(app.sheetOpen.size).toBe(0);
    press('+');
    expect(app.sheetOpen.size).toBe(2);
  });

  it('prints with P and sends the trucks with F9', () => {
    const { app, press, log } = play();
    press('F10', 'p');
    expect(log.printed).toBe(4);
    expect(app.printed).toBe(true);
    expect(expectFullScreen(app).join('\n')).toContain('Truck sheets printed.');
    press('F9');
    expect(app.screen).toBe('result');
    const text = expectFullScreen(app).join('\n');
    expect(text).toContain('THE TRUCKS HAVE GONE');
    expect(text).toContain('WHO GOT LESS');
    expect(text).toContain('last truck back at');
  });

  it('reports who got less when the stock ran short', () => {
    const { app, press } = play();
    press('F10', 'F9');
    const less = app.result?.gotLess.map((g) => g.client) ?? [];
    // 16 ketchup were asked for and 12 were on hand: the last to ask went short.
    expect(less).toContain('The Plough');
    expect(less).not.toContain('Café Lumen');
  });

  it('goes back to the desk with ESC from the sheets and plays again with R', () => {
    const { app, press } = play();
    press('F10', 'Escape');
    expect(app.screen).toBe('desk');
    press('F10', 'F9', 'r');
    expect(app.screen).toBe('messages');
    expect(app.desk.unfinishedCount()).toBe(7);
  });

  it('will not send trucks with nothing on them', () => {
    const { app, press } = newApp();
    press(' ', 'F10', 'F10', 'F9');
    expect(app.screen).toBe('sheets');
    expect(app.status).toContain('Nothing is loaded');
  });
});

describe('the big morning', () => {
  it('draws every screen at full size while going through all 38 orders', () => {
    const { app, press } = newApp('big');
    press(' ');
    expectFullScreen(app);
    for (let n = 0; n < 38; n++) {
      handOutSomewhere(press, app, 1 + (n % 9));
      expectFullScreen(app);
    }
    press('Tab', 'Tab');
    expectFullScreen(app);
    press('F10');
    expect(app.screen).toBe('sheets');
    press('+');
    for (let i = 0; i < 9; i++) {
      press('ArrowDown');
      expectFullScreen(app);
    }
    press('F9');
    expect(app.screen).toBe('result');
    for (let i = 0; i < 40; i++) {
      press('ArrowDown');
      expectFullScreen(app);
    }
  });

  it('shows all nine trucks with the map under them', () => {
    const { app, press } = newApp('big');
    press(' ');
    const text = expectFullScreen(app).join('\n');
    for (let t = 1; t <= 9; t++) expect(text).toContain(`${t} ${app.morning.trucks[t - 1]?.driver}`);
    expect(text).toContain('Southgate');
  });
});
