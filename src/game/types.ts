import type { CallKind } from './calls';
import type { PlaceId } from './places';

/** Where an item is kept: the freezer, the fridge or the dry store. */
export type Kept = 'freezer' | 'fridge' | 'dry';

export interface Item {
  id: string;
  /** Display name, at most 19 characters so it fits the LINES pane. */
  name: string;
  /** Truck space taken by one unit. */
  size: number;
  kept: Kept;
}

export interface OrderLine {
  item: string;
  asked: number;
}

export interface Order {
  id: number;
  client: string;
  place: PlaceId;
  contact: string;
  note?: string;
  /** Latest arrival the client asked for, in minutes since midnight. */
  before?: number;
  /** When the message came in, in minutes since the evening before (may exceed 1440). */
  leftAt: number;
  lines: OrderLine[];
}

export interface Truck {
  id: number;
  driver: string;
  kind: string;
  /** Truck space available. */
  capacity: number;
}

/** A truck that is at the garage for the day: it cannot be loaded or sent, and costs nothing. */
export interface Garage {
  truckId: number;
  /** What is wrong with it, as it follows "with": "a flat battery". */
  reason: string;
}

export type Message =
  | { kind: 'order'; orderId: number; at: number }
  | { kind: 'supplier' | 'staff'; from: string; text: string; at: number };

/** An item the supplier delivered less of than was ordered: `came` of the `ordered` units arrived. */
export interface Short {
  item: string;
  ordered: number;
  came: number;
}

export interface Crew {
  names: string[];
  trucks: number[];
}

export interface Morning {
  /** The run this morning belongs to: it began as the small or the big morning. */
  id: 'small' | 'big';
  /** Which day of the run this is; the fixed morning is day 1. */
  day: number;
  title: string;
  items: Item[];
  stock: Record<string, number>;
  /** The usual amount of each item used in a day: what the supplier order fills up to. */
  usual: Record<string, number>;
  /** How much each store room holds, in space units. */
  capacity: Record<Kept, number>;
  trucks: Truck[];
  orders: Order[];
  messages: Message[];
  crews: Crew[];
  storeRoom: string[];
  /** The kinds of phone call this morning, in order; a morning without any uses its size's usual kinds. */
  callKinds?: CallKind[];
  /** The truck out for the day, if one is. */
  garage?: Garage;
  /** Varies which item a client forgets, so the same client does not forget the same thing every day. */
  callSalt?: number;
  /** The items the supplier delivered less of overnight than was ordered; the stock already holds only what came. */
  short?: Short[];
}
