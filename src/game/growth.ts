import { clientWeight, distanceFromDepot, shapeText, type NewClient } from './clients';
import type { DayRoom, DaySummary } from './day';
import { TRUCK_SHARE } from './generate';
import { canAfford, formatMoney, growthPrice, PRICES, truckPrice } from './money';
import { newTruck, type RunClient } from './run';
import { ROOM_GROWTH } from './rooms';
import type { Kept, Truck } from './types';

/**
 * What the player chose to grow at the end of the day. Today is not changed by it:
 * the next morning (see `run.ts`) puts it to work.
 */
export type Growth =
  | { kind: 'truck' }
  | { kind: 'room'; room: Kept }
  | { kind: 'client'; client: NewClient };

export interface GrowthOption {
  growth: Growth;
  /** Short name of the choice, as listed. */
  title: string;
  /** What it gives and what the day showed about it, a paragraph for each entry. */
  gain: string[];
  /** The extra work it brings, besides what it costs; a clause that follows "The extra work:". */
  work: string;
  /** What it costs, in pounds; a new client is free. */
  price: number;
  /** False when the cash in the bank is less than the price, and the option cannot be picked. */
  affordable: boolean;
}

/** How full the trucks really were: all of them together, the ones that went out and the ones that stayed in the yard. */
export interface Fleet {
  trucks: number;
  out: number;
  /** Trucks that were free to go and stayed in the yard. */
  yard: number;
  /** Trucks that were at the garage, which had no space to give: they are left out of the space and of how full it was. */
  garage: number;
  /** The space of all the trucks together, and the share of it that was loaded, in whole per cent. */
  space: number;
  use: number;
}

/** What the business is made of now, which sets what growing costs and what it would bring. */
export interface Business {
  clients: readonly RunClient[];
  trucks: readonly Truck[];
}

const ROOM_NAME: Record<Kept, string> = { freezer: 'freezer', fridge: 'fridge', dry: 'dry store' };

/** How full the trucks were today. */
export function fleetOf(day: DaySummary): Fleet {
  const free = day.trucks.filter((t) => !t.garage);
  const space = free.reduce((n, t) => n + t.capacity, 0);
  const load = free.reduce((n, t) => n + t.load, 0);
  const out = free.filter((t) => t.backAt != null).length;
  return { trucks: day.trucks.length, out, yard: free.length - out, garage: day.trucks.length - free.length, space, use: space > 0 ? Math.round((load * 100) / space) : 0 };
}

/** The room that will be tightest tomorrow: the one with the most that will spoil, then the fullest; the first listed wins a tie. */
export function tightestRoom(rooms: readonly DayRoom[]): DayRoom {
  return rooms.reduce((best, r) => (r.space.spoils > best.space.spoils || (r.space.spoils === best.space.spoils && r.space.pct > best.space.pct) ? r : best));
}

/** "1 truck", "2 trucks". */
const plural = (n: number, one: string): string => `${n} ${n === 1 ? one : `${one}s`}`;

/** "3,220". */
const grouped = (n: number): string => String(n).replace(/\B(?=(\d{3})+$)/g, ',');

/** Whole per cent of `part` in `whole`; 0 when there is no whole. */
const percent = (part: number, whole: number): number => (whole > 0 ? Math.round((part * 100) / whole) : 0);

/** What the truck option says: the truck that would join, what the day showed about the trucks, and what the next one costs. */
function truckGain(day: DaySummary, business: Business, next: Truck): string[] {
  const fleet = fleetOf(day);
  const owned = day.trucks.reduce((n, t) => n + t.capacity, 0);
  const verb = fleet.trucks === 1 ? 'holds' : 'hold';
  const garage = fleet.garage > 0 ? ` (${fleet.garage} at the garage today)` : '';
  const yard = fleet.yard > 0 ? `, ${fleet.yard} stayed in the yard` : '';
  return [
    `A ${next.kind} with room for ${next.capacity}, on top of the ${grouped(owned)} your ${plural(fleet.trucks, 'truck')} ${verb}${garage}. Orders are planned to fill at most ${Math.round(TRUCK_SHARE * 100)}% of the trucks, ` +
      `so it only helps once yours near that: today they were ${fleet.use}% full${yard}. ` +
      `The next truck after it will cost ${formatMoney(truckPrice(business.clients.length, business.trucks.length + 1))}.`,
  ];
}

/** What the room option says: how much space it adds, and how full the room is and what spoils. */
function roomGain(tight: DayRoom): string[] {
  const spoils = tight.space.spoils > 0 ? `${plural(tight.space.spoils, 'unit')} will spoil` : 'nothing will spoil';
  return [`${ROOM_GROWTH[tight.kept]} more space in the ${ROOM_NAME[tight.kept]} (${tight.space.capacity} now): the tightest room, ${tight.space.pct}% full tomorrow, ${spoils}.`];
}

/** What the client option says: what it is like, and what it would bring in and cost on the road. */
function clientGain(day: DaySummary, business: Business, client: NewClient): string[] {
  const total = clientWeight(business.clients);
  const share = percent(client.shape.size, total + client.shape.size);
  const worth = total > 0 ? Math.round((day.money.takenIn * client.shape.size) / total) : 0;
  const road = distanceFromDepot(client.place) * 2 * PRICES.truckPerSquare;
  const trip = road > 0 ? ` A trip there costs up to ${formatMoney(road)} on the road.` : '';
  return [
    `${shapeText(client)}.`,
    `Contact ${client.contact}. About ${share}% of the orders, worth about ${formatMoney(worth)} a day if the trucks have room.${trip}`,
  ];
}

/**
 * The three things the day can end by growing, in the order they are listed; `client` is the restaurant that asks to
 * join, and `business` is what the business is made of now, which sets what a truck or a room costs.
 */
export function growthOptions(day: DaySummary, client: NewClient, business: Business): GrowthOption[] {
  const tight = tightestRoom(day.rooms);
  const next = newTruck(Math.max(0, ...business.trucks.map((t) => t.id)) + 1, business.trucks.map((t) => t.driver));
  const options: Array<Omit<GrowthOption, 'price' | 'affordable'>> = [
    {
      growth: { kind: 'truck' },
      title: 'Another truck',
      gain: truckGain(day, business, next),
      work: 'one more truck to load and send out every morning.',
    },
    {
      growth: { kind: 'room', room: tight.kept },
      title: `A bigger ${ROOM_NAME[tight.kept]}`,
      gain: roomGain(tight),
      work: 'more stock to order and keep track of.',
    },
    {
      growth: { kind: 'client', client },
      title: `A new client: ${client.name}`,
      gain: clientGain(day, business, client),
      work: 'more orders to hand out, and more to juggle between the trucks.',
    },
  ];
  return options.map((o) => {
    const price = growthPrice(o.growth, business.clients.length, business.trucks.length);
    return { ...o, price, affordable: canAfford(day.money.cash, price) };
  });
}
