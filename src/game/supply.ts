import type { Call } from './calls';
import type { Desk } from './desk';
import { roomSpace, spaceOf, type RoomSpace } from './rooms';
import type { Item, Kept, Morning } from './types';

/** The rooms in the order the screen lists them. */
export const KEPT_ORDER: readonly Kept[] = ['freezer', 'fridge', 'dry'];
export const KEPT_LABEL: Record<Kept, string> = { freezer: 'FREEZER', fridge: 'FRIDGE', dry: 'DRY STORE' };

export const MAX_ORDER = 999;

export interface SupplyRow {
  item: Item;
  kept: Kept;
  /** What is left after today's deliveries. */
  onHand: number;
  usual: number;
}

/** A client who asked, on the phone, for an item to go on tomorrow's order. */
export interface CallNote {
  client: string;
}

/** What is left of each item once the trucks have gone: the stock, less what the delivering orders were given. */
export function stockAfterDeliveries(desk: Desk): Record<string, number> {
  const left: Record<string, number> = { ...desk.morning.stock };
  desk.morning.orders.forEach((order, o) => {
    if (desk.truckFor(o) == null) return;
    order.lines.forEach((line, l) => {
      left[line.item] = Math.max(0, (left[line.item] ?? 0) - (desk.given(o, l) ?? 0));
    });
  });
  return left;
}

/** The clients whose answered calls promised an item for tomorrow, by item. */
export function callNotes(calls: readonly Call[], answers: ReadonlyMap<number, number>): Map<string, CallNote[]> {
  const notes = new Map<string, CallNote[]>();
  for (const call of calls) {
    const choice = answers.get(call.id);
    if (choice == null || !call.item || !call.options[choice]?.addsToOrder) continue;
    const list = notes.get(call.item) ?? [];
    if (!list.some((n) => n.client === call.client)) list.push({ client: call.client });
    notes.set(call.item, list);
  }
  return notes;
}

/**
 * Tomorrow's order to the supplier: an amount for every item, grouped by where
 * it is kept. Rows are numbered in the order they are listed on the screen.
 */
export class Supply {
  readonly rows: SupplyRow[];
  readonly notes: Map<string, CallNote[]>;
  private readonly capacity: Record<Kept, number>;
  private readonly amounts: number[];
  private readonly confirmed: boolean[];
  placed = false;

  constructor(morning: Morning, onHand: Record<string, number>, notes: Map<string, CallNote[]> = new Map()) {
    this.notes = notes;
    this.capacity = morning.capacity;
    this.rows = KEPT_ORDER.flatMap((kept) =>
      morning.items
        .filter((item) => item.kept === kept)
        .map((item) => ({ item, kept, onHand: onHand[item.id] ?? 0, usual: morning.usual[item.id] ?? 0 })),
    );
    this.amounts = this.rows.map(() => 0);
    this.confirmed = this.rows.map(() => false);
  }

  get count(): number {
    return this.rows.length;
  }

  amount(r: number): number {
    return this.amounts[r] ?? 0;
  }

  isConfirmed(r: number): boolean {
    return this.confirmed[r] ?? false;
  }

  /** What it takes to bring a row up to the usual daily amount. */
  gap(r: number): number {
    const row = this.rows[r];
    return row ? Math.max(0, row.usual - row.onHand) : 0;
  }

  /** Sets the amount of a row, kept between 0 and the most that can be typed. Returns the value used. */
  set(r: number, amount: number): number {
    const value = Math.max(0, Math.min(Math.trunc(amount), MAX_ORDER));
    if (r in this.amounts) this.amounts[r] = value;
    return value;
  }

  nudge(r: number, delta: number): number {
    return this.set(r, this.amount(r) + delta);
  }

  confirm(r: number): void {
    if (r in this.confirmed) this.confirmed[r] = true;
  }

  /** Fills a row that is at zero up to its gap; a row with an amount is left as it is. Returns the amount now. */
  fillRow(r: number): number {
    if (this.amount(r) > 0) return this.amount(r);
    return this.set(r, this.gap(r));
  }

  fillAll(): void {
    for (let r = 0; r < this.count; r++) this.fillRow(r);
  }

  /** How full a room will be tomorrow. */
  roomSpace(kept: Kept): RoomSpace {
    let inStore = 0;
    let ordered = 0;
    this.rows.forEach((row, r) => {
      if (row.kept !== kept) return;
      const space = spaceOf(row.item.id);
      inStore += row.onHand * space;
      ordered += this.amount(r) * space;
    });
    return roomSpace(this.capacity[kept], inStore, ordered);
  }

  /** The items with something to order, in the order listed. */
  ordered(): Array<{ item: Item; amount: number }> {
    return this.rows.flatMap((row, r) => (this.amount(r) > 0 ? [{ item: row.item, amount: this.amount(r) }] : []));
  }

  total(): number {
    return this.amounts.reduce((sum, n) => sum + n, 0);
  }
}
