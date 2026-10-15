import type { Desk } from './desk';
import type { PlaceId } from './places';

export interface TruckResult {
  truckId: number;
  driver: string;
  places: PlaceId[];
  stops: number;
  fullness: number;
  /** The space the truck is loaded with, and the space it has. */
  load: number;
  capacity: number;
  departAt: number;
  backAt: number | null;
  /** Squares of the map the truck drives; none for a truck that stays in the yard. */
  squares: number;
  /** True for the truck that was at the garage all day. */
  garage: boolean;
}

export interface ShortLine {
  item: string;
  asked: number;
  given: number;
}

/** What an order was given on one line, whatever it came to. */
export interface GivenLine {
  item: string;
  units: number;
}

export interface OrderResult {
  orderIndex: number;
  client: string;
  place: PlaceId;
  truckId: number | null;
  /** The share of the order's lines that were delivered, 0 to 100. */
  percent: number;
  shortLines: ShortLine[];
  /** What each line of the order came to; nothing for an order with no truck. */
  delivered: GivenLine[];
  /** When the truck gets to this client; null if nothing was delivered. */
  arriveAt: number | null;
  before: number | null;
  /** True when the client asked for a time and the truck came after it. */
  lateForAsk: boolean;
}

export interface MorningResult {
  departAt: number;
  trucks: TruckResult[];
  orders: OrderResult[];
  /** Orders that got less than they asked for, the smallest share first. */
  gotLess: OrderResult[];
  inFull: number;
  lastBack: number | null;
}

/**
 * What happened once the trucks left. Each line counts the same: an order's
 * share is the average of given/asked over its lines. An order with no truck
 * delivers nothing.
 */
export function buildResult(desk: Desk, departAt: number): MorningResult {
  const trucks: TruckResult[] = desk.morning.trucks.map((t) => {
    const stops = desk.stopsOf(t.id);
    const route = desk.routeOf(t.id, departAt);
    return {
      truckId: t.id,
      driver: t.driver,
      places: route.visits.map((v) => v.place),
      stops: stops.length,
      fullness: desk.fullness(t.id),
      load: desk.load(t.id),
      capacity: t.capacity,
      departAt,
      backAt: stops.length === 0 ? null : route.backAt,
      squares: stops.length === 0 ? 0 : route.squares,
      garage: desk.inGarage(t.id),
    };
  });

  const arrivals = new Map<number, number>();
  for (const t of desk.morning.trucks) {
    for (const v of desk.routeOf(t.id, departAt).visits) for (const s of v.stops) arrivals.set(s.orderId, s.arriveAt);
  }

  const orders: OrderResult[] = desk.morning.orders.map((order, o) => {
    const truckId = desk.truckFor(o);
    const shipped = truckId != null;
    const shortLines: ShortLine[] = [];
    const delivered: GivenLine[] = [];
    let share = 0;
    order.lines.forEach((line, l) => {
      const given = shipped ? (desk.given(o, l) ?? 0) : 0;
      delivered.push({ item: line.item, units: given });
      share += line.asked === 0 ? 1 : given / line.asked;
      if (given < line.asked) shortLines.push({ item: line.item, asked: line.asked, given });
    });
    const arriveAt = shipped ? (arrivals.get(o) ?? null) : null;
    const before = order.before ?? null;
    return {
      orderIndex: o,
      client: order.client,
      place: order.place,
      truckId,
      percent: Math.round((share / order.lines.length) * 100),
      shortLines,
      delivered,
      arriveAt,
      before,
      lateForAsk: before != null && arriveAt != null && arriveAt > before,
    };
  });

  const backs = trucks.map((t) => t.backAt).filter((b): b is number => b != null);
  return {
    departAt,
    trucks,
    orders,
    gotLess: orders.filter((r) => r.percent < 100).sort((a, b) => a.percent - b.percent),
    inFull: orders.filter((r) => r.percent === 100).length,
    lastBack: backs.length ? Math.max(...backs) : null,
  };
}
