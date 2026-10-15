import type { DaySummary } from './day';
import type { Call } from './calls';
import { settle, type Notice, type Standings } from './churn';
import { usualWith, usualWithout } from './clients';
import { closedIn } from './daysize';
import type { Announced } from './demand';
import { BIG_TRUCKS, ITEM_LIST } from './morning';
import type { Growth } from './growth';
import { growthPrice, STARTING_CASH } from './money';
import { clientDay, remember, type ClientDay, type History } from './history';
import type { Mood } from './moods';
import type { PlaceId } from './places';
import { fitRoom, ROOM_GROWTH } from './rooms';
import { creditFor, deliveredOf, shortfallFor } from './shortfall';
import { KEPT_ORDER, type Supply } from './supply';
import type { Crew, Kept, Morning, Short, Truck } from './types';

/** A restaurant that sends orders. */
export interface RunClient {
  name: string;
  place: PlaceId;
  contact: string;
  /** A time the client always wants its order by, in minutes since midnight. */
  before?: number;
  /** How big its orders are next to an ordinary client's; an ordinary client leaves it out. */
  size?: number;
  /** The store room most of its order comes from; a client with no favourite room leaves it out. */
  heavy?: Kept;
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

/** Units of an item that had no space in its room overnight and spoiled. */
export interface Spoiled {
  item: string;
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
  /** How each client's last two days went, the most recent first; a client with no entry has had no day yet. */
  history: History;
  promises: Promised[];
  /** What came in overnight from the supplier. */
  delivery: Delivery;
  /** What spoiled overnight because its room was full; it was paid for all the same. */
  spoiled: Spoiled[];
  /** What yesterday's overnight messages and the notes on its orders announced for today: the clients a town event is about, the ones that are closed, and what a note said. */
  ahead: Announced[];
  /** What the supplier left behind of last night's delivery; the stock holds only what came, and the rest was not charged for. */
  short: Short[];
  /** The cash in the bank when the day begins; below zero when the business owes money. */
  cash: number;
  /** How many days running each client has been let down, and any break they are on; a client with nothing to say has no entry. */
  standing: Standings;
  /** What clients have to say this morning about taking a break or leaving. */
  news: Notice[];
  /** The names of the clients who have gone for good, so that a new client never takes one. */
  lost: string[];
}

/** What the day that has just ended hands on to the next one. */
export interface DayOutcome {
  /** What is left of each item once the trucks have gone. */
  left: Record<string, number>;
  /** What was ordered from the supplier, per item. */
  ordered: Record<string, number>;
  moods: Record<string, Mood>;
  /** How the day went for each client, by name. */
  today: Record<string, ClientDay>;
  promises: Promised[];
  growth: Growth | null;
  /** What the day came to: taken in, less the supplier order and the trucks. */
  earned: number;
  /** What the notes on the day's orders announce for tomorrow; none when it is not said. */
  ahead?: Announced[];
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
    history: {},
    promises: [],
    delivery: { items: 0, units: 0 },
    spoiled: [],
    ahead: [],
    short: [],
    cash: STARTING_CASH,
    standing: {},
    news: [],
    lost: [],
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
    today: Object.fromEntries(day.orders.map((o) => [o.client, clientDay(o)])),
    promises: promisesFrom(calls, answers),
    growth,
    earned: day.money.total,
    ahead: supply.ahead.map((a) => ({ ...a })),
  };
}

/** Drivers for the trucks that join beyond the big morning's nine. */
export const EXTRA_DRIVERS: readonly string[] = [
  'Nia', 'Olek', 'Rosa', 'Ben', 'Ines', 'Yusuf', 'Hana', 'Pete', 'Zara', 'Luca',
  'Mei', 'Owen', 'Sofia', 'Ade', 'Greta', 'Ivan', 'Lou', 'Femi', 'Clara', 'Jonas',
];

/**
 * The truck that joins when the player grows by one: the next of the big
 * morning's trucks, then more of the same kinds, each with a driver no other
 * truck has.
 */
export function newTruck(id: number, drivers: Iterable<string> = []): Truck {
  const taken = new Set(drivers);
  const model = BIG_TRUCKS[(id - 1) % BIG_TRUCKS.length] as Truck;
  if (id <= BIG_TRUCKS.length && !taken.has(model.driver)) return { ...model, id };
  const names = [...BIG_TRUCKS.map((t) => t.driver), ...EXTRA_DRIVERS];
  let driver = names.find((n) => !taken.has(n));
  for (let round = 2; !driver; round++) driver = names.map((n) => `${n} ${round}`).find((n) => !taken.has(n));
  return { ...model, id, driver };
}

/**
 * The stock in the rooms when the next morning begins: what was left and the delivery on top of it, as much as each
 * room holds. The rest spoils, and is listed in the order the rooms and their items are listed on the supplier screen.
 */
function settleRooms(
  run: RunState,
  outcome: DayOutcome,
  capacity: Record<Kept, number>,
): { stock: Record<string, number>; spoiled: Spoiled[] } {
  const stock: Record<string, number> = {};
  const spoiled: Spoiled[] = [];
  const ids = new Set([...Object.keys(run.stock), ...Object.keys(outcome.left), ...Object.keys(outcome.ordered)]);
  for (const kept of KEPT_ORDER) {
    const items = ITEM_LIST.filter((i) => i.kept === kept);
    const entries = items.map((i) => ({ item: i.id, inStore: outcome.left[i.id] ?? 0, ordered: outcome.ordered[i.id] ?? 0 }));
    for (const fit of fitRoom(capacity[kept], entries)) {
      stock[fit.item] = fit.keeps;
      if (fit.spoils > 0) spoiled.push({ item: fit.item, units: fit.spoils });
    }
  }
  for (const id of ids) if (!(id in stock)) stock[id] = (outcome.left[id] ?? 0) + (outcome.ordered[id] ?? 0);
  return { stock, spoiled };
}

/**
 * The state of the next morning: yesterday's stock with the supplier's delivery on top, the cash with the day's
 * money settled and any growth paid for, and the growth put to work. `seed` is the one that makes up the next morning;
 * with it the supplier may leave part of the order behind, and the cash gets back what was paid for that part.
 * Without one the whole order arrives.
 */
export function nextDay(run: RunState, outcome: DayOutcome, seed?: number): RunState {
  const capacity = { ...run.capacity };
  if (outcome.growth?.kind === 'room') capacity[outcome.growth.room] += ROOM_GROWTH[outcome.growth.room];
  const short = seed == null ? [] : shortfallFor(outcome.ordered, seed);
  const delivered = deliveredOf(outcome.ordered, short);
  // A client that was closed today sent no order, so nothing was said of how it went or what was promised it: that waits for its next order.
  const closed = closedIn(run.ahead);
  const { stock, spoiled } = settleRooms(run, { ...outcome, ordered: delivered }, capacity);
  const settled = settle(run.clients, run.standing, outcome.moods, run.day, seed);
  const gone = new Set(settled.gone);
  // A client who has gone, or is on a break, is not remembered by what they left behind: they come back, if they do, with a clean slate.
  const out = (name: string) => gone.has(name) || (settled.standing[name]?.away ?? 0) > 0;
  let usual = { ...run.usual };
  for (const name of settled.gone) {
    const leaving = run.clients.find((c) => c.name === name);
    if (leaving) usual = usualWithout(usual, run.clients, leaving);
  }
  const next: RunState = {
    ...run,
    day: run.day + 1,
    stock,
    usual,
    trucks: run.trucks.map((t) => ({ ...t })),
    crews: run.crews.map((c) => ({ names: [...c.names], trucks: [...c.trucks] })),
    capacity,
    clients: run.clients.filter((c) => !gone.has(c.name)).map((c) => ({ ...c })),
    moods: Object.fromEntries(Object.entries({ ...Object.fromEntries(Object.entries(run.moods).filter(([name]) => closed.has(name))), ...outcome.moods }).filter(([name]) => !out(name))),
    history: Object.fromEntries(Object.entries(remember(run.history, outcome.today)).filter(([name]) => !out(name))),
    promises: [...run.promises.filter((p) => closed.has(p.client)), ...outcome.promises].filter((p) => !out(p.client)).map((p) => ({ ...p })),
    delivery: {
      items: Object.values(delivered).filter((n) => n > 0).length,
      units: Object.values(delivered).reduce((sum, n) => sum + n, 0),
    },
    spoiled,
    ahead: (outcome.ahead ?? []).map((a) => ({ ...a })),
    short,
    cash: run.cash + outcome.earned + creditFor(short) - (outcome.growth ? growthPrice(outcome.growth, run.clients.length, run.trucks.length) : 0),
    standing: settled.standing,
    news: settled.news,
    lost: [...run.lost, ...settled.gone],
  };
  grow(next, outcome.growth);
  return next;
}

function grow(state: RunState, growth: Growth | null): void {
  if (!growth) return;
  if (growth.kind === 'truck') {
    const truck = newTruck(
      Math.max(0, ...state.trucks.map((t) => t.id)) + 1,
      state.trucks.map((t) => t.driver),
    );
    state.trucks.push(truck);
    state.crews.at(-1)?.trucks.push(truck.id);
  } else if (growth.kind === 'client' && !state.clients.some((c) => c.name === growth.client.name)) {
    const { name, place, contact, shape } = growth.client;
    state.usual = usualWith(state.usual, state.clients, shape);
    state.clients.push({
      name,
      place,
      contact,
      ...(shape.size !== 1 ? { size: shape.size } : {}),
      ...(shape.before != null ? { before: shape.before } : {}),
      ...(shape.heavy ? { heavy: shape.heavy } : {}),
    });
  }
}
