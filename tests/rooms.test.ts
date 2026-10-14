import { describe, expect, it } from 'vitest';
import { bigMorning, smallMorning } from '../src/game/morning';
import { ROOM_CAPACITY, roomSpace, SPACE_PER_UNIT, spaceOf } from '../src/game/rooms';
import { KEPT_ORDER, Supply } from '../src/game/supply';
import { plain } from '../src/ui/grid';
import { barCells, roomBar } from '../src/ui/screens/supply';

describe('the room data', () => {
  it('has a capacity for every room and a space for every item', () => {
    for (const kept of KEPT_ORDER) expect(ROOM_CAPACITY[kept]).toBeGreaterThan(0);
    for (const item of bigMorning().items) expect(SPACE_PER_UNIT[item.id]).toBeGreaterThan(0);
    expect(spaceOf('chips')).toBe(SPACE_PER_UNIT.chips);
  });
});

describe('room space', () => {
  it('splits a room into stock, ordered and what is free', () => {
    const space = roomSpace(200, 50, 30);
    expect(space).toMatchObject({ inStore: 50, ordered: 30, free: 120, overBy: 0, pct: 40, overPct: 0 });
  });

  it('is exactly full with nothing free and nothing over', () => {
    expect(roomSpace(200, 100, 100)).toMatchObject({ free: 0, overBy: 0, pct: 100, overPct: 0 });
  });

  it('counts how far past full a room is', () => {
    expect(roomSpace(200, 100, 124)).toMatchObject({ free: 0, overBy: 24, pct: 112, overPct: 12 });
    // Any amount over shows as at least 1%.
    expect(roomSpace(1000, 1000, 1)).toMatchObject({ overPct: 1, pct: 101 });
  });

  it('takes a room from the supply rows: stock now and what is ordered, only for the room an item is kept in', () => {
    const supply = new Supply(smallMorning(), { chips: 4, peas: 2, pork: 10 });
    const chips = supply.rows.findIndex((r) => r.item.id === 'chips');
    const peas = supply.rows.findIndex((r) => r.item.id === 'peas');
    const pork = supply.rows.findIndex((r) => r.item.id === 'pork');
    const per = SPACE_PER_UNIT as Record<string, number>;

    expect(supply.roomSpace('freezer')).toMatchObject({
      inStore: (4 + 2) * per.chips!, ordered: 0, free: ROOM_CAPACITY.freezer - 6 * per.chips!,
    });

    supply.set(chips, 10);
    supply.set(peas, 5);
    supply.set(pork, 30);
    expect(supply.roomSpace('freezer')).toMatchObject({ inStore: 6 * per.chips!, ordered: 15 * per.chips! });
    expect(supply.roomSpace('fridge')).toMatchObject({ inStore: 10 * per.pork!, ordered: 30 * per.pork! });
  });

  it('goes over capacity when too much is ordered, and comes back when the amount comes down', () => {
    const supply = new Supply(smallMorning(), {});
    const chips = supply.rows.findIndex((r) => r.item.id === 'chips');
    supply.set(chips, 999);
    const over = supply.roomSpace('freezer');
    expect(over.free).toBe(0);
    expect(over.overBy).toBe(999 * spaceOf('chips') - ROOM_CAPACITY.freezer);
    expect(over.pct).toBeGreaterThan(100);
    supply.set(chips, 10);
    expect(supply.roomSpace('freezer')).toMatchObject({ overBy: 0, overPct: 0 });
  });

  it('leaves the small morning roomy, and lets a fill-everything order on the big morning come close to full', () => {
    const small = new Supply(smallMorning(), {});
    small.fillAll();
    for (const kept of KEPT_ORDER) expect(small.roomSpace(kept).pct).toBeLessThan(60);

    const bigDay = bigMorning();
    const big = new Supply(bigDay, {});
    big.fillAll();
    const pcts = KEPT_ORDER.map((kept) => big.roomSpace(kept).pct);
    expect(Math.max(...pcts)).toBeGreaterThanOrEqual(90);
    expect(Math.max(...pcts)).toBeLessThanOrEqual(100);
    // A normal day, with some stock left over, fits with room to spare.
    const normal = new Supply(bigDay, Object.fromEntries(bigDay.items.map((i) => [i.id, Math.round((bigDay.usual[i.id] ?? 0) * 0.2)])));
    normal.fillAll();
    for (const kept of KEPT_ORDER) expect(normal.roomSpace(kept).pct).toBeLessThanOrEqual(100);
  });
});

describe('the room bars', () => {
  const cells = 36;
  const text = (line: ReturnType<typeof roomBar>) => plain([line])[0]!;

  it('are as wide as asked and made of the three shades in order', () => {
    const bar = text(roomBar(roomSpace(300, 90, 90), cells));
    expect([...bar]).toHaveLength(cells);
    expect(bar).toMatch(/^█+▓+░+$/);
  });

  it('is all free when the room is empty and has no shade it has no use for', () => {
    expect(text(roomBar(roomSpace(300, 0, 0), cells))).toBe('░'.repeat(cells));
    expect(text(roomBar(roomSpace(300, 150, 0), cells))).toBe('█'.repeat(18) + '░'.repeat(18));
    expect(text(roomBar(roomSpace(300, 0, 150), cells))).toBe('▓'.repeat(18) + '░'.repeat(18));
  });

  it('shows a little of every part that has something in it', () => {
    const bar = text(roomBar(roomSpace(3000, 1, 1), cells));
    expect(bar.startsWith('█▓')).toBe(true);
    expect(bar.endsWith('░')).toBe(true);
  });

  it('only fills the whole bar when the room is full', () => {
    expect(text(roomBar(roomSpace(300, 100, 199), cells))).toContain('░');
    expect(text(roomBar(roomSpace(300, 100, 200), cells))).toBe('█'.repeat(12) + '▓'.repeat(24));
  });

  it('is capped at full when over capacity, keeping each part in proportion', () => {
    const bar = text(roomBar(roomSpace(300, 150, 450), cells));
    expect([...bar]).toHaveLength(cells);
    expect(bar).not.toContain('░');
    expect(bar).toBe('█'.repeat(9) + '▓'.repeat(27));
  });

  it('adds up to the width for any split', () => {
    for (let a = 0; a <= 300; a += 17) {
      for (let b = 0; b <= 300; b += 23) {
        const out = barCells([a, b], 300, cells);
        expect(out.reduce((sum, n) => sum + n, 0)).toBe(cells);
        expect(Math.min(...out)).toBeGreaterThanOrEqual(0);
        [a, b].forEach((p, i) => {
          if (p > 0) expect(out[i]).toBeGreaterThanOrEqual(1);
        });
      }
    }
  });
});
