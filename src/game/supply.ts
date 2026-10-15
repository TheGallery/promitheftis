import type { Call } from './calls';
import type { Desk } from './desk';
import { announcedBy, hintsFor, type Announced, type ItemHint } from './demand';
import { shortBy, supplierPrice } from './money';
import { fitRoom, roomSpace, spaceOf, type RoomSpace } from './rooms';
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
  /** What the day's orders asked for, whatever was given. */
  asked: number;
}

/** A client who was promised, on the phone, a number of an item on tomorrow's order. */
export interface CallNote {
  client: string;
  qty: number;
}

/** What is left of each item once the trucks have gone: the stock, less what the delivering orders were given and what a rush order took. */
export function stockAfterDeliveries(desk: Desk, rush?: { item: string; qty: number }): Record<string, number> {
  const left: Record<string, number> = { ...desk.morning.stock };
  desk.morning.orders.forEach((order, o) => {
    if (desk.truckFor(o) == null) return;
    order.lines.forEach((line, l) => {
      left[line.item] = Math.max(0, (left[line.item] ?? 0) - (desk.given(o, l) ?? 0));
    });
  });
  if (rush) left[rush.item] = Math.max(0, (left[rush.item] ?? 0) - rush.qty);
  return left;
}

/** The clients whose answered calls promised an item for tomorrow, by item, with how many each was promised. */
export function callNotes(calls: readonly Call[], answers: ReadonlyMap<number, number>): Map<string, CallNote[]> {
  const notes = new Map<string, CallNote[]>();
  for (const call of calls) {
    const choice = answers.get(call.id);
    if (choice == null || !call.item || !call.options[choice]?.addsToOrder) continue;
    const list = notes.get(call.item) ?? [];
    const same = list.find((n) => n.client === call.client);
    if (same) same.qty += call.qty ?? 0;
    else list.push({ client: call.client, qty: call.qty ?? 0 });
    notes.set(call.item, list);
  }
  return notes;
}

/** A fills a room to this much of its space, a little over, so the warning is still there to be read. */
const FILL_ALL_TO = 1.15;

/**
 * Tomorrow's order to the supplier: an amount for every item, grouped by where
 * it is kept. Rows are numbered in the order they are listed on the screen.
 */
export class Supply {
  readonly rows: SupplyRow[];
  readonly notes: Map<string, CallNote[]>;
  /** What the overnight messages and then the notes on today's orders say about tomorrow. */
  readonly ahead: Announced[];
  /** The day of the run the order is made on; the order is for the day after. */
  readonly day: number;
  private readonly capacity: Record<Kept, number>;
  private readonly amounts: number[];
  private readonly confirmed: boolean[];
  placed = false;

  constructor(morning: Morning, onHand: Record<string, number>, notes: Map<string, CallNote[]> = new Map()) {
    this.notes = notes;
    this.ahead = [...(morning.tomorrow ?? []), ...announcedBy(morning.orders)];
    this.day = morning.day;
    this.capacity = morning.capacity;
    const asked = new Map<string, number>();
    for (const o of morning.orders) for (const l of o.lines) asked.set(l.item, (asked.get(l.item) ?? 0) + l.asked);
    this.rows = KEPT_ORDER.flatMap((kept) =>
      morning.items
        .filter((item) => item.kept === kept)
        .map((item) => ({ item, kept, onHand: onHand[item.id] ?? 0, usual: morning.usual[item.id] ?? 0, asked: asked.get(item.id) ?? 0 })),
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

  /** What the supplier charges for one unit of a row's item. */
  price(r: number): number {
    const row = this.rows[r];
    return row ? supplierPrice(row.item.id) : 0;
  }

  /** What the notes on today's orders say about tomorrow for a row's item. */
  hints(r: number): ItemHint[] {
    const row = this.rows[r];
    return row ? hintsFor(this.ahead, row.item.id) : [];
  }

  /** What a row's amount costs: the amount times the price of one unit. */
  cost(r: number): number {
    return this.amount(r) * this.price(r);
  }

  /** What the whole order costs. */
  totalCost(): number {
    return this.rows.reduce((sum, _, r) => sum + this.cost(r), 0);
  }

  /** How far below zero the order leaves `cash`; zero when the cash covers it. */
  shortfall(cash: number): number {
    const cost = this.totalCost();
    return cost > 0 ? shortBy(cash, cost) : 0;
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

  /**
   * Fills every row at zero up to its gap, but no further than its room can hold: where the gaps together would not
   * fit, each is cut by the same share. A row with an amount is left as it is, and takes its space first.
   */
  fillAll(): void {
    const rooms = new Set(this.rows.map((row) => row.kept));
    for (const kept of rooms) {
      const empty: number[] = [];
      let free = this.capacity[kept] * FILL_ALL_TO;
      let need = 0;
      this.rows.forEach((row, r) => {
        if (row.kept !== kept) return;
        const space = spaceOf(row.item.id);
        free -= (row.onHand + this.amount(r)) * space;
        if (this.amount(r) === 0) {
          empty.push(r);
          need += this.gap(r) * space;
        }
      });
      const share = need > free ? Math.max(0, free) / need : 1;
      for (const r of empty) this.set(r, Math.floor(this.gap(r) * share));
    }
  }

  /** How many units of each item in a room will spoil tomorrow because the room has no space for them. */
  spoilage(kept: Kept): Map<string, number> {
    const entries = this.rows.flatMap((row, r) => (row.kept === kept ? [{ item: row.item.id, inStore: row.onHand, ordered: this.amount(r) }] : []));
    return new Map(fitRoom(this.capacity[kept], entries).filter((f) => f.spoils > 0).map((f) => [f.item, f.spoils]));
  }

  /** How full a room will be tomorrow, and how many units of what is in it will spoil. */
  roomSpace(kept: Kept): RoomSpace {
    let inStore = 0;
    let ordered = 0;
    this.rows.forEach((row, r) => {
      if (row.kept !== kept) return;
      const space = spaceOf(row.item.id);
      inStore += row.onHand * space;
      ordered += this.amount(r) * space;
    });
    const spoils = [...this.spoilage(kept).values()].reduce((sum, n) => sum + n, 0);
    return roomSpace(this.capacity[kept], inStore, ordered, spoils);
  }

  /** The items with something to order, in the order listed. */
  ordered(): Array<{ item: Item; amount: number }> {
    return this.rows.flatMap((row, r) => (this.amount(r) > 0 ? [{ item: row.item, amount: this.amount(r) }] : []));
  }

  total(): number {
    return this.amounts.reduce((sum, n) => sum + n, 0);
  }
}
