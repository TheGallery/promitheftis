import { callLine, type Call } from './calls';
import type { History } from './history';
import { moodFacts, moodOf, moodReasons, type Mood } from './moods';
import { dayMoney, STARTING_CASH, takenIn, tripCosts, type DayMoney, type Trip, type Units } from './money';
import type { MorningResult, OrderResult } from './results';
import type { Promised } from './run';
import { KEPT_ORDER, type Supply } from './supply';
import type { RoomSpace } from './rooms';
import type { Item, Kept } from './types';

export interface DayOrder extends OrderResult {
  mood: Mood;
  /** Why the client is in that mood. */
  reasons: string[];
  /** What the client paid for what arrived. */
  paid: number;
}

export interface DayTruck {
  truckId: number;
  driver: string;
  /** When the truck got back; null if it never left the yard. */
  backAt: number | null;
  /** The clients it reached after the time they asked for. */
  lateTo: string[];
  /** Squares of the map it drove, and what that cost; nothing for a truck that stayed in the yard. */
  squares: number;
  cost: number;
}

export interface DayCall {
  /** Who rang, what about, and what was answered. */
  line: string;
  client: string;
  topic: string;
  /** What was answered, as the result reads it. */
  record: string;
  /** True when the answer promised something for tomorrow's order. */
  promised: boolean;
}

export interface DayRoom {
  kept: Kept;
  space: RoomSpace;
}

export interface DaySummary {
  orders: DayOrder[];
  trucks: DayTruck[];
  calls: DayCall[];
  ordered: Array<{ item: Item; amount: number }>;
  units: number;
  rooms: DayRoom[];
  /** The rooms that tomorrow's order fills past full. */
  overFull: DayRoom[];
  money: DayMoney;
}

/** What the orders were given, line by line, with the room each item is kept in. */
export function unitsOf(orders: readonly OrderResult[], kept: (item: string) => Kept): Units[] {
  return orders.flatMap((o) => o.delivered.map((d): Units => ({ item: d.item, kept: kept(d.item), units: d.units })));
}

/** What the morning's deliveries brought in, and what the trucks that took them cost: the cash it adds to the bank is the difference. */
export function morningMoney(result: MorningResult, kept: (item: string) => Kept): { takenIn: number; trucks: number } {
  return {
    takenIn: takenIn(unitsOf(result.orders, kept)),
    trucks: tripCosts(tripsOf(result)).reduce((sum, t) => sum + t.cost, 0),
  };
}

/** The trucks that went out, with how far each drove. */
export function tripsOf(result: MorningResult): Trip[] {
  return result.trucks.filter((t) => t.backAt != null).map((t) => ({ truckId: t.truckId, driver: t.driver, squares: t.squares }));
}

/** Everything the end-of-day screen says, worked out once the supplier order is placed. */
export function buildDay(
  result: MorningResult,
  calls: readonly Call[],
  answers: ReadonlyMap<number, number>,
  supply: Supply,
  history: History = {},
  cash = STARTING_CASH,
  promised: readonly Promised[] = [],
): DaySummary {
  const keptOf = new Map(supply.rows.map((row) => [row.item.id, row.kept]));
  const kept = (item: string): Kept => keptOf.get(item) ?? 'dry';
  const orders = result.orders.map((o): DayOrder => {
    const facts = moodFacts(o, calls, answers, history[o.client], promised);
    return { ...o, mood: moodOf(facts), reasons: moodReasons(facts, o.truckId == null), paid: takenIn(unitsOf([o], kept)) };
  });
  const costs = new Map(tripCosts(tripsOf(result)).map((t) => [t.truckId, t.cost]));
  const trucks = result.trucks.map((t): DayTruck => ({
    truckId: t.truckId,
    driver: t.driver,
    backAt: t.backAt,
    lateTo: result.orders.filter((o) => o.truckId === t.truckId && o.lateForAsk).map((o) => o.client),
    squares: t.squares,
    cost: costs.get(t.truckId) ?? 0,
  }));
  const answered = calls.filter((c) => answers.has(c.id));
  const rooms = KEPT_ORDER.map((kept): DayRoom => ({ kept, space: supply.roomSpace(kept) }));
  const ordered = supply.ordered().map((o): Units => ({ item: o.item.id, kept: o.item.kept, units: o.amount }));
  return {
    orders,
    trucks,
    calls: answered.map((c) => {
      const choice = answers.get(c.id) as number;
      return { line: callLine(c, choice), client: c.client, topic: c.topic, record: c.options[choice]?.record ?? '', promised: !!c.options[choice]?.addsToOrder };
    }),
    ordered: supply.ordered(),
    units: supply.total(),
    rooms,
    overFull: rooms.filter((r) => r.space.overBy > 0),
    money: dayMoney(cash, unitsOf(result.orders, kept), ordered, tripsOf(result)),
  };
}
