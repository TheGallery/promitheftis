import { describe, expect, it } from 'vitest';
import { generateDay } from '../src/game/generate';
import { tightestRoom } from '../src/game/growth';
import { bigMorning, smallMorning } from '../src/game/morning';
import { mulberry32 } from '../src/game/random';
import { ROOM_GROWTH, SMALL_ROOM_CAPACITY, spaceOf } from '../src/game/rooms';
import { nextDay, runFromMorning, type DayOutcome } from '../src/game/run';
import { decodeRun, encodeRun } from '../src/game/save';
import { App } from '../src/ui/app';
import { fakeEffects, hold, playToSupply, screen } from './helpers';

const outcome = (over: Partial<DayOutcome> = {}): DayOutcome => ({ left: {}, ordered: {}, moods: {}, today: {}, promises: [], growth: null, earned: 0, ...over });
const small = () => runFromMorning(smallMorning());

describe('a room that is full overnight', () => {
  it('keeps what fits and loses the rest of the delivery, which is paid for all the same', () => {
    // The small freezer holds 120 space: 40 units of chips or peas.
    const next = nextDay(small(), outcome({ left: { chips: 10 }, ordered: { chips: 50, peas: 10 } }));
    expect(next.stock.chips).toBe(40);
    expect(next.stock.peas).toBe(0);
    expect(next.spoiled).toEqual([{ item: 'chips', units: 20 }, { item: 'peas', units: 10 }]);
    expect(next.delivery).toEqual({ items: 2, units: 60 });
  });

  it('spoils nothing when everything fits, and the other rooms are left alone', () => {
    const next = nextDay(small(), outcome({ left: { pork: 20 }, ordered: { chips: 10, pork: 20 } }));
    expect(next.spoiled).toEqual([]);
    expect(next.stock.chips).toBe(10);
    expect(next.stock.pork).toBe(40);
  });

  it('uses the room as it was when the delivery came: a bigger room bought tonight helps from the day after', () => {
    const grown = nextDay(small(), outcome({ ordered: { chips: 50 }, growth: { kind: 'room', room: 'freezer' } }));
    expect(grown.stock.chips).toBe(40);
    expect(grown.capacity.freezer).toBe(SMALL_ROOM_CAPACITY.freezer + ROOM_GROWTH.freezer);
    const again = nextDay(grown, outcome({ ordered: { chips: 50 } }));
    expect(again.stock.chips).toBe(50);
    expect(again.spoiled).toEqual([]);
  });

  it('is known on the supplier order and the end of the day before it happens, in the same numbers', () => {
    const app = new App(fakeEffects([], () => 0.3), () => {}, 'small');
    const press = (...keys: string[]) => keys.forEach((key) => app.press({ key }));
    playToSupply(app, press);
    const chips = app.supply!.rows.findIndex((r) => r.item.id === 'chips');
    press(...Array(chips).fill('ArrowDown'), '9', '9');
    const spoils = app.supply!.roomSpace('freezer').spoils;
    expect(spoils).toBeGreaterThan(0);
    const text = screen(app).join('\n');
    expect(text).toContain(`${spoils} will spoil`);
    expect(text).toContain('of these will spoil: the freezer is full');
    hold(app, ' ');
    expect(app.screen).toBe('day');
    expect(app.day!.rooms.find((r) => r.kept === 'freezer')!.space.spoils).toBe(spoils);
    expect(screen(app).join('\n')).toContain(`${spoils} will spoil`);
    press(' ', '3', 'Enter');
    hold(app, ' ');
    const lost = app.run.spoiled.reduce((sum, s) => sum + s.units, 0);
    expect(lost).toBe(spoils);
  });
});

describe('the overnight messages about it', () => {
  const messages = (run: ReturnType<typeof small>) =>
    generateDay({ ...run, day: 2 }, mulberry32(4)).messages.flatMap((m) => (m.kind === 'order' ? [] : [m]));

  it('say what spoiled and why, from the store room', () => {
    const run = { ...small(), spoiled: [{ item: 'chips', units: 8 }] };
    const note = messages(run).find((m) => m.text.includes('spoiled'))!;
    expect(note.text).toBe('8 frozen chips spoiled: the freezer was full.');
    expect(note.kind).toBe('staff');
    expect(note.from).toBe('Max');
  });

  it('give each room its own note, and name every item that spoiled in it', () => {
    const run = { ...small(), spoiled: [{ item: 'chips', units: 8 }, { item: 'peas', units: 3 }, { item: 'potatoes', units: 1 }] };
    const texts = messages(run).map((m) => m.text).filter((t) => t.includes('spoiled'));
    expect(texts).toEqual(['8 frozen chips and 3 frozen peas spoiled: the freezer was full.', '1 potatoes spoiled: the dry store was full.']);
  });

  it('say nothing when nothing spoiled, and arrive in time order among the rest', () => {
    expect(messages({ ...small(), spoiled: [] }).some((m) => m.text.includes('spoiled'))).toBe(false);
    const all = generateDay({ ...small(), day: 2, spoiled: Array.from({ length: 3 }, (_, i) => ({ item: ['chips', 'pork', 'rice'][i]!, units: 2 })) }, mulberry32(9));
    const times = all.messages.map((m) => m.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(all.messages.filter((m) => m.kind === 'staff' && m.text.includes('spoiled'))).toHaveLength(3);
  });
});

describe('the room offered at the end of the day', () => {
  it('is the one where most will spoil, then the fullest', () => {
    const room = (kept: 'freezer' | 'fridge' | 'dry', pct: number, spoils: number) => ({
      kept,
      space: { capacity: 100, inStore: 0, ordered: 0, free: 0, overBy: 0, pct, overPct: 0, spoils },
    });
    expect(tightestRoom([room('freezer', 90, 0), room('fridge', 80, 0), room('dry', 99, 0)]).kept).toBe('dry');
    expect(tightestRoom([room('freezer', 120, 5), room('fridge', 80, 0), room('dry', 99, 9)]).kept).toBe('dry');
    expect(tightestRoom([room('freezer', 120, 9), room('fridge', 130, 9), room('dry', 99, 0)]).kept).toBe('fridge');
  });
});

describe('a saved run with rooms that spoil', () => {
  it('keeps what spoiled and what the notes announced', () => {
    const run = nextDay(small(), outcome({ ordered: { chips: 50 }, ahead: [{ client: "Rosa's", event: 'halfterm' }] }));
    expect(run.spoiled.length).toBeGreaterThan(0);
    expect(decodeRun(encodeRun(run, 5))).toEqual({ run, daySeed: 5 });
  });

  it.each([
    ['an item that is not sold', { spoiled: [{ item: 'moonrock', units: 3 }] }],
    ['spoiled units in words', { spoiled: [{ item: 'chips', units: '3' }] }],
    ['no spoiled units', { spoiled: [{ item: 'chips', units: 0 }] }],
    ['spoiled that is not a list', { spoiled: 4 }],
    ['an event that is not known', { ahead: [{ client: 'A', event: 'eclipse' }] }],
    ['a client in numbers', { ahead: [{ client: 4, event: 'quiz' }] }],
    ['no list of events', { ahead: undefined }],
  ])('does not read a save with %s', (_, wrong) => {
    const data = JSON.parse(encodeRun(small(), 1));
    expect(decodeRun(JSON.stringify({ ...data, run: { ...data.run, ...wrong } }))).toBeNull();
  });
});

describe('the first morning', () => {
  it('has rooms that fill to about two thirds for the small morning and about three quarters for the big', () => {
    for (const [load, low, high] of [[smallMorning, 55, 70], [bigMorning, 62, 85]] as const) {
      const m = load();
      for (const kept of ['freezer', 'fridge', 'dry'] as const) {
        const used = m.items.filter((i) => i.kept === kept).reduce((sum, i) => sum + (m.usual[i.id] ?? 0) * spaceOf(i.id), 0);
        const pct = (used * 100) / m.capacity[kept];
        expect(pct).toBeGreaterThanOrEqual(low);
        expect(pct).toBeLessThanOrEqual(high);
      }
    }
  });
});
