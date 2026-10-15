import type { Growth } from './growth';
import type { Kept } from './types';

/** What the supplier charges for one unit of an item, and what a restaurant pays for one that arrives. */
interface ItemPrice {
  supplier: number;
  client: number;
}

interface Prices {
  startingCash: number;
  /** The price of every item, by item id. */
  items: Record<string, ItemPrice>;
  truckDriver: number;
  truckPerSquare: number;
  truckPerTruck: number;
  truckPerClient: number;
  roomPerClient: number;
}

/**
 * Every price in the game, in whole pounds. Change a number here to tune how the money plays; nothing else
 * in the game holds a price.
 */
export const PRICES: Prices = {
  /** The cash in the bank when a run begins. */
  startingCash: 1000,
  /**
   * What the supplier charges for one unit of each item, and what a restaurant pays for one that arrives, whichever
   * restaurant it is. The freezer is dearest and the dry store cheapest, but the items in a room differ: pork
   * shoulder costs more than eggs, and chips more than peas.
   */
  items: {
    chips: { supplier: 15, client: 20 },
    peas: { supplier: 11, client: 15 },
    pork: { supplier: 11, client: 15 },
    mozzarella: { supplier: 9, client: 12 },
    eggs: { supplier: 5, client: 7 },
    oil: { supplier: 5, client: 7 },
    potatoes: { supplier: 4, client: 5 },
    flour: { supplier: 4, client: 5 },
    rice: { supplier: 4, client: 5 },
    gravy: { supplier: 2, client: 4 },
    ketchup: { supplier: 2, client: 4 },
    tomatoes: { supplier: 1, client: 2 },
  },
  /** The driver for one truck that goes out for the day; a truck that stays in the yard costs nothing. */
  truckDriver: 30,
  /** The fuel and wear for each square a truck travels on the island map, out and back. */
  truckPerSquare: 12,
  /**
   * Another truck costs a sum for each truck the business has and a sum for each client it serves, so that each truck
   * costs more than the one before, and a fleet bigger than its clients need is dearer still.
   */
  truckPerTruck: 140,
  truckPerClient: 30,
  /**
   * A bigger room costs a sum for each client the business serves: the bigger the business, the more it costs to
   * grow it, so that it takes about the same number of good days whichever morning the run began with.
   */
  roomPerClient: 75,
};

/** The share of an order's price a client pays when the truck reached them after the time they asked for. */
export const LATE_PAYS = 0.5;

/** The cash a run starts with. */
export const STARTING_CASH = PRICES.startingCash;

/** Most cash, or debt, a saved run may hold. */
export const MOST_CASH = 1e9;

/** A line of what was handed over, or ordered: how many units of an item, and the room it is kept in. */
export interface Units {
  item: string;
  kept: Kept;
  units: number;
}

/** A truck that went out: how far it drove, in squares of the island map, out and back. */
export interface Trip {
  truckId: number;
  driver: string;
  squares: number;
}

/** What a trip cost. */
export interface TripCost extends Trip {
  cost: number;
}

/** The rooms' share of the supplier order. */
export type RoomCosts = Record<Kept, number>;

/** How a day's money worked out. */
export interface DayMoney {
  /** What the restaurants paid for what arrived, with half taken off each order that came after the time asked. */
  takenIn: number;
  /** What those late orders paid less than they would have on time. */
  lateCut: number;
  /** What the supplier order costs, and the share of it for each room. */
  supplier: number;
  supplierRooms: RoomCosts;
  /** The trucks that went out, with each one's distance and cost, and what they cost together. */
  trucksOut: number;
  squares: number;
  truckTrips: TripCost[];
  trucks: number;
  /** Taken in less everything paid out; below zero on a bad day. */
  total: number;
  /** The cash in the bank before the day. */
  before: number;
  /** The cash in the bank once the day is settled, before any growth is paid for. */
  cash: number;
}

/** What the supplier charges for one unit of an item. */
export function supplierPrice(item: string): number {
  return priceOf(item).supplier;
}

/** What a restaurant pays for one unit of an item that arrives. */
export function clientPrice(item: string): number {
  return priceOf(item).client;
}

function priceOf(item: string): ItemPrice {
  const price = PRICES.items[item];
  if (!price) throw new Error(`no price for ${item}`);
  return price;
}

const sum = (lines: readonly Units[], price: (item: string) => number): number =>
  lines.reduce((total, l) => total + l.units * price(l.item), 0);

/** What the restaurants pay for the units that arrived, whenever they came: a short delivery pays less. */
export function takenIn(delivered: readonly Units[]): number {
  return sum(delivered, clientPrice);
}

/** What one order pays: the price of what arrived, and half of it if the truck came after the time the client asked for. */
export function orderPay(delivered: readonly Units[], late: boolean): { paid: number; cut: number } {
  const full = takenIn(delivered);
  const paid = late ? Math.round(full * LATE_PAYS) : full;
  return { paid, cut: full - paid };
}

/** What the supplier order costs. */
export function supplierCost(ordered: readonly Units[]): number {
  return sum(ordered, supplierPrice);
}

/** The share of the supplier order for each room. */
export function supplierRooms(ordered: readonly Units[]): RoomCosts {
  const rooms: RoomCosts = { freezer: 0, fridge: 0, dry: 0 };
  for (const l of ordered) rooms[l.kept] += l.units * supplierPrice(l.item);
  return rooms;
}

/** What one truck that goes out costs for a day: the driver, and the road by the squares it travels. A truck that stays in the yard costs nothing. */
export function truckCost(squares: number): number {
  return PRICES.truckDriver + squares * PRICES.truckPerSquare;
}

/** What each truck that went out cost, from how far it drove. */
export function tripCosts(trips: readonly Trip[]): TripCost[] {
  return trips.map((t) => ({ ...t, cost: truckCost(t.squares) }));
}

/**
 * The money of one day: what came in, what went out, and where that leaves the cash. `lateCut` is what the orders that
 * came after the time asked paid less, and is taken off what the units that arrived are worth.
 */
export function dayMoney(before: number, delivered: readonly Units[], ordered: readonly Units[], trips: readonly Trip[], lateCut = 0): DayMoney {
  const income = takenIn(delivered) - lateCut;
  const supplier = supplierCost(ordered);
  const truckTrips = tripCosts(trips);
  const trucks = truckTrips.reduce((total, t) => total + t.cost, 0);
  const total = income - supplier - trucks;
  return {
    takenIn: income,
    lateCut,
    supplier,
    supplierRooms: supplierRooms(ordered),
    trucksOut: truckTrips.length,
    squares: truckTrips.reduce((n, t) => n + t.squares, 0),
    truckTrips,
    trucks,
    total,
    before,
    cash: before + total,
  };
}

/** What another truck costs when the business serves `clients` restaurants with `trucks` trucks. */
export function truckPrice(clients: number, trucks: number): number {
  return trucks * PRICES.truckPerTruck + clients * PRICES.truckPerClient;
}

/** What growing costs when the business serves `clients` restaurants with `trucks` trucks; a new client is free. */
export function growthPrice(growth: Growth, clients: number, trucks: number): number {
  switch (growth.kind) {
    case 'truck':
      return truckPrice(clients, trucks);
    case 'room':
      return clients * PRICES.roomPerClient;
    case 'client':
      return 0;
  }
}

/** Whether `cash` covers `price`. Cash may be below zero, and then only what is free can be had. */
export function canAfford(cash: number, price: number): boolean {
  return price <= 0 || cash >= price;
}

/** How far below zero paying `cost` leaves the cash in the bank; zero when the cash covers it. */
export function shortBy(cash: number, cost: number): number {
  return Math.max(0, cost - cash);
}

/** "£1,250" and "-£120". */
export function formatMoney(amount: number): string {
  const digits = String(Math.abs(Math.trunc(amount))).replace(/\B(?=(\d{3})+$)/g, ',');
  return `${amount < 0 ? '-' : ''}£${digits}`;
}

/** Like `formatMoney`, but with a "+" for a gain: "+£340" and "-£60". */
export function formatChange(amount: number): string {
  return amount > 0 ? `+${formatMoney(amount)}` : formatMoney(amount);
}
