import type { DaySummary } from './day';
import type { Call } from './calls';
import { BIG_TRUCKS } from './morning';
import type { Growth } from './growth';
import type { Mood } from './moods';
import type { PlaceId } from './places';
import { ROOM_GROWTH } from './rooms';
import type { Supply } from './supply';
import type { Crew, Kept, Morning, Truck } from './types';

/** A restaurant that sends orders. */
export interface RunClient {
  name: string;
  place: PlaceId;
  contact: string;
  /** A time the client always wants its order by, in minutes since midnight. */
  before?: number;
}

/** Something a client was told, on the phone, would be on tomorrow's order. */
export interface Promised {
  client: string;
  item: string;
  qty: number;
}

/** What the supplier brought in overnight, for the note about it. */
export interface Delivery {
  items: number;
  units: number;
}

/**
 * What carries over from one day to the next: the stock, the trucks, the size
 * of the store rooms, the clients with how the last day left them, and what was
 * promised. Each day's screens work from the morning built from this.
 */
export interface RunState {
  /** The run began as the small or the big morning. */
  kind: 'small' | 'big';
  /** Which day of the run the state is for; the first day is 1. */
  day: number;
  /** Stock in the store rooms when the day begins. */
  stock: Record<string, number>;
  usual: Record<string, number>;
  trucks: Truck[];
  crews: Crew[];
  storeRoom: string[];
  capacity: Record<Kept, number>;
  clients: RunClient[];
  /** How the last day left each client, by name; a client with no entry has not had a day yet. */
  moods: Record<string, Mood>;
  promises: Promised[];
  /** What came in overnight from the supplier. */
  delivery: Delivery;
}

/** What the day that has just ended hands on to the next one. */
export interface DayOutcome {
  /** What is left of each item once the trucks have gone. */
  left: Record<string, number>;
  /** What was ordered from the supplier, per item. */
  ordered: Record<string, number>;
  moods: Record<string, Mood>;
  promises: Promised[];
  growth: Growth | null;
}

/** The state a run starts from: the fixed morning, with its clients, stock, trucks and rooms. */
export function runFromMorning(m: Morning): RunState {
  return {
    kind: m.id,
    day: m.day,
    stock: { ...m.stock },
    usual: { ...m.usual },
    trucks: m.trucks.map((t) => ({ ...t })),
    crews: m.crews.map((c) => ({ names: [...c.names], trucks: [...c.trucks] })),
    storeRoom: [...m.storeRoom],
    capacity: { ...m.capacity },
    clients: m.orders.map((o) => ({ name: o.client, place: o.place, contact: o.contact, ...(o.before != null ? { before: o.before } : {}) })),
    moods: {},
    promises: [],
    delivery: { items: 0, units: 0 },
  };
}

/** The calls the player answered by promising something for tomorrow, as promises. */
export function promisesFrom(calls: readonly Call[], answers: ReadonlyMap<number, number>): Promised[] {
  return calls.flatMap((c): Promised[] => {
    const choice = answers.get(c.id);
    if (choice == null || !c.item || !c.qty || !c.options[choice]?.addsToOrder) return [];
    return [{ client: c.client, item: c.item, qty: c.qty }];
  });
}

/** What the end of the day hands on, worked out from the placed supplier order and the day's summary. */
export function outcomeOf(
  left: Record<string, number>,
  supply: Supply,
  day: DaySummary,
  calls: readonly Call[],
  answers: ReadonlyMap<number, number>,
  growth: Growth | null,
): DayOutcome {
  return {
    left,
    ordered: Object.fromEntries(supply.ordered().map((o) => [o.item.id, o.amount])),
    moods: Object.fromEntries(day.orders.map((o) => [o.client, o.mood])),
    promises: promisesFrom(calls, answers),
    growth,
  };
}

/** The truck that joins when the player grows by one: the next of the big morning's trucks, then more of the same kinds. */
export function newTruck(id: number): Truck {
  const model = BIG_TRUCKS[(id - 1) % BIG_TRUCKS.length] as Truck;
  return { ...model, id };
}

/** The state of the next morning: yesterday's stock with the supplier's delivery on top, and the growth put to work. */
export function nextDay(run: RunState, outcome: DayOutcome): RunState {
  const stock: Record<string, number> = {};
  for (const id of new Set([...Object.keys(run.stock), ...Object.keys(outcome.left), ...Object.keys(outcome.ordered)])) {
    stock[id] = (outcome.left[id] ?? 0) + (outcome.ordered[id] ?? 0);
  }
  const next: RunState = {
    ...run,
    day: run.day + 1,
    stock,
    trucks: run.trucks.map((t) => ({ ...t })),
    crews: run.crews.map((c) => ({ names: [...c.names], trucks: [...c.trucks] })),
    capacity: { ...run.capacity },
    clients: run.clients.map((c) => ({ ...c })),
    moods: { ...outcome.moods },
    promises: outcome.promises.map((p) => ({ ...p })),
    delivery: {
      items: Object.values(outcome.ordered).filter((n) => n > 0).length,
      units: Object.values(outcome.ordered).reduce((sum, n) => sum + n, 0),
    },
  };
  grow(next, outcome.growth);
  return next;
}

function grow(state: RunState, growth: Growth | null): void {
  if (!growth) return;
  if (growth.kind === 'truck') {
    const truck = newTruck(Math.max(0, ...state.trucks.map((t) => t.id)) + 1);
    state.trucks.push(truck);
    state.crews.at(-1)?.trucks.push(truck.id);
  } else if (growth.kind === 'room') {
    state.capacity[growth.room] += ROOM_GROWTH[growth.room];
  } else if (!state.clients.some((c) => c.name === growth.client.name)) {
    const { name, place, contact } = growth.client;
    state.clients.push({ name, place, contact });
  }
}
