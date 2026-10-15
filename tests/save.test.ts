import { afterEach, describe, expect, it, vi } from 'vitest';
import { bigMorning, smallMorning } from '../src/game/morning';
import { nextDay, runFromMorning, type RunState } from '../src/game/run';
import { decodeRun, decodeSettings, encodeRun, encodeSettings, SAVE_VERSION } from '../src/game/save';
import { App, HOLD_MS, RUN_KEY, SETTINGS_KEY, type Effects } from '../src/ui/app';
import { screenLines } from '../src/ui/view';
import { browserStore, memoryStore, type Store } from '../src/ui/store';
import { fakeEffects, holdNewRun, playToSupply, screen, toDay, toNextMorning } from './helpers';

const RANDOM = () => 0.37;
const SEED = Math.floor(0.37 * 4294967296);

/** A run a few days in: moods, history, promises and a delivery all filled in, a truck and a client added. */
function laterRun(): RunState {
  const base = runFromMorning(smallMorning());
  const day2 = nextDay(base, {
    left: { chips: 4 },
    ordered: { chips: 6, pork: 2 },
    moods: { "Rosa's": 'let down', 'The Anchor': 'a bit let down', 'The Plough': 'pleased' },
    today: {
      "Rosa's": { percent: 40, late: true, lacked: [{ item: 'pork', asked: 5, given: 2 }] },
      'The Plough': { percent: 100, late: false, lacked: [] },
    },
    promises: [{ client: "Rosa's", item: 'chips', qty: 3 }],
    growth: { kind: 'truck' },
    earned: 340,
  });
  return nextDay(day2, {
    left: {},
    ordered: { eggs: 5 },
    moods: { "Rosa's": 'pleased' },
    today: { "Rosa's": { percent: 100, late: false, lacked: [] } },
    promises: [],
    growth: { kind: 'client', client: { name: 'The Salt Cellar', place: 'saltmarket', contact: 'Ines' } },
    earned: -80,
  });
}

/** The saved run as plain data, to be spoiled in one place. */
function saved(): Record<string, any> {
  return JSON.parse(encodeRun(laterRun(), SEED));
}

describe('saving a run', () => {
  it.each([['small', smallMorning], ['big', bigMorning]] as const)('keeps the %s morning as it began', (_, load) => {
    const run = runFromMorning(load());
    expect(decodeRun(encodeRun(run, 0))).toEqual({ run, daySeed: 0 });
  });

  it('keeps a run several days in, with everything that carries over, and the seed of its day', () => {
    const run = laterRun();
    expect(run.day).toBe(3);
    expect(decodeRun(encodeRun(run, SEED))).toEqual({ run, daySeed: SEED });
  });

  it('writes the version of the data', () => {
    expect(JSON.parse(encodeRun(laterRun(), 1)).version).toBe(SAVE_VERSION);
  });

  it('leaves out what a run does not hold', () => {
    const data = saved();
    data.run.extra = 'x';
    data.run.clients[0].extra = 'x';
    expect(decodeRun(JSON.stringify(data))?.run).toEqual(laterRun());
  });

  it.each([
    ['empty text', () => ''],
    ['text that is not JSON', () => 'the run'],
    ['half of a save', () => encodeRun(laterRun(), SEED).slice(0, 200)],
    ['null', () => 'null'],
    ['a list', () => '[]'],
    ['no version', () => JSON.stringify({ ...saved(), version: undefined })],
    ['an old version', () => JSON.stringify({ ...saved(), version: 0 })],
    ['a newer version', () => JSON.stringify({ ...saved(), version: SAVE_VERSION + 1 })],
    ['a version in words', () => JSON.stringify({ ...saved(), version: '1' })],
    ['no run', () => JSON.stringify({ ...saved(), run: undefined })],
    ['a run that is a number', () => JSON.stringify({ ...saved(), run: 3 })],
    ['no seed', () => JSON.stringify({ ...saved(), daySeed: undefined })],
    ['a seed that is not whole', () => JSON.stringify({ ...saved(), daySeed: 1.5 })],
    ['a seed below zero', () => JSON.stringify({ ...saved(), daySeed: -1 })],
    ['a seed beyond 32 bits', () => JSON.stringify({ ...saved(), daySeed: 4294967296 })],
    ['a day before the first', () => JSON.stringify({ ...saved(), run: { ...saved().run, day: 0 } })],
    ['a day in words', () => JSON.stringify({ ...saved(), run: { ...saved().run, day: 'three' } })],
    ['an unknown morning', () => JSON.stringify({ ...saved(), run: { ...saved().run, kind: 'huge' } })],
    ['stock of an unknown item', () => JSON.stringify({ ...saved(), run: { ...saved().run, stock: { gold: 3 } } })],
    ['negative stock', () => JSON.stringify({ ...saved(), run: { ...saved().run, stock: { chips: -3 } } })],
    ['no trucks', () => JSON.stringify({ ...saved(), run: { ...saved().run, trucks: [] } })],
    ['a truck with no driver', () => JSON.stringify({ ...saved(), run: { ...saved().run, trucks: [{ id: 1, kind: 'van', capacity: 5 }] } })],
    ['no clients', () => JSON.stringify({ ...saved(), run: { ...saved().run, clients: [] } })],
    ['a client in an unknown place', () => JSON.stringify({ ...saved(), run: { ...saved().run, clients: [{ name: 'A', place: 'mars', contact: 'B' }] } })],
    ['an unknown mood', () => JSON.stringify({ ...saved(), run: { ...saved().run, moods: { "Rosa's": 'furious' } } })],
    ['a room with no space', () => JSON.stringify({ ...saved(), run: { ...saved().run, capacity: { freezer: 0, fridge: 5, dry: 5 } } })],
    ['a room missing', () => JSON.stringify({ ...saved(), run: { ...saved().run, capacity: { freezer: 5, fridge: 5 } } })],
    ['a promise of nothing', () => JSON.stringify({ ...saved(), run: { ...saved().run, promises: [{ client: 'A', item: 'chips', qty: 0 }] } })],
    ['more history than is kept', () => JSON.stringify({ ...saved(), run: { ...saved().run, history: { A: Array(3).fill({ percent: 1, late: false, lacked: [] }) } } })],
    ['no delivery', () => JSON.stringify({ ...saved(), run: { ...saved().run, delivery: undefined } })],
    ['far too many clients', () => JSON.stringify({ ...saved(), run: { ...saved().run, clients: Array(1000).fill(saved().run.clients[0]) } })],
  ])('does not read %s', (_, text) => {
    expect(decodeRun(text())).toBeNull();
  });
});

describe('saving the settings', () => {
  it.each([[true, false], [false, true], [true, true], [false, false]])('keeps blue %s and sound %s', (blue, soundOn) => {
    expect(decodeSettings(encodeSettings({ blue, soundOn }))).toEqual({ blue, soundOn });
  });

  it.each([
    ['empty text', ''],
    ['text that is not JSON', 'blue'],
    ['an old version', JSON.stringify({ version: 0, blue: true, soundOn: true })],
    ['a switch in words', JSON.stringify({ version: SAVE_VERSION, blue: 'yes', soundOn: true })],
    ['a missing switch', JSON.stringify({ version: SAVE_VERSION, blue: true })],
  ])('does not read %s', (_, text) => {
    expect(decodeSettings(text)).toBeNull();
  });
});

describe('the browser store', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps text in local storage and reads it back', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) });
    const store = browserStore();
    expect(store.read('a')).toBeNull();
    store.write('a', 'one');
    expect(store.read('a')).toBe('one');
  });

  it('reads nothing and writes nothing, without an error, when storage refuses (a full or blocked store)', () => {
    const refuse = () => {
      throw new DOMException('refused', 'QuotaExceededError');
    };
    vi.stubGlobal('localStorage', { getItem: refuse, setItem: refuse });
    const store = browserStore();
    expect(store.read('a')).toBeNull();
    expect(() => store.write('a', 'one')).not.toThrow();
  });

  it('copes when merely reaching local storage is refused (blocked site data)', () => {
    vi.stubGlobal('localStorage', undefined);
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
    const store = browserStore();
    expect(store.read('a')).toBeNull();
    expect(() => store.write('a', 'one')).not.toThrow();
  });

  it('copes when there is no local storage at all', () => {
    vi.stubGlobal('localStorage', undefined);
    const store = browserStore();
    expect(store.read('a')).toBeNull();
    expect(() => store.write('a', 'one')).not.toThrow();
  });
});

/** An app on a store, with the sound switches it was told to set. */
function appOn(store: Store, random: () => number = () => 0.9, morning: 'small' | 'big' = 'small') {
  const sound: boolean[] = [];
  const effects: Effects = { ...fakeEffects([], random, store), setSound: (on) => void sound.push(on) };
  const app = new App(effects, () => {}, morning);
  const press = (...keys: string[]) => keys.forEach((key) => app.press({ key }));
  return { app, press, sound };
}

const savedRun = (store: { data: Map<string, string> }) => decodeRun(store.data.get(RUN_KEY) ?? '');

describe('a run saved in the browser', () => {
  it('starts as ever, on the first day, when nothing is saved, and saves that day', () => {
    const store = memoryStore();
    const { app } = appOn(store);
    expect(app.screen).toBe('messages');
    expect(app.status).toBe('');
    expect(app.morning.day).toBe(1);
    expect(savedRun(store)).toEqual({ run: runFromMorning(smallMorning()), daySeed: 0 });
  });

  it('saves the run when the next morning begins', () => {
    const store = memoryStore();
    const { app } = toNextMorning('1', 'small', 0, RANDOM, store);
    expect(app.run.day).toBe(2);
    expect(savedRun(store)).toEqual({ run: app.run, daySeed: SEED });
  });

  it('keeps the growth choice that was confirmed in the run it saves', () => {
    const store = memoryStore();
    const { app } = toNextMorning('1', 'small', 0, RANDOM, store);
    expect(savedRun(store)?.run.trucks).toHaveLength(3);
    expect(app.morning.trucks).toHaveLength(3);
  });

  it('does not save a choice that is still open: the saved day is the one that began', () => {
    const store = memoryStore();
    const { app, press } = toDay(0, 'small', ['a'], [], RANDOM, store);
    press('Enter', '1', 'Enter');
    expect(app.growth).not.toBeNull();
    expect(savedRun(store)?.run.day).toBe(1);
  });

  it('offers to continue when it is opened again, with the day and the date', () => {
    const store = memoryStore();
    toNextMorning('1', 'small', 0, RANDOM, store);
    const { app } = appOn(store);
    expect(app.screen).toBe('start');
    const text = screen(app).join('\n');
    expect(text).toContain('Continue');
    expect(text).toContain('Day 2, WED 15 MAR');
    expect(text).toContain('New run: the small morning');
    expect(text).toContain('New run: the big morning');
  });

  it('continues at the start of the saved day with the same morning, whatever the new visit would have drawn', () => {
    const store = memoryStore();
    const first = toNextMorning('1', 'small', 0, RANDOM, store);
    const morning = structuredClone(first.app.morning);
    const run = structuredClone(first.app.run);
    const { app, press } = appOn(store, () => 0.01);
    press('Enter');
    expect(app.screen).toBe('messages');
    expect(app.msgSel).toBe(0);
    expect(app.morning).toEqual(morning);
    expect(app.run).toEqual(run);
    expect(app.desk.order(0).client).toBe(morning.orders[0]!.client);
    expect(screen(app).join('\n')).toContain('WED 15 MAR');
  });

  it('continues a later day as well, and plays it again the same way as R', () => {
    const store = memoryStore();
    const first = toNextMorning('1', 'small', 0, RANDOM, store);
    playToSupply(first.app, first.press);
    first.press('a', 'F9', 'Enter', '2', 'Enter', 'Enter');
    expect(first.app.run.day).toBe(3);
    const { app, press } = appOn(store, () => 0.01);
    press('c');
    expect(app.run.day).toBe(3);
    expect(app.morning).toEqual(first.app.morning);
    playToSupply(app, press);
    press('a', 'F9');
    press('r');
    expect(app.run.day).toBe(3);
    expect(app.morning).toEqual(first.app.morning);
  });

  it('does not rewrite the save when it carries on', () => {
    const store = memoryStore();
    toNextMorning('2', 'small', 0, RANDOM, store);
    const text = store.data.get(RUN_KEY);
    const { press } = appOn(store);
    press('Enter');
    expect(store.data.get(RUN_KEY)).toBe(text);
  });

  it('shows the opening screen in 120 columns by 30 rows, with the key bar', () => {
    const store = memoryStore();
    toNextMorning('3', 'big', 0, RANDOM, store);
    const { app, press } = appOn(store);
    expect(screen(app).at(-1)).toContain('ENTER go');
    press('ArrowDown');
    expect(screen(app).join('\n')).toContain('▶ 2  New run: the small morning');
    press('ArrowDown', 'ArrowDown', 'ArrowDown');
    expect(screen(app).join('\n')).toContain('▶ 3  New run: the big morning');
    press('ArrowUp', 'ArrowUp', 'ArrowUp');
    expect(screen(app).join('\n')).toContain('▶ 1  Continue');
  });

  it('only needs the keyboard: the arrows and ENTER pick a new run', () => {
    const store = memoryStore();
    toNextMorning('1', 'small', 0, RANDOM, store);
    const { app, press } = appOn(store);
    press('ArrowDown', 'ArrowDown');
    holdNewRun(app, 'Enter');
    expect(app.screen).toBe('messages');
    expect(app.morning.id).toBe('big');
    expect(app.morning.day).toBe(1);
  });

  it('keys that do nothing on the opening screen are not taken', () => {
    const store = memoryStore();
    toNextMorning('1', 'small', 0, RANDOM, store);
    const { app } = appOn(store);
    expect(app.press({ key: 'x' })).toBe(false);
    expect(app.press({ key: ' ' })).toBe(false);
    expect(app.screen).toBe('start');
  });
});

describe('B and S replace the save', () => {
  it.each([['b', 'big'], ['s', 'small']] as const)('%s on the opening screen starts the %s morning and saves it over the old run', (key, kind) => {
    const store = memoryStore();
    toNextMorning('1', kind === 'big' ? 'small' : 'big', 0, RANDOM, store, 99999);
    expect(savedRun(store)?.run.day).toBe(2);
    const { app } = appOn(store);
    holdNewRun(app, key.toUpperCase());
    expect(app.run.kind).toBe(kind);
    expect(app.morning.day).toBe(1);
    expect(savedRun(store)).toEqual({ run: runFromMorning(app.morning), daySeed: 0 });
  });

  it('B on the overnight messages of a later day starts the big morning and saves it', () => {
    const store = memoryStore();
    toNextMorning('1', 'small', 0, RANDOM, store);
    const { app, press } = appOn(store);
    press('Enter');
    holdNewRun(app, 'b');
    expect(app.run.day).toBe(1);
    expect(savedRun(store)?.run.kind).toBe('big');
    press(' ', 'F10', 'F10');
    press('Escape');
    expect(savedRun(store)?.run.day).toBe(1);
  });

  it('S from the end of the day starts the small morning and saves it', () => {
    const store = memoryStore();
    const { app, press } = toDay(0, 'big', ['a'], [], RANDOM, store);
    expect(app.screen).toBe('day');
    press('s');
    expect(app.run.kind).toBe('small');
    expect(savedRun(store)).toEqual({ run: runFromMorning(smallMorning()), daySeed: 0 });
  });

  it('R plays the day again and leaves the save as it was', () => {
    const store = memoryStore();
    const { app, press } = toDay(0, 'small', ['a'], [], RANDOM, store);
    const text = store.data.get(RUN_KEY);
    press('r');
    expect(app.screen).toBe('messages');
    expect(store.data.get(RUN_KEY)).toBe(text);
  });

  it('a new run chosen on the opening screen is what the next visit finds', () => {
    const store = memoryStore();
    toNextMorning('1', 'small', 0, RANDOM, store);
    holdNewRun(appOn(store).app, 's');
    const { app } = appOn(store);
    expect(app.screen).toBe('messages');
    expect(app.run.day).toBe(1);
  });
});

/** A later day on a store, with a clock the test moves and a log of the sounds made. */
function laterDay() {
  const store = memoryStore();
  toNextMorning('1', 'small', 0, RANDOM, store);
  const clock = { t: 0 };
  const cues: string[] = [];
  const effects: Effects = { ...fakeEffects(cues, () => 0.9, store), now: () => clock.t };
  const app = new App(effects);
  // Each key comes a second after the one before, as a player reading the screen would press it.
  const press = (...keys: string[]) =>
    keys.forEach((key) => {
      clock.t += 1000;
      app.press({ key });
    });
  press('Enter');
  const wait = (ms: number) => {
    clock.t += ms;
    app.tick();
  };
  const text = store.data.get(RUN_KEY);
  cues.length = 0;
  return { app, press, store, text, wait, cues };
}

/** How many cells of the hold-to-start bar are filled on the screen. */
function filled(app: App): number {
  return [...barOf(app).filter(([, cls]) => cls === 'bf').map(([text]) => text).join('')].length;
}

/** The segments of the bar on the line with the button: █ in the accent colour, ░ dimmed. */
function barOf(app: App) {
  const line = screenLines(app).find((l) => l.map(([text]) => text).join('').includes('HOLD'));
  return (line ?? []).filter(([text]) => /^[█░]+$/.test(text));
}

describe('B and S have to be held down from day 2 on', () => {
  it.each([['b', 'B', 'big'], ['s', 'S', 'small']] as const)(
    '%s on a later day shows the button and starts nothing until it has been held for the whole time',
    (key, name, kind) => {
      const { app, store, text, wait, cues } = laterDay();
      app.press({ key });
      expect(app.newRunAsk).toBe(kind);
      expect(app.holding).toBe(true);
      expect(cues).toEqual([]);
      const lines = screen(app).join('\n');
      expect(lines).toContain(`Start a new run? It replaces your saved day 2. [ HOLD ${name} TO START A NEW RUN ]`);
      expect(lines).toContain('ESC keeps playing');
      wait(HOLD_MS - 1);
      expect(app.run.day).toBe(2);
      expect(store.data.get(RUN_KEY)).toBe(text);
      wait(1);
      expect(app.run.day).toBe(1);
      expect(app.run.kind).toBe(kind);
      expect(app.screen).toBe('messages');
      expect(app.newRunAsk).toBeNull();
      expect(app.holding).toBe(false);
      expect(savedRun(store)).toEqual({ run: runFromMorning(app.morning), daySeed: 0 });
      expect(cues).toEqual(['confirm']);
      expect(screen(app).join('\n')).not.toContain('HOLD');
    },
  );

  it('fills the bar from left to right, in the accent colour, as the key stays down', () => {
    const { app, wait } = laterDay();
    app.press({ key: 'b' });
    expect(filled(app)).toBe(0);
    wait(HOLD_MS / 2);
    expect(filled(app)).toBe(8);
    wait(HOLD_MS / 4);
    expect(filled(app)).toBe(12);
    expect(barOf(app).map(([text]) => text[0])).toEqual(['█', '░']);
    expect(barOf(app).map(([, cls]) => cls)).toEqual(['bf', 'be']);
  });

  it('letting go early empties the bar, starts nothing and leaves the save alone', () => {
    const { app, store, text, wait } = laterDay();
    app.press({ key: 'b' });
    wait(HOLD_MS - 200);
    expect(filled(app)).toBeGreaterThan(10);
    app.release('b');
    expect(app.holding).toBe(false);
    expect(app.holdProgress).toBe(0);
    expect(filled(app)).toBe(0);
    wait(HOLD_MS * 3);
    expect(app.run.day).toBe(2);
    expect(store.data.get(RUN_KEY)).toBe(text);
    expect(screen(app).join('\n')).toContain('HOLD B TO START A NEW RUN');
  });

  it('after letting go early the key can be held again, and the fill starts over', () => {
    const { app, wait } = laterDay();
    app.press({ key: 'b' });
    wait(HOLD_MS - 100);
    app.release('b');
    app.press({ key: 'b' });
    wait(HOLD_MS - 100);
    expect(app.run.day).toBe(2);
    wait(100);
    expect(app.run.day).toBe(1);
  });

  it('keys other than the one asked for cancel the question and do what they always do', () => {
    const { app, press, store, text, wait } = laterDay();
    press('b', 'ArrowDown');
    expect(app.newRunAsk).toBeNull();
    expect(app.msgSel).toBe(1);
    wait(HOLD_MS * 2);
    expect(app.run.day).toBe(2);
    app.press({ key: 's' });
    press(' ');
    expect(app.newRunAsk).toBeNull();
    expect(app.screen).toBe('desk');
    wait(HOLD_MS * 2);
    expect(app.run.day).toBe(2);
    expect(store.data.get(RUN_KEY)).toBe(text);
  });

  it('ESC cancels the question and does nothing else', () => {
    const { app, press, store, text, wait } = laterDay();
    press('b', 'Escape');
    expect(app.newRunAsk).toBeNull();
    expect(app.screen).toBe('messages');
    expect(screen(app).join('\n')).not.toContain('HOLD');
    wait(HOLD_MS * 2);
    expect(app.run.day).toBe(2);
    expect(store.data.get(RUN_KEY)).toBe(text);
  });

  it('the other new-run key replaces the question with its own, and a hold of the first key no longer counts', () => {
    const { app, wait } = laterDay();
    app.press({ key: 'b' });
    wait(HOLD_MS / 2);
    app.press({ key: 's' });
    expect(app.newRunAsk).toBe('small');
    expect(filled(app)).toBe(0);
    wait(HOLD_MS - 1);
    expect(app.run.day).toBe(2);
    wait(1);
    expect(app.run.kind).toBe('small');
    expect(app.run.day).toBe(1);
  });

  it('the keyboard repeating the key neither starts the fill again nor cancels it', () => {
    const { app, wait } = laterDay();
    app.press({ key: 'b' });
    wait(HOLD_MS / 2);
    app.press({ key: 'b', repeat: true });
    app.press({ key: 'B', repeat: true });
    expect(app.holding).toBe(true);
    expect(filled(app)).toBe(8);
    wait(HOLD_MS / 2);
    expect(app.run.day).toBe(1);
  });

  it('a repeat of the key alone, with no press before it, starts no fill', () => {
    const { app, wait } = laterDay();
    app.press({ key: 'b' });
    app.release('b');
    app.press({ key: 'b', repeat: true });
    expect(app.holding).toBe(false);
    wait(HOLD_MS * 2);
    expect(app.run.day).toBe(2);
  });

  it('once it has started, the key still held down does not start another new run', () => {
    const { app, wait, cues } = laterDay();
    app.press({ key: 'b' });
    wait(HOLD_MS);
    expect(app.run.day).toBe(1);
    const heard = cues.length;
    app.press({ key: 'b', repeat: true });
    app.press({ key: 'b', repeat: true });
    expect(cues).toHaveLength(heard);
    app.release('b');
    app.press({ key: 's' });
    expect(app.run.kind).toBe('small');
    expect(cues).toHaveLength(heard + 1);
  });

  it('the page losing the keyboard lets go of the key', () => {
    const { app, wait } = laterDay();
    app.press({ key: 'b' });
    wait(HOLD_MS / 2);
    app.releaseAll();
    expect(app.holding).toBe(false);
    wait(HOLD_MS * 2);
    expect(app.run.day).toBe(2);
  });

  it('works on the result, the end of the day and the growth choice, in 120 columns, over the status line', () => {
    const { app, press, store, text, wait } = laterDay();
    playToSupply(app, press);
    press('Escape');
    expect(app.screen).toBe('result');
    for (const where of ['result', 'day', 'growth'] as const) {
      if (where === 'day') press('Enter', 'a', 'F9');
      if (where === 'growth') press('Enter');
      app.press({ key: 's' });
      wait(HOLD_MS / 2);
      expect(app.screen).toBe(where === 'growth' ? 'day' : where);
      expect(app.growthOpen).toBe(where === 'growth');
      expect(app.run.day).toBe(2);
      expect(store.data.get(RUN_KEY)).toBe(text);
      expect(screen(app).join('\n')).toContain('Start a new run? It replaces your saved day 2. [ HOLD S TO START A NEW RUN ]');
      expect(filled(app)).toBe(8);
      app.release('s');
      press('x');
    }
    app.press({ key: 's' });
    wait(HOLD_MS);
    expect(app.run.day).toBe(1);
    expect(app.screen).toBe('messages');
    expect(savedRun(store)).toEqual({ run: runFromMorning(smallMorning()), daySeed: 0 });
  });

  it('ESC on the growth choice only cancels the question, and the choice stays open', () => {
    const { app, press } = laterDay();
    playToSupply(app, press);
    press('a', 'F9', 'Enter', 's', 'Escape');
    expect(app.newRunAsk).toBeNull();
    expect(app.growthOpen).toBe(true);
  });

  it('on day 1 there is nothing to hold: one press starts the new run', () => {
    const store = memoryStore();
    const { app, press } = appOn(store);
    press('b');
    expect(app.newRunAsk).toBeNull();
    expect(app.run.kind).toBe('big');
    expect(savedRun(store)?.run.kind).toBe('big');
    const day = toDay(0, 'small', ['a'], [], RANDOM, memoryStore());
    day.press('b');
    expect(day.app.run.kind).toBe('big');
    expect(day.app.screen).toBe('messages');
  });
});

/** The opening screen over a saved later day, with a clock the test moves and a log of the sounds made. */
function welcome() {
  const store = memoryStore();
  toNextMorning('1', 'small', 0, RANDOM, store);
  const clock = { t: 0 };
  const cues: string[] = [];
  const effects: Effects = { ...fakeEffects(cues, () => 0.9, store), now: () => clock.t };
  const app = new App(effects);
  const wait = (ms: number) => {
    clock.t += ms;
    app.tick();
  };
  return { app, store, text: store.data.get(RUN_KEY), wait, cues };
}

describe('a new run on the opening screen has to be held down', () => {
  it.each([['s', 'S', 'small'], ['b', 'B', 'big']] as const)(
    '%s shows the button and starts the %s morning only once the whole hold is done',
    (key, name, kind) => {
      const { app, store, text, wait, cues } = welcome();
      app.press({ key });
      expect(app.screen).toBe('start');
      expect(app.holding).toBe(true);
      expect(screen(app).join('\n')).toContain(`It replaces your saved day 2. [ HOLD ${name} TO START A NEW RUN ]`);
      wait(HOLD_MS - 1);
      expect(app.screen).toBe('start');
      expect(store.data.get(RUN_KEY)).toBe(text);
      wait(1);
      expect(app.screen).toBe('messages');
      expect(app.run.kind).toBe(kind);
      expect(app.run.day).toBe(1);
      expect(cues).toEqual(['confirm']);
      expect(savedRun(store)).toEqual({ run: runFromMorning(app.morning), daySeed: 0 });
    },
  );

  it('ENTER on a new run is held the same way, and the button names ENTER', () => {
    const { app, wait } = welcome();
    app.press({ key: 'ArrowDown' });
    app.press({ key: 'Enter' });
    expect(screen(app).join('\n')).toContain('[ HOLD ENTER TO START A NEW RUN ]');
    wait(HOLD_MS);
    expect(app.run.kind).toBe('small');
    expect(app.screen).toBe('messages');
  });

  it('letting go early empties the bar and leaves the save alone', () => {
    const { app, store, text, wait, cues } = welcome();
    app.press({ key: 's' });
    wait(HOLD_MS - 1);
    app.release('s');
    wait(HOLD_MS * 2);
    expect(app.holding).toBe(false);
    expect(app.screen).toBe('start');
    expect(filled(app)).toBe(0);
    expect(store.data.get(RUN_KEY)).toBe(text);
    expect(cues).toEqual([]);
  });

  it('ESC or another key cancels the question', () => {
    const { app, store, text } = welcome();
    app.press({ key: 's' });
    app.press({ key: 'Escape' });
    expect(app.newRunAsk).toBeNull();
    expect(app.screen).toBe('start');
    app.press({ key: 'b' });
    app.press({ key: 'ArrowDown' });
    expect(app.newRunAsk).toBeNull();
    expect(app.startSel).toBe(1);
    expect(store.data.get(RUN_KEY)).toBe(text);
  });

  it('continue is a single press, by ENTER or by C', () => {
    for (const [keys, sel] of [[['Enter'], 0], [['c'], 1]] as const) {
      const { app } = welcome();
      app.startSel = sel;
      keys.forEach((key) => app.press({ key }));
      expect(app.screen).toBe('messages');
      expect(app.run.day).toBe(2);
      expect(app.holding).toBe(false);
    }
  });

  it('the screen stays 120 columns wide with the button on show', () => {
    const { app } = welcome();
    app.press({ key: 'b' });
    screen(app);
  });
});

describe('a saved first day opens without the opening screen', () => {
  it.each([['small'], ['big']] as const)('a saved %s first day opens at its overnight messages, keeping the settings', (kind) => {
    const store = memoryStore();
    const first = appOn(store, () => 0.9, kind);
    first.press('F2', 'F4');
    expect(first.app.run.day).toBe(1);
    const { app, sound } = appOn(store, () => 0.9, kind === 'big' ? 'small' : 'big');
    expect(app.screen).toBe('messages');
    expect(app.saved).toBeNull();
    expect(app.run.kind).toBe(kind);
    expect(app.blue).toBe(true);
    expect(app.soundOn).toBe(first.app.soundOn);
    expect(sound).toEqual([first.app.soundOn]);
    expect(screen(app).join('\n')).not.toContain('WELCOME BACK');
  });

  it('does not rewrite the save', () => {
    const store = memoryStore();
    appOn(store);
    const text = store.data.get(RUN_KEY);
    appOn(store);
    expect(store.data.get(RUN_KEY)).toBe(text);
  });
});

describe('the settings saved in the browser', () => {
  it('saves the colours when F2 is pressed, and the next visit has them', () => {
    const store = memoryStore();
    const { app, press } = appOn(store);
    press('F2');
    expect(app.blue).toBe(true);
    expect(decodeSettings(store.data.get(SETTINGS_KEY) ?? '')).toEqual({ blue: true, soundOn: true });
    expect(appOn(store).app.blue).toBe(true);
    press('F2');
    expect(appOn(store).app.blue).toBe(false);
  });

  it('saves the sound when F4 is pressed, and tells the sounds the next visit', () => {
    const store = memoryStore();
    const toggled = { on: true };
    const effects: Effects = { ...fakeEffects([], () => 0.9, store), toggleSound: () => (toggled.on = !toggled.on) };
    const app = new App(effects);
    app.press({ key: 'F4' });
    expect(app.soundOn).toBe(false);
    expect(decodeSettings(store.data.get(SETTINGS_KEY) ?? '')).toEqual({ blue: false, soundOn: false });
    const next = appOn(store);
    expect(next.app.soundOn).toBe(false);
    expect(next.sound).toEqual([false]);
  });

  it('are on the opening screen too, and are kept when a new run starts', () => {
    const store = memoryStore();
    toNextMorning('1', 'small', 0, RANDOM, store);
    const { app, press } = appOn(store);
    press('F2');
    expect(app.screen).toBe('start');
    holdNewRun(app, 's');
    expect(app.blue).toBe(true);
    expect(appOn(store).app.blue).toBe(true);
  });

  it('are kept apart from the run: a run that cannot be read leaves them alone', () => {
    const store = memoryStore();
    appOn(store).press('F2');
    store.data.set(RUN_KEY, 'broken');
    const { app } = appOn(store);
    expect(app.blue).toBe(true);
    expect(app.screen).toBe('messages');
  });

  it('start as they always did when what was saved cannot be read', () => {
    const store = memoryStore({ [SETTINGS_KEY]: '{"version":9}' });
    const { app, sound } = appOn(store);
    expect(app.blue).toBe(false);
    expect(app.soundOn).toBe(true);
    expect(app.status).toBe('');
    expect(sound).toEqual([]);
  });
});

describe('a save that cannot be used', () => {
  it.each([
    ['text that is not JSON', 'oops'],
    ['an old version', JSON.stringify({ ...saved(), version: 0 })],
    ['a run that is not what a run holds', JSON.stringify({ ...saved(), run: { day: 2 } })],
    ['another game', '{"version":1,"score":4}'],
  ])('is ignored for %s: a new run starts on the first day, with a short calm note', (_, text) => {
    const store = memoryStore({ [RUN_KEY]: text });
    const { app } = appOn(store);
    expect(app.screen).toBe('messages');
    expect(app.morning.day).toBe(1);
    expect(app.tone).toBe('info');
    expect(app.status).toBe('The saved run could not be used, so a new run has started.');
    expect(screen(app).join('\n')).toContain('could not be used');
    expect(savedRun(store)).toEqual({ run: runFromMorning(smallMorning()), daySeed: 0 });
  });

  it('does not show the note again once a key is pressed', () => {
    const { app, press } = appOn(memoryStore({ [RUN_KEY]: 'oops' }));
    press(' ');
    expect(app.status).toBe('');
  });
});

describe('when nothing can be saved', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('plays a whole day and on to the next morning without any error', () => {
    const refuse = () => {
      throw new DOMException('refused', 'QuotaExceededError');
    };
    vi.stubGlobal('localStorage', { getItem: refuse, setItem: refuse });
    const effects: Effects = { ...fakeEffects([], RANDOM), store: browserStore() };
    const app = new App(effects);
    expect(app.screen).toBe('messages');
    expect(app.status).toBe('');
    const press = (...keys: string[]) => keys.forEach((key) => app.press({ key }));
    playToSupply(app, press);
    press('a', 'F9', 'Enter', '1', 'Enter', 'Enter', 'F2', 'F4');
    expect(app.run.day).toBe(2);
    expect(app.blue).toBe(true);
    expect(app.screen).toBe('messages');
  });

  it('starts on the first day when local storage is blocked outright', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
    try {
      const app = new App({ ...fakeEffects(), store: browserStore() });
      expect(app.screen).toBe('messages');
      expect(app.status).toBe('');
      app.press({ key: 'F2' });
      app.press({ key: 's' });
      expect(app.run.day).toBe(1);
    } finally {
      Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });
});
