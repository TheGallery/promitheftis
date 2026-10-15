import { callLine, type Call } from './calls';
import type { History } from './history';
import { moodFacts, moodOf, moodReasons, type Mood } from './moods';
import { dayMoney, STARTING_CASH, type DayMoney, type Units } from './money';
import type { MorningResult, OrderResult } from './results';
import { KEPT_ORDER, type Supply } from './supply';
import type { RoomSpace } from './rooms';
import type { Item, Kept } from './types';

export interface DayOrder extends OrderResult {
  mood: Mood;
  /** Why the client is in that mood. */
  reasons: string[];
}

export interface DayTruck {
  truckId: number;
  driver: string;
  /** When the truck got back; null if it never left the yard. */
  backAt: number | null;
  /** The clients it reached after the time they asked for. */
  lateTo: string[];
}

export interface DayCall {
  /** Who rang, what about, and what was answered. */
  line: string;
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

/** Everything the end-of-day screen says, worked out once the supplier order is placed. */
export function buildDay(
  result: MorningResult,
  calls: readonly Call[],
  answers: ReadonlyMap<number, number>,
  supply: Supply,
  history: History = {},
  cash = STARTING_CASH,
): DaySummary {
  const orders = result.orders.map((o): DayOrder => {
    const facts = moodFacts(o, calls, answers, history[o.client]);
    return { ...o, mood: moodOf(facts), reasons: moodReasons(facts, o.truckId == null) };
  });
  const trucks = result.trucks.map((t): DayTruck => ({
    truckId: t.truckId,
    driver: t.driver,
    backAt: t.backAt,
    lateTo: result.orders.filter((o) => o.truckId === t.truckId && o.lateForAsk).map((o) => o.client),
  }));
  const answered = calls.filter((c) => answers.has(c.id));
  const rooms = KEPT_ORDER.map((kept): DayRoom => ({ kept, space: supply.roomSpace(kept) }));
  const keptOf = new Map(supply.rows.map((row) => [row.item.id, row.kept]));
  const delivered = result.orders.flatMap((o): Units[] => o.delivered.map((d) => ({ kept: keptOf.get(d.item) ?? 'dry', units: d.units })));
  const ordered = supply.ordered().map((o): Units => ({ kept: o.item.kept, units: o.amount }));
  const trucksOut = result.trucks.filter((t) => t.backAt != null).length;
  return {
    orders,
    trucks,
    calls: answered.map((c) => {
      const choice = answers.get(c.id) as number;
      return { line: callLine(c, choice), promised: !!c.options[choice]?.addsToOrder };
    }),
    ordered: supply.ordered(),
    units: supply.total(),
    rooms,
    overFull: rooms.filter((r) => r.space.overBy > 0),
    money: dayMoney(cash, delivered, ordered, trucksOut),
  };
}
