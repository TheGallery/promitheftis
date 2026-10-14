import type { Kept } from './types';

/** How much each store room holds, in space units. */
export const ROOM_CAPACITY: Record<Kept, number> = { freezer: 300, fridge: 520, dry: 800 };

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
  /** Already ordered for the room, not counting the row being edited. */
  ordered: number;
  /** The row being edited. */
  editing: number;
  /** Space left, never below zero. */
  free: number;
  /** How far past full the room is, in space units. */
  overBy: number;
  /** Whole per cent full; past 100 when over capacity. */
  pct: number;
  /** Whole per cent over capacity, 0 when it fits. */
  overPct: number;
}

export function roomSpace(capacity: number, inStore: number, ordered: number, editing: number): RoomSpace {
  const used = inStore + ordered + editing;
  const overBy = Math.max(0, used - capacity);
  const overPct = overBy > 0 ? Math.ceil((overBy * 100) / capacity) : 0;
  const pct = overBy > 0 ? 100 + overPct : Math.round((used * 100) / capacity);
  return { capacity, inStore, ordered, editing, free: Math.max(0, capacity - used), overBy, pct, overPct };
}
