import { describe, expect, it } from 'vitest';
import { beforeTime, buildCalls } from '../src/game/calls';
import { DEPART_MINUTE, LAST_DAY, dateLabel, formatTime } from '../src/game/clock';
import { Desk } from '../src/game/desk';
import { bigMorning } from '../src/game/morning';
import { buildResult } from '../src/game/results';
import { buildRoad } from '../src/game/road';
import { decodeRun, encodeRun, SAVE_VERSION } from '../src/game/save';
import { runFromMorning } from '../src/game/run';
import { smallMorning } from '../src/game/morning';
import { placesLabel } from '../src/ui/format';
import { pad } from '../src/ui/grid';
import { gameKey } from '../src/ui/keys';
import { App } from '../src/ui/app';
import { fakeEffects, hold, playToSupply, screen, toDay, toNextMorning } from './helpers';

const text = (app: App) => screen(app).join('\n');
const lastLine = (app: App) => screen(app).at(-1)!;

describe('the places of a truck', () => {
  it('names a single place and clips a name that is too long', () => {
    expect(placesLabel(['saltmarket'], 20)).toBe('Saltmarket');
    expect(placesLabel(['saltmarket'], 6)).toBe('Saltm…');
  });

  it('uses the three-letter codes for two places or more, the same for the same truck wherever it is shown', () => {
    expect(placesLabel(['saltmarket', 'docks'], 40)).toBe('SLT DCK');
    expect(placesLabel(['saltmarket', 'docks'], 7)).toBe('SLT DCK');
  });

  it('keeps whole codes and counts the rest when the list is too long', () => {
    const all = ['oakley', 'hollin', 'docks', 'ashby', 'millford'] as const;
    expect(placesLabel(all, 19)).toBe('OAK HOL DCK ASH MIL');
    expect(placesLabel(all, 15)).toBe('OAK HOL DCK +2');
    for (let w = 6; w <= 19; w++) expect(placesLabel(all, w).length).toBeLessThanOrEqual(w);
    expect(placesLabel(all, 15)).not.toContain('…');
  });
});

describe('keys on a keyboard whose letters are not Latin', () => {
  it('takes the letter of the physical key when the key itself is not an ASCII letter', () => {
    expect(gameKey({ key: 'η', code: 'KeyH' })).toBe('h');
    expect(gameKey({ key: 'Η', code: 'KeyH', shiftKey: true })).toBe('H');
    expect(gameKey({ key: 'ρ', code: 'KeyR' })).toBe('r');
    expect(gameKey({ key: 'в', code: 'KeyD' })).toBe('d');
  });

  it('leaves every other key as it is', () => {
    expect(gameKey({ key: 'h', code: 'KeyH' })).toBe('h');
    expect(gameKey({ key: 'H', code: 'KeyH', shiftKey: true })).toBe('H');
    expect(gameKey({ key: ' ', code: 'Space' })).toBe(' ');
    expect(gameKey({ key: 'Enter', code: 'Enter' })).toBe('Enter');
    expect(gameKey({ key: '3', code: 'Digit3' })).toBe('3');
    expect(gameKey({ key: 'F2', code: 'F2' })).toBe('F2');
    // A Latin layout with the letters elsewhere (Dvorak): the key is what the player means.
    expect(gameKey({ key: 'j', code: 'KeyC' })).toBe('j');
  });
});

describe('the last day a date can show', () => {
  it('has a date for every day up to the last one', () => {
    for (const day of [1, 2, 1000, LAST_DAY]) expect(dateLabel(day)).toMatch(/^[A-Z]{3} \d{1,2} [A-Z]{3}$/);
  });

  it('is refused in a save when the day is past it, and accepted when it is the last', () => {
    const run = runFromMorning(smallMorning());
    expect(decodeRun(encodeRun({ ...run, day: LAST_DAY }, 1))?.run.day).toBe(LAST_DAY);
    expect(decodeRun(encodeRun({ ...run, day: LAST_DAY + 1 }, 1))).toBeNull();
    expect(decodeRun(encodeRun({ ...run, day: 1e9 }, 1))).toBeNull();
    expect(SAVE_VERSION).toBeGreaterThan(0);
  });
});

describe('calls about the time', () => {
  function bigDay(order: number[]) {
    const d = new Desk(bigMorning());
    d.morning.orders.forEach((o, i) => {
      o.lines.forEach((_, l) => d.acceptLine(i, l));
      for (let k = 0; k < d.morning.trucks.length && !d.isFinished(i); k++) {
        d.assignTruck(i, d.morning.trucks[(i + k + (order[i % order.length] ?? 0)) % d.morning.trucks.length]!.id);
        d.finishOrder(i);
      }
    });
    const result = buildResult(d, DEPART_MINUTE);
    const road = buildRoad(d, result);
    return { result, calls: buildCalls(d, result, road) };
  }

  it('never ring after the time the client asked for, and are never answered with a later time', () => {
    let seen = 0;
    for (let shift = 0; shift < 9; shift++) {
      const { result, calls } = bigDay([shift, shift + 3, shift + 5]);
      for (const c of calls.filter((x) => x.kind === 'time')) {
        const o = result.orders[c.orderIndex]!;
        if (o.before == null) continue;
        seen++;
        expect(c.at).toBeLessThan(o.before);
        expect(o.arriveAt!).toBeLessThan(o.before);
        for (const option of c.options) {
          const [h, m] = option.record.match(/(\d\d):(\d\d)/)!.slice(1).map(Number) as [number, number];
          expect(h * 60 + m).toBeLessThanOrEqual(o.before);
          expect(h * 60 + m).toBeGreaterThanOrEqual(o.arriveAt!);
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('still promise the next quarter-hour when the client asked for nothing', () => {
    const { result, calls } = bigDay([0]);
    const call = calls.find((c) => c.kind === 'time' && result.orders[c.orderIndex]!.before == null);
    if (!call) return;
    const arrive = result.orders[call.orderIndex]!.arriveAt!;
    expect(call.options[1]!.record).toBe(`told before ${formatTime(beforeTime(arrive))}`);
  });

  it('say there was no item in a delivery in plain words', () => {
    const { calls } = bigDay([0, 4]);
    for (const c of calls) expect(c.say).not.toContain('was no ');
  });
});

describe('the new client offered at the end of the day', () => {
  it('fits the screen, in whole, once chosen and once the choice moves on, whoever it is', () => {
    const kinds = new Set<string>();
    const seen = new Set<string>();
    for (let i = 0; i < 120; i++) {
      const { app, press } = toDay(0, i % 2 === 0 ? 'small' : 'big', ['a'], [], () => (i + 0.5) / 120);
      const client = (app.growthOptions[2]!.growth as { client: { name: string; shape: { size: number; before?: number; heavy?: string } } }).client;
      seen.add(client.name);
      kinds.add(`${client.shape.size}/${client.shape.before ?? ''}/${client.shape.heavy ?? ''}`);
      press(' ');
      expect(text(app)).toContain(`A new client: ${client.name}`);
      expect(text(app)).toContain('Rooms tomorrow');
      press('3', 'Enter');
      expect(app.growth).not.toBeNull();
      expect(text(app)).toContain('chosen');
      expect(text(app)).toContain('Rooms tomorrow');
      press('ArrowUp');
      expect(text(app)).toContain('Chosen');
      expect(lastLine(app)).toContain('hold: next morning');
    }
    expect(seen.size).toBeGreaterThan(60);
    expect(kinds.size).toBeGreaterThanOrEqual(5);
  });
});

describe('playing the day again', () => {
  /** The first day played to the end of the day, with the next morning drawn from a source that counts its draws. */
  function nextDay(replay: boolean) {
    let n = 0;
    const { app, press } = toDay(0, 'small', ['a'], [], () => ((n++ * 37) % 101) / 101);
    const offered = () => JSON.stringify(app.growthOptions[2]!.growth);
    const before = offered();
    if (replay) {
      hold(app, 'r');
      playToSupply(app, press);
      press('a');
      hold(app, ' ');
    }
    expect(offered()).toBe(before);
    press(' ', '3', 'Enter');
    hold(app, ' ');
    expect(app.run.day).toBe(2);
    return { orders: JSON.stringify(app.morning.orders), client: before, stock: JSON.stringify(app.morning.stock) };
  }

  it('offers the same new client and brings the same next morning as the first time', () => {
    const first = nextDay(false);
    const again = nextDay(true);
    expect(again).toEqual(first);
  });

  it('draws a new one only for a new run', () => {
    let n = 0;
    const effects = fakeEffects([], () => (n++ % 7) / 7);
    const app = new App(effects, () => {}, 'small');
    const drawn = n;
    app.restartDay();
    expect(n).toBe(drawn);
  });
});

describe('holds that take the day away', () => {
  it.each([1, 2] as const)('R, B and S on the result screen of day %i need the key held', (day) => {
    const app = day === 1 ? new App(fakeEffects(), () => {}, 'small') : toNextMorning('1').app;
    const press = (...keys: string[]) => keys.forEach((key) => app.press({ key }));
    if (day === 1) press(' ');
    playToSupply(app, press);
    press('Escape');
    expect(app.screen).toBe('result');
    for (const [key, title] of [['r', 'PLAY THE DAY AGAIN'], ['b', 'START A NEW RUN'], ['s', 'START A NEW RUN']] as const) {
      press(key);
      expect(app.screen).toBe('result');
      expect(text(app)).toContain(`HOLD ${key.toUpperCase()} TO ${title}`);
      expect(lastLine(app)).toContain('hold');
      press('Escape');
      expect(text(app)).not.toContain('HOLD');
    }
    expect(app.run.day).toBe(day);
    hold(app, 'r');
    expect(app.screen).toBe('messages');
    expect(app.run.day).toBe(day);
  });

  it.each([1, 2] as const)('R, B and S on the end of the day and the growth choice of day %i need the key held', (day) => {
    const { app, press } = day === 1 ? toDay() : toNextMorning('1');
    if (day === 2) {
      playToSupply(app, press);
      press('a');
      hold(app, ' ');
    }
    expect(app.screen).toBe('day');
    for (const open of [false, true]) {
      if (open) press(' ');
      for (const key of ['r', 'b', 's']) {
        press(key);
        expect(app.screen).toBe('day');
        expect(text(app)).toContain(`HOLD ${key.toUpperCase()} TO `);
        expect(lastLine(app)).toContain('hold');
        press('Escape');
        expect(text(app)).not.toContain('HOLD ');
      }
    }
    hold(app, 'r');
    expect(app.screen).toBe('messages');
  });

  it('B and S on the overnight messages of day 1 are still one press', () => {
    const app = new App(fakeEffects(), () => {}, 'small');
    expect(app.screen).toBe('messages');
    expect(lastLine(app)).toContain('B');
    app.press({ key: 'b' });
    expect(app.run.kind).toBe('big');
    expect(app.screen).toBe('messages');
    expect(text(app)).not.toContain('HOLD');
    app.press({ key: 's' });
    expect(app.run.kind).toBe('small');
  });

  it('on the overnight messages of a later day they are held', () => {
    const { app, press } = toNextMorning('1');
    expect(app.screen).toBe('messages');
    expect(lastLine(app)).toContain('hold: big / small');
    press('b');
    expect(app.run.day).toBe(2);
    expect(text(app)).toContain('HOLD B TO START A NEW RUN');
  });
});

/** A game on the small morning with every order handed out and the trucks not sent: on the truck sheets. */
function smallToSheets(effects = fakeEffects(), mutate: (app: App) => void = () => {}) {
  const app = new App(effects, () => {}, 'small');
  const press = (...keys: string[]) => keys.forEach((key) => app.press({ key }));
  press(' ');
  mutate(app);
  const trucks: Record<string, number> = {
    'Café Lumen': 1, "Rosa's": 2, 'The Anchor': 2, 'Golden Dragon': 1, 'Hotel Bellevue': 1, 'Burger Shack': 1, 'The Plough': 2,
  };
  for (let n = 0; n < 7; n++) {
    const name = app.desk.order(app.orderSel).client;
    const lines = app.desk.order(app.orderSel).lines.length;
    for (let l = 0; l < lines; l++) press('Enter');
    press(...Array(9).fill('ArrowUp'), ...Array((trucks[name] ?? trucks[Object.keys(trucks)[n]!]!) - 1).fill('ArrowDown'), 'Enter');
  }
  press(' ');
  return { app, press };
}

describe('the truck sheets', () => {
  it('keep the client, the place and the items apart when a client has a long name', () => {
    const { app, press } = smallToSheets(fakeEffects(), (a) => {
      a.morning.orders.forEach((o, i) => (o.client = `The Extraordinarily Long Named Restaurant ${i}`));
    });
    expect(app.screen).toBe('sheets');
    press('+');
    const rows = screen(app).filter((l) => l.includes('The Extraordinaril'));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row).toMatch(/The Extraordinaril…\s+\S/);
  });

  it('stop a print that is still going when ESC leaves them, so nothing is announced on the desk afterwards', () => {
    const queue: Array<() => void> = [];
    const effects = { ...fakeEffects(), later: (fn: () => void) => void queue.push(fn) };
    const { app, press } = smallToSheets(effects);
    press('p');
    expect(app.printing).not.toBeNull();
    press('Escape');
    expect(app.screen).toBe('desk');
    expect(app.printing).toBeNull();
    for (const fn of queue) fn();
    expect(app.status).not.toContain('Truck sheets printed.');
    expect(app.printed).toBe(false);
  });
});

describe('the road', () => {
  it('shows what was answered on a call, with the record, however long the client and the topic are', () => {
    const { app, press } = smallToSheets();
    hold(app, ' ');
    expect(app.screen).toBe('road');
    for (let n = 0; n < 20 && !app.roadCall; n++) press(' ');
    expect(app.roadCall).not.toBeNull();
    const call = app.roadCall!;
    call.client = 'The Windmill Tea Garden and Corner Shop';
    call.topic = 'asked for something with a very long name indeed';
    press('Enter');
    const record = call.options[0]!.record;
    const row = screen(app).find((l) => l.includes('Call ·'))!;
    expect(row).toContain(record);
    expect(row).toContain('The Windmill');
  });
});

describe('the money on the end of the day', () => {
  it('is the cash of the header once a growth choice has been paid for', () => {
    const { app, press } = toDay();
    const header = () => /CASH (-?£[\d,]+)/.exec(screen(app)[0]!)![1]!.replace('-£', '£-');
    const now = () => /Cash now +(-?£[\d,]+)/.exec(text(app))![1]!.replace('-£', '£-');
    expect(now()).toBe(header());
    press(' ', '1', 'Enter', 'Escape');
    expect(app.screen).toBe('day');
    expect(app.growth).not.toBeNull();
    expect(now()).toBe(header());
    press(' ', 'u');
    press('Escape');
    expect(now()).toBe(header());
  });
});

describe('a highlighted row', () => {
  it('stays highlighted to the end of its column when its last piece has more than one style', () => {
    const line = pad([['▶ Frozen chips', 'acc hl']], 20);
    expect(line.map(([t]) => t).join('')).toHaveLength(20);
    expect(line.at(-1)).toEqual([' '.repeat(6), 'hl']);
    expect(pad([['▶ Frozen chips', 'hl']], 20).at(-1)).toEqual([' '.repeat(6), 'hl']);
    expect(pad([['Frozen chips', 'acc']], 20).at(-1)).toEqual([' '.repeat(8), '']);
  });
});

describe('BACKSPACE on a line that is not decided', () => {
  it('does nothing when nothing has been typed, and still takes digits off when some have', () => {
    const app = new App(fakeEffects(), () => {}, 'small');
    const press = (...keys: string[]) => keys.forEach((key) => app.press({ key }));
    press(' ');
    const o = app.orderSel;
    const l = app.lineSel;
    expect(app.desk.given(o, l)).toBeNull();
    press('Backspace');
    expect(app.desk.given(o, l)).toBeNull();
    press('Enter');
    expect(app.desk.given(o, l)).not.toBeNull();
    press('ArrowUp');
    press('4');
    expect(app.desk.given(app.orderSel, app.lineSel)).toBe(4);
    press('Backspace');
    expect(app.desk.given(app.orderSel, app.lineSel)).toBe(0);
  });
});

describe('the hold box and the how-to-play screen', () => {
  it('stays when H opens the help and H closes it, and the key held down for it still counts', () => {
    const { app, press } = toDay();
    press('r');
    expect(app.ask?.action).toBe('again');
    press('h');
    expect(app.helpOpen).toBe(true);
    press('h');
    expect(app.helpOpen).toBe(false);
    expect(app.ask?.action).toBe('again');
    expect(text(app)).toContain('HOLD R TO PLAY THE DAY AGAIN');
    hold(app, 'r');
    expect(app.screen).toBe('messages');
  });
});

describe('the supplier order with the hold box over it', () => {
  it.each(['small', 'big'] as const)('keeps the cash now and the cash after in view in the %s morning', (kind) => {
    const app = kind === 'small' ? toNextMorning('1').app : new App(fakeEffects(), () => {}, 'big');
    const press = (...keys: string[]) => keys.forEach((key) => app.press({ key }));
    if (kind === 'big') press(' ');
    playToSupply(app, press);
    press('a');
    const shown = (cash: number) => {
      app.run.cash = cash;
      press(' ');
      const t = text(app);
      expect(t).toContain('HOLD SPACE TO PLACE THE ORDER');
      expect(t).toContain('ESC to cancel');
      expect(t).toMatch(/Cash now +-?£[\d,]+/);
      expect(t).toMatch(/Cash after +-?£[\d,]+/);
      press('Escape');
    };
    shown(app.cash);
    shown(0);
  });
});

describe('the end of the day with many trucks and calls', () => {
  it('shows what every call was answered, in 120 columns', () => {
    const { app } = toDay(0, 'big');
    expect(app.screen).toBe('day');
    const day = app.day!;
    expect(day.calls.length).toBeGreaterThan(0);
    const t = text(app);
    for (const call of day.calls) expect(t).toContain(call.record);
  });

  it('keeps the late column in two digits for a truck with ten late clients', () => {
    const { app } = toDay(0, 'big');
    const truck = app.day!.trucks[0]!;
    truck.lateTo = Array.from({ length: 12 }, (_, i) => `Client ${i}`);
    expect(text(app)).toContain('12 late');
    for (const l of screen(app)) expect([...l]).toHaveLength(120);
  });
});

describe('the cursor in a list', () => {
  it('has a space after it on every list that has one', () => {
    const { app, press } = toDay();
    expect(screen(app).find((l) => l.startsWith('▶'))).toMatch(/^▶ \S/);
    press(' ', 'Escape');
    expect(app.screen).toBe('day');
    const start = smallToSheets();
    start.press(' ');
    const t = screen(start.app);
    expect(t.some((l) => /^▶\S/.test(l))).toBe(false);
  });

  it('has a space after it on the result, the supplier order and the lines of the desk', () => {
    const { app, press } = smallToSheets();
    hold(app, ' ');
    for (let n = 0; n < 60 && !app.roadOver; n++) press(app.roadCall ? 'Enter' : ' ');
    press(' ');
    expect(app.screen).toBe('result');
    expect(text(app)).toMatch(/▶ \S/);
    expect(text(app)).not.toMatch(/▶\S/);
    press(' ');
    expect(app.screen).toBe('supply');
    expect(screen(app).some((l) => /^▶ \S/.test(l))).toBe(true);
    expect(screen(app).some((l) => /^▶\S/.test(l))).toBe(false);
  });
});
