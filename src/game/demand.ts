import type { Order } from './types';

/**
 * What a client's note says about tomorrow: a busy day ahead asks for more of some items, a quiet one for less.
 * The note is shown on the order, the day before it matters.
 */
export interface DemandEvent {
  id: string;
  /** The words, in lower case, that show it in a note. */
  phrase: string;
  /** Busy: the client will ask for more of these items. Quiet: for less. */
  busy: boolean;
  items: readonly string[];
  /** How the supplier order names it: "Hotel Bellevue (a wedding)". */
  word: string;
}

export const EVENTS: readonly DemandEvent[] = [
  { id: 'wedding', phrase: 'wedding', busy: true, items: ['pork', 'eggs', 'mozzarella'], word: 'a wedding' },
  { id: 'quiz', phrase: 'quiz night', busy: true, items: ['chips', 'ketchup', 'peas'], word: 'quiz night' },
  { id: 'harvest', phrase: 'harvest supper', busy: true, items: ['pork', 'potatoes', 'gravy', 'flour'], word: 'a harvest supper' },
  { id: 'birthday', phrase: 'birthday lunch', busy: true, items: ['pork', 'chips', 'potatoes', 'ketchup'], word: 'a birthday lunch' },
  { id: 'halfterm', phrase: 'half term', busy: true, items: ['chips', 'peas', 'ketchup', 'eggs'], word: 'half term' },
  { id: 'menu', phrase: 'new menu', busy: true, items: ['oil', 'rice', 'tomatoes', 'mozzarella'], word: 'a new menu' },
  { id: 'scones', phrase: 'scones', busy: true, items: ['flour', 'eggs'], word: 'scones' },
  { id: 'simple', phrase: 'keep it simple', busy: false, items: ['pork', 'mozzarella', 'oil', 'rice'], word: 'a simple menu' },
  { id: 'fridge', phrase: 'walk-in fridge', busy: false, items: ['pork', 'eggs', 'mozzarella'], word: 'the fridge being fixed' },
];

/** A client whose note, on the day it was shown, said tomorrow would be different. */
export interface Announced {
  client: string;
  /** The id of a `DemandEvent`. */
  event: string;
}

export function eventById(id: string): DemandEvent | undefined {
  return EVENTS.find((e) => e.id === id);
}

/** What the orders' notes announce for the next day: the first event each note names. */
export function announcedBy(orders: readonly Pick<Order, 'client' | 'note'>[]): Announced[] {
  return orders.flatMap((o): Announced[] => {
    const note = o.note?.toLowerCase() ?? '';
    const event = EVENTS.find((e) => note.includes(e.phrase));
    return event ? [{ client: o.client, event: event.id }] : [];
  });
}

/**
 * How much of its usual amount an item changes by for each event that names it, as a share: the more clients the
 * business has, the less one of them moves the whole.
 */
const STRENGTH = 0.4;
/** Events together never move an item by more than this share of its usual amount, up or down. */
const MOST = 0.3;

/** The units one event adds to (or, if quiet, takes from) one item's total when the business has `clients` clients. */
export function swingUnits(event: DemandEvent, usual: number, clients: number): number {
  const units = Math.max(1, Math.round((usual * STRENGTH) / Math.sqrt(Math.max(1, clients))));
  return event.busy ? units : -units;
}

/**
 * The units each announced event moves each item by, kept together within the most an item may swing: a list of
 * client, item and units, in the order announced. A quiet event only takes away from a client that asks for the item.
 */
export function swings(
  ahead: readonly Announced[],
  usual: Readonly<Record<string, number>>,
  clients: number,
): Array<{ client: string; item: string; units: number }> {
  const all = ahead.flatMap((a) => {
    const event = eventById(a.event);
    if (!event) return [];
    return event.items.map((item) => ({ client: a.client, item, units: swingUnits(event, usual[item] ?? 0, clients) }));
  });
  const totals = new Map<string, number>();
  for (const s of all) totals.set(s.item, (totals.get(s.item) ?? 0) + s.units);
  return all.map((s) => {
    const total = totals.get(s.item) as number;
    const limit = (usual[s.item] ?? 0) * MOST;
    return { ...s, units: Math.abs(total) > limit && limit > 0 ? Math.round((s.units * limit) / Math.abs(total)) : s.units };
  });
}

/** What an announced event means for one item, as the supplier order shows it. */
export interface ItemHint {
  client: string;
  word: string;
  busy: boolean;
}

/** The announced events that name an item, in the order announced. */
export function hintsFor(ahead: readonly Announced[], item: string): ItemHint[] {
  return ahead.flatMap((a): ItemHint[] => {
    const event = eventById(a.event);
    return event && event.items.includes(item) ? [{ client: a.client, word: event.word, busy: event.busy }] : [];
  });
}
