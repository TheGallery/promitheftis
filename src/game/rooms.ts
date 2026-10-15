import type { Kept } from './types';

/** How much each store room holds, in space units, when the run begins as the big morning. */
export const ROOM_CAPACITY: Record<Kept, number> = { freezer: 340, fridge: 600, dry: 920 };

/** How much each store room holds when the run begins as the small morning: a smaller business has smaller rooms. */
export const SMALL_ROOM_CAPACITY: Record<Kept, number> = { freezer: 210, fridge: 270, dry: 540 };

/** How much space a bigger room gains, in space units. */
export const ROOM_GROWTH: Record<Kept, number> = { freezer: 100, fridge: 150, dry: 200 };

/** The space one unit of each item takes in its room, in the same units. */
export const SPACE_PER_UNIT: Record<string, number> = {
  chips: 3, peas: 3,
  pork: 1, eggs: 2, mozzarella: 2,
  ketchup: 1, potatoes: 4, flour: 4, gravy: 1, tomatoes: 1, oil: 3, rice: 3,
};

export function spaceOf(itemId: string): number {
  return SPACE_PER_UNIT[itemId] ?? 1;
}

/** How a room's space is used, in space units; `pct` is of the room's capacity. */
export interface RoomSpace {
  capacity: number;
  /** Stock in the room now, after today's deliveries. */
  inStore: number;
  /** Ordered for the room. */
  ordered: number;
  /** Space left, never below zero. */
  free: number;
  /** How far past full the room is, in space units. */
  overBy: number;
  /** Whole per cent full; past 100 when over capacity. */
  pct: number;
  /** Whole per cent over capacity, 0 when it fits. */
  overPct: number;
  /** Units that will not fit and so spoil; 0 when the room holds everything. */
  spoils: number;
}

export function roomSpace(capacity: number, inStore: number, ordered: number, spoils = 0): RoomSpace {
  const used = inStore + ordered;
  const overBy = Math.max(0, used - capacity);
  const overPct = overBy > 0 ? Math.ceil((overBy * 100) / capacity) : 0;
  const pct = overBy > 0 ? 100 + overPct : Math.round((used * 100) / capacity);
  return { capacity, inStore, ordered, free: Math.max(0, capacity - used), overBy, pct, overPct, spoils };
}

/** What is held of one item in a room: the stock already there and what is delivered on top of it. */
export interface RoomEntry {
  item: string;
  inStore: number;
  ordered: number;
}

/** What a room keeps of one item, and what spoils because there is no space for it. */
export interface RoomKeeps {
  item: string;
  keeps: number;
  spoils: number;
}

/**
 * What a room can hold. The stock already there is kept first, in the order the items are listed, and the delivery
 * fills what space is left in the same order; whatever does not fit spoils. It is paid for all the same.
 */
export function fitRoom(capacity: number, entries: readonly RoomEntry[]): RoomKeeps[] {
  let free = capacity;
  const take = (units: number, itemId: string): number => {
    const space = spaceOf(itemId);
    const fits = Math.max(0, Math.min(units, Math.floor(free / space)));
    free -= fits * space;
    return fits;
  };
  const inStore = entries.map((e) => take(e.inStore, e.item));
  const ordered = entries.map((e) => take(e.ordered, e.item));
  return entries.map((e, i) => ({
    item: e.item,
    keeps: (inStore[i] as number) + (ordered[i] as number),
    spoils: e.inStore + e.ordered - (inStore[i] as number) - (ordered[i] as number),
  }));
}
