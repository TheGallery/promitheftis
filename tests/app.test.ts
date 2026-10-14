import { describe, expect, it } from 'vitest';
import { ROAD_STEP_MINUTES, ROAD_TICK_MS } from '../src/game/road';
import { App, RING_GUARD_MS, type Effects } from '../src/ui/app';
import { allowCue, REPEAT_GAP, type CueArg, type Moment } from '../src/ui/cues';
import { COLS, plain, ROWS } from '../src/ui/grid';
import { screenLines } from '../src/ui/view';

function fakeEffects() {
  const log = { cues: [] as { moment: Moment; arg?: CueArg }[], printed: 0, sound: true, ticks: [] as (() => void)[], time: 0 };
  const effects: Effects = {
    cue: (moment, arg) => void log.cues.push({ moment, arg }),
    print: (lines) => {
      log.printed = lines;
      return 100;
    },
    // The road clock waits for the test to run its ticks; the printer runs at once.
    later: (fn, ms) => (ms === ROAD_TICK_MS ? void log.ticks.push(fn) : fn()),
    toggleSound: () => (log.sound = !log.sound),
    now: () => log.time,
  };
  return { effects, log };
}

function newApp(morning: 'small' | 'big' = 'small') {
  const fx = fakeEffects();
  const app = new App(fx.effects, () => {}, morning);
  // The helpers press each key well after the one before, as a player reading the screen would.
  const press = (...keys: string[]) => {
    for (const k of keys) {
      fx.log.time += 1000;
      app.press({ key: k });
    }
  };
  /** The sounds made by pressing each key in turn; an empty entry is a silent key. */
  const heard = (...keys: string[]) =>
    keys.map((k) => {
      const before = fx.log.cues.length;
      fx.log.time += 1000;
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

/** Skips along the road, answering every call with the first answer, and leaves for the result screen. */
function leaveRoad(press: (...k: string[]) => void, app: App) {
  for (let n = 0; n < 20 && !app.roadOver; n++) press(app.roadCall ? 'Enter' : ' ');
  press('Enter');
}

/** The keys that move the highlight in the TRUCKS pane to the given truck and choose it. */
function chooseTruck(truck: number): string[] {
  return [...Array(9).fill('ArrowUp'), ...Array(truck - 1).fill('ArrowDown'), 'Enter'];
}

/** Gives every line what is asked, as far as possible, and puts the order on a truck. */
function handOutNext(press: (...k: string[]) => void, app: App, truck: number) {
  const lines = app.desk.order(app.orderSel).lines.length;
  for (let l = 0; l < lines; l++) press('Enter');
  press(...chooseTruck(truck));
}

/** Like handOutNext, but tries the following trucks when one is too full. */
function handOutSomewhere(press: (...k: string[]) => void, app: App, first: number) {
  const o = app.orderSel;
  const lines = app.desk.order(o).lines.length;
  for (let l = 0; l < lines; l++) press('Enter');
  const count = app.morning.trucks.length;
  for (let i = 0; i < count && !app.desk.isFinished(o); i++) press(...chooseTruck(1 + ((first - 1 + i) % count)));
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

  it('makes the move and tab sounds on the desk, and none when a move changes nothing', () => {
    const { heard } = newApp();
    heard(' ');
    expect(heard('ArrowUp')).toEqual([[]]);
    expect(heard('ArrowDown')).toEqual([['move']]);
    expect(heard('Tab', 'Tab', 'ArrowDown', 'ArrowDown')).toEqual([['tab'], ['tab'], ['move'], ['move']]);
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

  it('makes the confirm sound for ENTER on a line and on an order, and the warning sound for a digit in another pane', () => {
    const { app, heard } = newApp();
    heard(' ');
    expect(heard('Enter')).toEqual([['confirm']]);
    heard('Tab');
    expect(app.pane).toBe('trucks');
    expect(heard('5')).toEqual([['warn']]);
    expect(app.status).toContain('typed in the LINES pane');
    heard('Tab');
    expect(app.pane).toBe('orders');
    expect(heard('5')).toEqual([['warn']]);
    expect(app.status).toContain('typed in the LINES pane');
    expect(heard('Enter')).toEqual([['confirm']]);
  });

  it('makes the truck sound when an order goes on a truck with lines still to do', () => {
    const { heard } = newApp();
    heard(' ');
    expect(heard('Tab', 'Enter')).toEqual([['tab'], ['truck']]);
  });

  it('makes the finish sound, not the confirm or truck sound, when an order is finished', () => {
    const { app, press, heard } = newApp();
    press(' ');
    const lines = app.desk.order(0).lines.length;
    const confirms = Array.from({ length: lines }, () => 'Enter');
    expect(heard(...confirms)).toEqual(confirms.map(() => ['confirm']));
    expect(heard(...chooseTruck(2)).filter((s) => s.length)).toEqual([['move'], ['finish']]);

    // The same, when ENTER on the last line is what finishes an order that already has a truck.
    press('Tab', 'Enter');
    const next = app.desk.order(app.orderSel).lines.length;
    const keys = Array.from({ length: next }, () => 'Enter');
    const sounds = heard(...keys);
    expect(sounds.slice(0, -1).every((s) => s[0] === 'confirm')).toBe(true);
    expect(sounds.at(-1)).toEqual(['finish']);
  });

  it('makes the warning sound instead of the ordinary one', () => {
    const { heard, press } = newApp();
    press(' ');
    // Ending the morning with orders left asks to be pressed again: a warning, then the ordinary sound.
    expect(heard('F10', 'F10')).toEqual([['warn'], ['confirm']]);
  });

  it('makes the warning sound, and only that, when a truck is too full for an order', () => {
    const { app, press, log } = newApp();
    press(' ');
    for (let i = 0; i < app.desk.orderCount && app.tone !== 'warn'; i++) handOutNext(press, app, 1);
    expect(app.status).toContain('too full');
    expect(log.cues.at(-1)).toEqual({ moment: 'warn', arg: undefined });
  });

  it('makes the sheet open and close sounds on the truck sheets, and keeps the printer to itself', () => {
    const { app, press, heard, log } = newApp();
    press(' ', 'Enter', 'Tab', 'Enter', 'F10', 'F10');
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

  it('makes the warning sound, not the printer, for P while the printer is still going', () => {
    const { app, press, heard, effects, log } = newApp();
    press(' ', 'Enter', 'Tab', 'Enter', 'F10', 'F10');
    effects.later = () => {};
    expect(heard('p')).toEqual([[]]);
    const printed = log.printed;
    log.printed = 0;
    expect(heard('p')).toEqual([['warn']]);
    expect(app.status).toContain('still going');
    expect(log.printed).toBe(0);
    expect(printed).toBeGreaterThan(0);
  });

  it('makes the confirm sound when the trucks are sent and the move sound on the result', () => {
    const { app, press, heard } = newApp();
    press(' ', 'Enter', 'Tab', 'Enter', 'F10', 'F10');
    expect(heard('F9')).toEqual([['confirm']]);
    expect(app.screen).toBe('road');
    // The first skip stops at a call and the phone rings; answering it is a confirm, then the rest of the road.
    expect(heard(' ', 'Enter', ' ')).toEqual([['ring'], ['confirm'], ['confirm']]);
    expect(app.roadOver).toBe(true);
    expect(heard('Enter')).toEqual([['confirm']]);
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
    for (const word of ['ORDERS', 'LINES', 'TRUCKS', 'HEADS UP', 'ketchup: 16 asked today, 12 on hand', 'SALTMARKET', 'Oakley', 'Ashby']) {
      expect(text).toContain(word);
    }
  });

  it('shows the full Saltmarket name in the orders list', () => {
    const { app, press } = newApp();
    press(' ');
    const lines = expectFullScreen(app);
    const row = lines.find((l) => l.includes('Café Lumen'));
    expect(row).toContain('Saltmarket');
    expect(lines.join('\n')).not.toContain('Saltmark…');
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
    expect(app.status).toContain('Choose a truck');
    expect(app.desk.isFinished(0)).toBe(false);
    press(...chooseTruck(2));
    expect(app.desk.truckFor(0)).toBe(2);
    expect(app.desk.isFinished(0)).toBe(true);
    expect(app.orderSel).toBe(1);
    expect(app.pane).toBe('lines');
    expect(app.lineSel).toBe(0);
  });

  it('picks a truck in the trucks pane, and goes back to the lines still to do', () => {
    const { app, press } = newApp();
    press(' ', 'Tab', 'Enter');
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

  it('does nothing with the keys T and 1-9 on trucks, and a digit outside the lines pane only warns', () => {
    const { app, press } = newApp();
    press(' ', 't', '7');
    expect(app.desk.truckFor(0)).toBeNull();
    press('Tab', '3');
    expect(app.status).toContain('typed in the LINES pane');
    press('t');
    expect(app.desk.truckFor(0)).toBeNull();
    expect(app.truckSel).toBe(0);
    press('Tab', 'Tab', '5');
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
    press('Tab', 'Enter');
    expect(expectFullScreen(app).join('\n')).toContain('▶ 1');
  });
});

describe('a whole small morning', () => {
  function play() {
    const t = newApp();
    t.press(' ');
    // Truck 1: Saltmarket and Docks. Truck 2: Fenwick and Millford.
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

  it('shows the game name in the header of every screen', () => {
    const { app, press } = play();
    const header = () => expectFullScreen(app)[0];
    press('F10');
    expect(app.screen).toBe('sheets');
    expect(header()).toContain(' PROMITHEFTIS · ');
    press('F9');
    expect(app.screen).toBe('road');
    expect(header()).toContain(' PROMITHEFTIS · ');
    leaveRoad(press, app);
    expect(app.screen).toBe('result');
    expect(header()).toContain(' PROMITHEFTIS · ');
    press('r');
    expect(app.screen).toBe('messages');
    expect(header()).toContain(' PROMITHEFTIS · ');
    press(' ');
    expect(app.screen).toBe('desk');
    expect(header()).toContain(' PROMITHEFTIS · ');
  });

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
    expect(text).toContain('Saltmarket, Docks');
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
    leaveRoad(press, app);
    expect(app.screen).toBe('result');
    const text = expectFullScreen(app).join('\n');
    expect(text).toContain('THE TRUCKS HAVE GONE');
    expect(text).toContain('WHO GOT LESS');
    expect(text).toContain('last truck back at');
  });

  it('runs the road clock a few minutes per tick, filling the log, until every truck is back', () => {
    const { app, press, log } = play();
    press('F10', 'F9');
    expect(app.screen).toBe('road');
    const start = app.roadClock;
    expect(start).toBe(7 * 60);
    expect(log.ticks).toHaveLength(1);
    expect(expectFullScreen(app).join('\n')).toContain('leaves the depot');
    log.ticks.shift()!();
    expect(app.roadClock).toBe(start + ROAD_STEP_MINUTES);
    expect(app.roadOver).toBe(false);
    leaveRoad(press, app);
    expect(app.screen).toBe('result');
    expect(app.roadOver).toBe(true);
    // A tick left over from before the skip changes nothing.
    log.ticks.splice(0).forEach((fn) => fn());
    expect(app.roadClock).toBe(app.road?.end);
  });

  it('logs each delivery in the screen text, and each truck back', () => {
    const { app, press } = play();
    press('F10', 'F9');
    for (let n = 0; n < 20 && !app.roadOver; n++) press(app.roadCall ? 'Enter' : ' ');
    const text = expectFullScreen(app).join('\n');
    expect(text).toMatch(/\d\d:\d\d Truck 2 · The Plough, Fenwick · \d+ items/);
    expect(text).toContain('a little short');
    expect(text).toContain('back at the depot');
    expect(text).toContain('Every truck is back at the depot.');
  });

  it('skips with SPACE or ENTER, then ENTER goes to the result and SPACE does not', () => {
    const { app, press } = play();
    press('F10', 'F9');
    for (let n = 0; n < 20 && !app.roadOver; n++) press(app.roadCall ? 'Enter' : ' ');
    expect(app.screen).toBe('road');
    expect(app.roadOver).toBe(true);
    press(' ');
    expect(app.screen).toBe('road');
    press('Enter');
    expect(app.screen).toBe('result');
  });

  it('rings at the call time, pauses the log and waits for an answer', () => {
    const { app, press, log } = play();
    press('F10', 'F9');
    const first = app.calls[0]!;
    expect(app.roadCall).toBeNull();
    // Ticks run the clock to the call, not past it.
    let guard = 0;
    while (!app.roadCall && guard++ < 200) log.ticks.shift()!();
    expect(app.roadClock).toBe(first.at);
    expect(app.roadCall).toBe(first);
    expect(log.cues.at(-1)?.moment).toBe('ring');
    // The log is paused: no tick is waiting and old ones change nothing.
    expect(log.ticks).toHaveLength(0);
    const text = expectFullScreen(app).join('\n');
    expect(text).toContain('INCOMING CALL');
    expect(text).toContain(first.client);
    expect(text).toContain(first.options[0]!.label);
    expect(text).toContain('choose an answer');
    // SPACE does not skip the call.
    press(' ');
    expect(app.roadCall).toBe(first);
    expect(app.roadClock).toBe(first.at);
    expect(app.status).toContain('Answer the call');
    // Answering starts the ticks again.
    press('Enter');
    expect(app.roadCall).toBeNull();
    expect(log.ticks).toHaveLength(1);
    log.ticks.shift()!();
    expect(app.roadClock).toBeGreaterThan(first.at);
  });

  it('picks an answer with the arrow keys and records that one', () => {
    const { app, press, heard } = play();
    press('F10', 'F9', ' ');
    const call = app.roadCall!;
    expect(call.options.length).toBeGreaterThanOrEqual(2);
    expect(app.callSel).toBe(0);
    expect(heard('ArrowUp')).toEqual([[]]);
    expect(heard('ArrowDown')).toEqual([['move']]);
    expect(app.callSel).toBe(1);
    expect(expectFullScreen(app).join('\n')).toMatch(new RegExp(`▶ ${call.options[1]!.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    press('ArrowDown', 'ArrowDown');
    expect(app.callSel).toBe(call.options.length - 1);
    press('ArrowUp');
    press('Enter');
    expect(app.answers.get(call.id)).toBe(call.options.length - 2);
    expect(app.callSel).toBe(0);
    // The answer is noted in the log.
    expect(expectFullScreen(app).join('\n')).toMatch(/\d\d:\d\d Call · /);
  });

  it('stops SPACE skipping at each call that has not been answered', () => {
    const { app, press } = play();
    press('F10', 'F9');
    const stops: number[] = [];
    for (let n = 0; n < 20 && !app.roadOver; n++) {
      if (app.roadCall) press('Enter');
      else {
        press(' ');
        if (app.roadCall) stops.push(app.roadClock);
      }
    }
    expect(stops).toEqual(app.calls.map((c) => c.at));
    expect(app.calls.length).toBeGreaterThanOrEqual(2);
    expect(app.roadOver).toBe(true);
    expect(app.answers.size).toBe(app.calls.length);
  });

  it('ignores ENTER and SPACE for a moment after a call starts ringing, then ENTER answers', () => {
    const { app, press, log } = play();
    press('F10', 'F9', ' ');
    const call = app.roadCall!;
    expect(call).not.toBeNull();
    // A quick second press of the skip key does not answer the call that has just rung.
    log.time += RING_GUARD_MS - 1;
    app.press({ key: 'Enter' });
    app.press({ key: ' ' });
    expect(app.roadCall).toBe(call);
    expect(app.answers.has(call.id)).toBe(false);
    expect(app.status).toBe('');
    // After the moment has passed, SPACE still does not answer, and ENTER does.
    log.time += 1;
    app.press({ key: ' ' });
    expect(app.answers.has(call.id)).toBe(false);
    expect(app.status).toContain('Answer the call');
    app.press({ key: 'Enter' });
    expect(app.answers.get(call.id)).toBe(0);
  });

  it('starts the moment when a tick makes the phone ring, not when a key is pressed', () => {
    const { app, press, log } = play();
    press('F10', 'F9');
    let guard = 0;
    while (!app.roadCall && guard++ < 200) log.ticks.shift()!();
    const call = app.roadCall!;
    app.press({ key: 'Enter' });
    expect(app.answers.has(call.id)).toBe(false);
    log.time += RING_GUARD_MS;
    app.press({ key: 'Enter' });
    expect(app.answers.has(call.id)).toBe(true);
  });

  it('neither answers nor skips with a held ENTER or SPACE', () => {
    const { app, press, log } = play();
    press('F10', 'F9');
    const start = app.roadClock;
    app.press({ key: ' ', repeat: true });
    app.press({ key: 'Enter', repeat: true });
    expect(app.roadClock).toBe(start);
    press(' ');
    const call = app.roadCall!;
    log.time += RING_GUARD_MS * 10;
    app.press({ key: 'Enter', repeat: true });
    expect(app.answers.has(call.id)).toBe(false);
    app.press({ key: 'Enter' });
    expect(app.answers.has(call.id)).toBe(true);
  });

  it('does not let ENTER leave the road while a call is unanswered', () => {
    const { app, press } = play();
    press('F10', 'F9', ' ');
    expect(app.roadCall).not.toBeNull();
    expect(app.roadOver).toBe(false);
    press('Enter');
    expect(app.screen).toBe('road');
  });

  it('shows the answers on the result screen, one short line each', () => {
    const { app, press } = play();
    press('F10', 'F9');
    const chosen: string[] = [];
    for (let n = 0; n < 20 && !app.roadOver; n++) {
      if (app.roadCall) {
        const call = app.roadCall;
        press('ArrowDown', 'Enter');
        chosen.push(`${call.client} · ${call.topic} · ${call.options[1]!.record}`);
      } else press(' ');
    }
    press('Enter');
    expect(app.screen).toBe('result');
    expect(app.callLines).toEqual(chosen);
    const text = expectFullScreen(app).join('\n');
    expect(text).toContain('CALLS');
    for (const line of chosen) expect(text).toContain(line);
    expect(text).toContain('told not today');
  });

  it('goes on to an indented second line when a call line is too long, so the amount always shows', () => {
    const { app, press } = play();
    press('F10', 'F9');
    leaveRoad(press, app);
    const base = app.calls.find((c) => c.kind === 'short')!;
    const long = {
      ...base,
      id: 99,
      client: 'The Grand Harbourside Seafood Brasserie',
      topic: 'short on extra-large frozen king prawns',
      qty: 12,
      options: [{ label: "Add the rest to tomorrow's order", record: 'added 12 to tomorrow', addsToOrder: true }],
    };
    app.calls = [...app.calls, long];
    app.answers.set(99, 0);
    const lines = expectFullScreen(app);
    const at = lines.findIndex((l) => l.includes('The Grand Harbourside Seafood Brasserie'));
    expect(at).toBeGreaterThan(-1);
    const rows = [lines[at]!, lines[at + 1]!].map((l) => l.slice(0, 58).trimEnd());
    expect(rows[0]).not.toContain('…');
    expect(rows[1]).toMatch(/^ {3}\S/);
    expect(rows.map((r) => r.trim()).join(' ')).toBe(
      'The Grand Harbourside Seafood Brasserie · short on extra-large frozen king prawns · added 12 to tomorrow',
    );
  });

  it('forgets the calls when the morning is played again', () => {
    const { app, press } = play();
    press('F10', 'F9');
    leaveRoad(press, app);
    expect(app.callLines.length).toBeGreaterThan(0);
    press('r');
    expect(app.calls).toEqual([]);
    expect(app.answers.size).toBe(0);
  });

  it('stays quiet with F4 off: the ring is only asked for, the effects decide', () => {
    const { app, press, log } = play();
    press('F4', 'F10', 'F9');
    expect(log.sound).toBe(false);
    press(' ');
    expect(app.roadCall).not.toBeNull();
  });

  it('stops the ticks once the road is left', () => {
    const { app, press, log } = play();
    press('F10', 'F9');
    leaveRoad(press, app);
    expect(app.screen).toBe('result');
    const before = app.roadClock;
    log.ticks.splice(0).forEach((fn) => fn());
    expect(app.roadClock).toBe(before);
    expect(app.screen).toBe('result');
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
    press('F10', 'F9');
    leaveRoad(press, app);
    press('r');
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
    expect(app.screen).toBe('road');
    expectFullScreen(app);
    for (let n = 0; n < 20 && !app.roadOver; n++) {
      press(app.roadCall ? 'Enter' : ' ');
      expectFullScreen(app);
    }
    expect(app.calls.length).toBeGreaterThan(2);
    expect(app.callLines).toHaveLength(app.calls.length);
    press('Enter');
    expect(app.screen).toBe('result');
    // Every call is on the screen in full, below the CALLS heading of the left column.
    const left = expectFullScreen(app).map((l) => l.slice(0, 58).trimEnd());
    const calls = left.slice(left.findIndex((l) => l === ' CALLS') + 1).filter((l) => l.startsWith(' '));
    expect(calls.join('\n')).not.toContain('…');
    const joined = calls.map((l) => l.trim()).join(' ');
    for (const line of app.callLines) expect(joined).toContain(line);
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
