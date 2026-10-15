import type { Call } from './calls';
import { clientPrice, rushPay, rushTripCost } from './money';
import { DEPOT, travelMinutes, travelSquares, type PlaceId } from './places';
import { below, mulberry32, type Random } from './random';
import type { MorningResult } from './results';
import type { Road, RoadEvent, RoadTruck } from './road';
import { STOP_MINUTES } from './routes';
import { plainName } from './headsup';
import { ITEM_LIST } from './morning';
import type { Message, Order, Rush, Truck } from './types';
import type { RunState } from './run';

/** The share of mornings, after the first, on which a client rings for a rush order. */
export const RUSH_CHANCE = 0.22;
/** The phone rings between 08:30 and 09:30, on a quarter hour. */
const RING_FROM = 8 * 60 + 30;
const RING_SLOTS = 5;
/** The client wants it by a time half an hour after the ring, or up to two quarter hours more. */
const BEFORE_AFTER = 30;
const BEFORE_STEPS = 3;
/** A rush is for this share of the item's usual amount for a day, from the least to the most. */
const SHARE_FROM = 0.12;
const SHARE_TO = 0.25;
/** Only an item that earns at least this much a unit is rung about, so that a rush is worth a truck. */
const WORTH_UNIT = 7;
/** A rush is worth at least this much at the usual price, so the premium on top pays for a trip. */
const WORTH_LEAST = 60;
const QTY_LEAST = 3;
/** The crew takes this long to load a truck for the rush. */
export const RUSH_LOAD_MINUTES = 10;
/** The note about it comes in with the other overnight notes, at 04:20. */
const NOTE_AT = 24 * 60 + 4 * 60 + 20;
/** Keeps the rush's chances apart from the ones the morning is made of, so that neither shifts the other. */
const SALT = 0x2c1b3c6d;

/** What the client says to explain the rush. */
export const RUSH_REASONS: readonly string[] = [
  'A coach party has just booked',
  'A big group walked in without booking',
  'A wedding party has doubled its numbers',
  'A tour bus has pulled up outside',
];

/**
 * Whether a client rings this morning for a rush order, and for what. On about one morning in four or five, one client of
 * the run asks for extra of a valuable item, by a time an hour or two after the ring. `random` is taken from the morning's
 * own seed, so the same seed always gives the same rush.
 */
export function rushFor(run: RunState, orders: readonly Order[], random: Random): Rush | undefined {
  const rolls = mulberry32((Math.floor(random() * 4294967296) ^ SALT) >>> 0);
  const roll = rolls();
  const who = below(rolls, orders.length);
  const items = ITEM_LIST.filter((i) => clientPrice(i.id) >= WORTH_UNIT);
  const item = items[below(rolls, items.length)] ?? ITEM_LIST[0]!;
  const share = SHARE_FROM + rolls() * (SHARE_TO - SHARE_FROM);
  const at = RING_FROM + 15 * below(rolls, RING_SLOTS);
  const before = at + BEFORE_AFTER + 15 * below(rolls, BEFORE_STEPS);
  const why = below(rolls, RUSH_REASONS.length);
  const order = orders[who];
  if (roll >= RUSH_CHANCE || !order) return undefined;
  // Never more than the smallest truck can carry.
  const most = Math.floor(Math.min(...run.trucks.map((t) => t.capacity)) / item.size);
  const least = Math.max(QTY_LEAST, Math.ceil(WORTH_LEAST / clientPrice(item.id)));
  const qty = Math.min(most, Math.max(least, Math.round((run.usual[item.id] ?? 0) * share)));
  return { client: order.client, orderIndex: who, item: item.id, qty, at, before, why };
}

/** The overnight note that warns the rush may come: who may ring, for what and how much, and what to do about it. */
export function rushNote(rush: Rush, from: string): Message {
  const name = plainName(ITEM_LIST.find((i) => i.id === rush.item)?.name ?? rush.item);
  return {
    kind: 'staff',
    from,
    text: `${rush.client} may ring this morning for a rush: about ${rush.qty} ${name}, wanted within a couple of hours. Keep some back, and a truck free.`,
    at: NOTE_AT,
  };
}

/** One truck taking the rush: when it leaves, reaches the client and is home, what it pays and what it costs. */
export interface RushTrip {
  client: string;
  place: PlaceId;
  item: string;
  qty: number;
  before: number;
  truckId: number;
  driver: string;
  /** True when the truck had already been out this morning, so its driver is paid for already. */
  wentOut: boolean;
  leaveAt: number;
  arriveAt: number;
  backAt: number;
  /** Squares of the map the trip drives, out and back. */
  squares: number;
  /** True when the truck reaches the client after the time asked for. */
  late: boolean;
  paid: number;
  /** What coming late took off the full price. */
  cut: number;
  /** What the trip adds to what the trucks cost. */
  cost: number;
}

/**
 * What each truck would do with the rush if it were rung at `at`: it is loaded and leaves as soon as it is home (a truck still
 * out finishes its round first, one in the yard goes at once), and drives from the depot to the client and back.
 */
export function rushTrips(trucks: readonly Truck[], result: MorningResult, rush: Rush, place: PlaceId, at: number): RushTrip[] {
  const squares = 2 * travelSquares(DEPOT, place);
  return trucks.map((t) => {
    const home = result.trucks.find((x) => x.truckId === t.id)?.backAt ?? null;
    const wentOut = home != null;
    const leaveAt = Math.max(at, home ?? at) + RUSH_LOAD_MINUTES;
    const arriveAt = leaveAt + travelMinutes(DEPOT, place);
    const late = arriveAt > rush.before;
    const { paid, cut } = rushPay(rush.item, rush.qty, late);
    return {
      client: rush.client,
      place,
      item: rush.item,
      qty: rush.qty,
      before: rush.before,
      truckId: t.id,
      driver: t.driver,
      wentOut,
      leaveAt,
      arriveAt,
      backAt: arriveAt + STOP_MINUTES + travelMinutes(place, DEPOT),
      squares,
      late,
      paid,
      cut,
      cost: rushTripCost(squares, wentOut),
    };
  });
}

/**
 * The trips worth offering on the phone: the truck that gets there first, and the cheapest one that gets there in time
 * when that is another. A rush no truck can make in time is offered with the truck that comes nearest.
 */
export function offered(trips: readonly RushTrip[]): RushTrip[] {
  const earliest = trips.slice().sort((a, b) => a.arriveAt - b.arriveAt || a.cost - b.cost || a.truckId - b.truckId)[0];
  const cheapest = trips
    .filter((t) => !t.late)
    .sort((a, b) => a.cost - b.cost || a.arriveAt - b.arriveAt || a.truckId - b.truckId)[0];
  return [earliest, cheapest].filter((t, i, all): t is RushTrip => t != null && all.indexOf(t) === i);
}

/** The trip the player's answer sent for the rush, from the calls and what was answered; null when no rush rang or it was turned down. */
export function sentFor(calls: readonly Call[], answers: ReadonlyMap<number, number>): RushTrip | null {
  const call = calls.find((c) => c.kind === 'rush' && answers.has(c.id));
  return call?.options[answers.get(call.id) as number]?.rush ?? null;
}

/** The result with the rush trip on it: the truck is out longer, drives further and has the client's place among its own. */
export function withRush(result: MorningResult, trip: RushTrip | null): MorningResult {
  if (!trip || result.rush) return result;
  const trucks = result.trucks.map((t) =>
    t.truckId !== trip.truckId
      ? t
      : {
          ...t,
          places: t.places.includes(trip.place) ? t.places : [...t.places, trip.place],
          stops: t.stops + 1,
          backAt: trip.backAt,
          squares: t.squares + trip.squares,
        },
  );
  const backs = trucks.map((t) => t.backAt).filter((b): b is number => b != null);
  return { ...result, trucks, lastBack: backs.length ? Math.max(...backs) : null, rush: trip };
}

/** The road with the rush trip on it: the truck leaves the depot again, delivers to the client and comes back. */
export function addRush(road: Road, trip: RushTrip): Road {
  const added: RoadEvent[] = [
    { at: trip.leaveAt, truckId: trip.truckId, kind: 'leave', places: [trip.place], stops: 1 },
    { at: trip.arriveAt, truckId: trip.truckId, kind: 'rush', client: trip.client, place: trip.place, units: trip.qty },
    { at: trip.backAt, truckId: trip.truckId, kind: 'back' },
  ];
  const rank = (e: RoadEvent) => (e.kind === 'leave' ? 0 : e.kind === 'back' ? 2 : 1);
  const events = [...road.events, ...added]
    .map((event, seq) => ({ event, seq }))
    .sort((a, b) => a.event.at - b.event.at || rank(a.event) - rank(b.event) || a.seq - b.seq)
    .map((e) => e.event);
  const stop = { arriveAt: trip.arriveAt, place: trip.place };
  const known = road.trucks.some((t) => t.truckId === trip.truckId);
  const trucks: RoadTruck[] = known
    ? road.trucks.map((t) => (t.truckId === trip.truckId ? { ...t, stops: [...t.stops, stop], backAt: trip.backAt } : t))
    : [...road.trucks, { truckId: trip.truckId, driver: trip.driver, stops: [stop], backAt: trip.backAt }].sort((a, b) => a.truckId - b.truckId);
  return { ...road, events, trucks, end: Math.max(road.end, trip.backAt) };
}

/** "rush: 6 frozen chips", for a call's topic. */
export function rushTopic(rush: Rush, itemName: string): string {
  return `rush: ${rush.qty} ${plainName(itemName)}`;
}
