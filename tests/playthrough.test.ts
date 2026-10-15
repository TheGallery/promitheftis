import { describe, expect, it } from 'vitest';
import { App, type Effects } from '../src/ui/app';
import { COLS, plain, ROWS } from '../src/ui/grid';
import { screenLines } from '../src/ui/view';
import { memoryStore } from '../src/ui/store';
import { mulberry32 } from '../src/game/random';

function make(seed: number, morning: 'small' | 'big') {
  const rnd = mulberry32(seed);
  const clock = { t: 100000 };
  const store = memoryStore();
  const effects: Effects = {
    cue: () => {}, print: () => 100, later: () => {}, // road ticks are skipped by SPACE
    toggleSound: () => true, setSound: () => {}, store, now: () => clock.t, random: rnd,
  };
  return { app: new App(effects, () => {}, morning), rnd, clock, effects, store };
}

/** A player bot plays eight days through the keys alone, with every screen in 120 columns and the money adding up. */
describe('a bot plays many days', () => {
  it.each([[1, 'small'], [2, 'big'], [3, 'small'], [4, 'big']] as const)('seed %i %s', (seed, morning) => {
    const { app, rnd, clock, effects, store } = make(seed * 104729, morning);
    const P = (key: string) => {
      clock.t += 450 + Math.floor(rnd() * 400);
      app.press({ key });
      const lines = plain(screenLines(app)); // throws if any line is wider than its column
      expect(lines).toHaveLength(ROWS);
      for (const l of lines) expect([...l]).toHaveLength(COLS);
    };
    const HOLD = (key: string) => {
      clock.t += 500; app.press({ key });
      for (let i = 0; i < 6 && app.holding; i++) { clock.t += 400; app.press({ key, repeat: true }); app.tick(); }
      app.release(key);
    };
    let stuck = 0;
    for (let guard = 0; app.run.day <= 8 && guard < 5000; guard++) {
      switch (app.screen) {
        case 'messages': P(' '); break;
        case 'desk': {
          // An order no truck can take is left, and the trucks go without it.
          if (app.desk.unfinishedCount() === 0 || stuck > 40) { stuck = 0; P(' '); break; }
          if (app.pane === 'trucks') {
            if (/too full|garage/.test(app.status)) {
              stuck++;
              if (app.truckSel === app.morning.trucks.length - 1) for (let i = 0; i < app.truckSel; i++) P('ArrowUp');
              else P('ArrowDown');
            } else stuck = 0;
            P('Enter'); break;
          }
          P('Enter'); break;
        }
        case 'sheets': HOLD(' '); break;
        case 'road': if (app.roadCall) P('Enter'); else P(' '); break;
        case 'result': P(' '); break;
        case 'supply': P('a'); HOLD(' '); break;
        case 'day':
          if (!app.growthOpen) { P(' '); break; }
          if (!app.growth) { P('3'); P('Enter'); P('ArrowDown'); break; } // a new client, then the arrow takes the status line off
          HOLD(' ');
          break;
        default: P(' ');
      }
      if (app.day && app.supply) {
        const m = app.day.money;
        expect(m.cash).toBe(m.before + m.takenIn - m.supplier - m.trucks);
        expect(app.morningMoney().takenIn).toBe(m.takenIn);
        expect(app.supply.totalCost()).toBe(m.supplier);
        expect(app.cash).toBe(m.cash - app.growthPaid);
      }
      if (app.screen === 'messages' && app.run.day > 1 && app.msgSel === 0) {
        const again = new App({ ...effects, store }, () => {}, 'small');
        again.press({ key: ' ' }); // WELCOME BACK -> continue
        expect(again.run.cash).toBe(app.run.cash);
        expect(JSON.stringify(again.morning)).toBe(JSON.stringify(app.morning));
      }
    }
    expect(app.run.day).toBeGreaterThan(8);
  });
});
