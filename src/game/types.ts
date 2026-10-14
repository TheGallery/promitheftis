import type { PlaceId } from './places';

export interface Item {
  id: string;
  /** Display name, at most 19 characters so it fits the LINES pane. */
  name: string;
  /** Truck space taken by one unit. */
  size: number;
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

export type Message =
  | { kind: 'order'; orderId: number; at: number }
  | { kind: 'supplier' | 'staff'; from: string; text: string; at: number };

export interface Crew {
  names: string[];
  trucks: number[];
}

export interface Morning {
  id: 'small' | 'big';
  title: string;
  items: Item[];
  stock: Record<string, number>;
  trucks: Truck[];
  orders: Order[];
  messages: Message[];
  crews: Crew[];
  storeRoom: string[];
}
