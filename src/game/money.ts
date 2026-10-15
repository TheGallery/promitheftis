import type { Growth } from './growth';
import type { Kept } from './types';

interface Prices {
  startingCash: number;
  supplierPerUnit: Record<Kept, number>;
  clientPerUnit: Record<Kept, number>;
  truckPerDay: number;
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
  /** What the supplier charges for one unit, by where it is kept: the freezer costs most, the dry store least. */
  supplierPerUnit: { freezer: 10, fridge: 6, dry: 2 },
  /** What a restaurant pays for one unit that arrives, whichever restaurant it is. */
  clientPerUnit: { freezer: 17, fridge: 10, dry: 4 },
  /** The driver and the fuel for one truck that goes out for the day; a truck that stays in the yard costs nothing. */
  truckPerDay: 30,
  /**
   * Another truck, and a bigger room, for each client the business serves: the bigger the business, the more it
   * costs to grow it, so that either takes about the same number of good days whichever morning the run began with.
   */
  truckPerClient: 90,
  roomPerClient: 90,
};

/** The cash a run starts with. */
export const STARTING_CASH = PRICES.startingCash;

/** Most cash, or debt, a saved run may hold. */
export const MOST_CASH = 1e9;

/** A line of what was handed over, or ordered: how many units of something kept in one of the rooms. */
export interface Units {
  kept: Kept;
  units: number;
}

/** How a day's money worked out. */
export interface DayMoney {
  /** What the restaurants paid for what arrived. */
  takenIn: number;
  /** What the supplier order costs. */
  supplier: number;
  /** The trucks that went out, and what they cost. */
  trucksOut: number;
  trucks: number;
  /** Taken in less everything paid out; below zero on a bad day. */
  total: number;
  /** The cash in the bank before the day. */
  before: number;
  /** The cash in the bank once the day is settled, before any growth is paid for. */
  cash: number;
}

const sum = (lines: readonly Units[], price: Record<Kept, number>): number =>
  lines.reduce((total, l) => total + l.units * price[l.kept], 0);

/** What the restaurants pay for the units that arrived: a short delivery pays less, a late one pays the same. */
export function takenIn(delivered: readonly Units[]): number {
  return sum(delivered, PRICES.clientPerUnit);
}

/** What the supplier order costs. */
export function supplierCost(ordered: readonly Units[]): number {
  return sum(ordered, PRICES.supplierPerUnit);
}

/** What the trucks that went out cost for the day. */
export function truckCost(trucksOut: number): number {
  return trucksOut * PRICES.truckPerDay;
}

/** The money of one day: what came in, what went out, and where that leaves the cash. */
export function dayMoney(before: number, delivered: readonly Units[], ordered: readonly Units[], trucksOut: number): DayMoney {
  const income = takenIn(delivered);
  const supplier = supplierCost(ordered);
  const trucks = truckCost(trucksOut);
  const total = income - supplier - trucks;
  return { takenIn: income, supplier, trucksOut, trucks, total, before, cash: before + total };
}

/** What growing costs when the business serves `clients` restaurants; a new client is free. */
export function growthPrice(growth: Growth, clients: number): number {
  switch (growth.kind) {
    case 'truck':
      return clients * PRICES.truckPerClient;
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

/** "£1,250" and "-£120". */
export function formatMoney(amount: number): string {
  const digits = String(Math.abs(Math.trunc(amount))).replace(/\B(?=(\d{3})+$)/g, ',');
  return `${amount < 0 ? '-' : ''}£${digits}`;
}

/** Like `formatMoney`, but with a "+" for a gain: "+£340" and "-£60". */
export function formatChange(amount: number): string {
  return amount > 0 ? `+${formatMoney(amount)}` : formatMoney(amount);
}
