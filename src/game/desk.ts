import { DEPART_MINUTE, MINUTES_PER_ACTION, START_MINUTE } from './clock';
import type { PlaceId } from './places';
import { planRoute, type RoutePlan } from './routes';
import type { Item, Morning, Order } from './types';

export type AssignResult = { ok: true } | { ok: false; reason: 'no-such-truck' | 'garage' | 'full' };

/**
 * The order desk: what has been given on every line, which truck each order
 * rides on, which orders are finished, and the clock. Indexes are positions in
 * `morning.orders` and in each order's `lines`.
 */
export class Desk {
  readonly morning: Morning;
  /** Minutes since midnight. */
  clock = START_MINUTE;
  private readonly gives: Array<Array<number | null>>;
  private readonly truckOf: Array<number | null>;
  private readonly finished: boolean[];
  private readonly items: Map<string, Item>;

  constructor(morning: Morning) {
    this.morning = morning;
    this.gives = morning.orders.map((o) => o.lines.map(() => null));
    this.truckOf = morning.orders.map(() => null);
    this.finished = morning.orders.map(() => false);
    this.items = new Map(morning.items.map((i) => [i.id, i]));
  }

  get orderCount(): number {
    return this.morning.orders.length;
  }

  order(o: number): Order {
    const order = this.morning.orders[o];
    if (!order) throw new Error(`no order ${o}`);
    return order;
  }

  item(id: string): Item {
    const item = this.items.get(id);
    if (!item) throw new Error(`no item ${id}`);
    return item;
  }

  /** What has been given on a line, or null if it has not been decided yet. */
  given(o: number, l: number): number | null {
    return this.gives[o]?.[l] ?? null;
  }

  truckFor(o: number): number | null {
    return this.truckOf[o] ?? null;
  }

  isFinished(o: number): boolean {
    return this.finished[o] ?? false;
  }

  /** Stock left for a line: the stock, less everything given on other lines. */
  onHand(o: number, l: number): number {
    const itemId = this.order(o).lines[l]?.item;
    if (!itemId) return 0;
    let left = this.morning.stock[itemId] ?? 0;
    this.morning.orders.forEach((order, oi) => {
      order.lines.forEach((line, li) => {
        if (line.item === itemId && !(oi === o && li === l)) left -= this.gives[oi]?.[li] ?? 0;
      });
    });
    return Math.max(0, left);
  }

  /** Truck space taken by what has been given on an order. */
  orderSpace(o: number): number {
    return this.order(o).lines.reduce((sum, line, l) => sum + (this.given(o, l) ?? 0) * this.item(line.item).size, 0);
  }

  /** Truck space in use. */
  load(truckId: number): number {
    let total = 0;
    for (let o = 0; o < this.orderCount; o++) if (this.truckOf[o] === truckId) total += this.orderSpace(o);
    return total;
  }

  /** True for the truck that is at the garage today. */
  inGarage(truckId: number): boolean {
    return this.morning.garage?.truckId === truckId;
  }

  capacity(truckId: number): number {
    return this.morning.trucks.find((t) => t.id === truckId)?.capacity ?? 0;
  }

  /** How full a truck is, from 0 to 1. */
  fullness(truckId: number): number {
    const cap = this.capacity(truckId);
    return cap === 0 ? 0 : Math.min(1, this.load(truckId) / cap);
  }

  /** The most that can be given on a line: what was asked, what is in stock, what the truck can still carry. */
  maxGive(o: number, l: number): number {
    const line = this.order(o).lines[l];
    if (!line) return 0;
    let max = Math.min(line.asked, this.onHand(o, l));
    const truck = this.truckOf[o];
    if (truck != null) {
      const own = (this.given(o, l) ?? 0) * this.item(line.item).size;
      const room = this.capacity(truck) - (this.load(truck) - own);
      max = Math.min(max, Math.floor(room / this.item(line.item).size));
    }
    return Math.max(0, max);
  }

  /** Sets what to give on a line, kept between 0 and the most that is possible. Returns the value used. */
  setGive(o: number, l: number, amount: number): number {
    const value = Math.max(0, Math.min(Math.trunc(amount), this.maxGive(o, l)));
    const row = this.gives[o];
    if (row) row[l] = value;
    return value;
  }

  /** One more or one less; an undecided line starts from the most that is possible. */
  nudgeGive(o: number, l: number, delta: number): number {
    const base = this.given(o, l) ?? this.maxGive(o, l);
    return this.setGive(o, l, base + delta);
  }

  /** Gives as much as possible on a line that has not been decided. Returns the value on the line. */
  acceptLine(o: number, l: number): number {
    return this.given(o, l) ?? this.setGive(o, l, this.maxGive(o, l));
  }

  /** Puts an order on a truck if its lines fit. Choosing a truck takes a minute. */
  assignTruck(o: number, truckId: number): AssignResult {
    if (!this.morning.trucks.some((t) => t.id === truckId)) return { ok: false, reason: 'no-such-truck' };
    if (this.inGarage(truckId)) return { ok: false, reason: 'garage' };
    const others = this.load(truckId) - (this.truckOf[o] === truckId ? this.orderSpace(o) : 0);
    if (this.orderSpace(o) > this.capacity(truckId) - others) return { ok: false, reason: 'full' };
    this.truckOf[o] = truckId;
    this.clock += MINUTES_PER_ACTION;
    return { ok: true };
  }

  allLinesDecided(o: number): boolean {
    return this.order(o).lines.every((_, l) => this.given(o, l) != null);
  }

  /** An order is ready to finish once every line is decided and it has a truck. */
  isComplete(o: number): boolean {
    return this.truckOf[o] != null && this.allLinesDecided(o);
  }

  /** Finishes a complete order. The first time, that takes a minute. */
  finishOrder(o: number): boolean {
    if (!this.isComplete(o)) return false;
    if (!this.finished[o]) {
      this.finished[o] = true;
      this.clock += MINUTES_PER_ACTION;
    }
    return true;
  }

  unfinishedCount(): number {
    return this.finished.filter((f) => !f).length;
  }

  /** The next order after `from` that is not finished, wrapping round; -1 if all are finished. */
  nextUnfinished(from: number): number {
    const n = this.orderCount;
    for (let step = 1; step <= n; step++) {
      const o = (from + step) % n;
      if (!this.finished[o]) return o;
    }
    return -1;
  }

  /** Index of the first line not yet decided, or 0 if all are. */
  firstUndecidedLine(o: number): number {
    const l = this.order(o).lines.findIndex((_, i) => this.given(o, i) == null);
    return l === -1 ? 0 : l;
  }

  /** Orders (by index) that ride on a truck. */
  ordersOn(truckId: number): number[] {
    const out: number[] = [];
    for (let o = 0; o < this.orderCount; o++) if (this.truckOf[o] === truckId) out.push(o);
    return out;
  }

  /** Total units given on an order. */
  unitsGiven(o: number): number {
    return this.order(o).lines.reduce((sum, _, l) => sum + (this.given(o, l) ?? 0), 0);
  }

  /**
   * The places a truck goes to. While working at the desk this counts every
   * order put on the truck; the sheets and the result count only orders with
   * something to deliver.
   */
  placesOf(truckId: number, onlyDelivering = false): PlaceId[] {
    const seen: PlaceId[] = [];
    for (const o of this.ordersOn(truckId)) {
      if (onlyDelivering && this.unitsGiven(o) === 0) continue;
      const p = this.order(o).place;
      if (!seen.includes(p)) seen.push(p);
    }
    return seen;
  }

  /** Orders with something to deliver on a truck: its stops. */
  stopsOf(truckId: number): number[] {
    return this.ordersOn(truckId).filter((o) => this.unitsGiven(o) > 0);
  }

  /**
   * When the trucks will leave if every order still to do takes the minutes it needs: at 07:00, or later if the clock
   * will have passed it by then. An order with a truck only needs finishing; one without also needs a truck.
   */
  projectedDeparture(): number {
    let actions = 0;
    for (let o = 0; o < this.orderCount; o++) if (!this.finished[o]) actions += (this.truckOf[o] == null ? 2 : 1);
    return Math.max(DEPART_MINUTE, this.clock + actions * MINUTES_PER_ACTION);
  }

  /**
   * When order `o` would be reached if it rode on `truckId` and the trucks left at `departAt`, the other orders on that
   * truck being as they stand; null if the order would deliver nothing (it is finished with nothing given).
   */
  arrivalOn(o: number, truckId: number, departAt: number): number | null {
    if (this.finished[o] && this.unitsGiven(o) === 0) return null;
    const riders = this.ordersOn(truckId).filter((i) => i !== o && this.unitsGiven(i) > 0);
    const stops = [...riders, o].sort((a, b) => a - b).map((i) => ({ orderId: i, place: this.order(i).place }));
    for (const visit of planRoute(stops, departAt).visits) {
      const stop = visit.stops.find((s) => s.orderId === o);
      if (stop) return stop.arriveAt;
    }
    return null;
  }

  /** The drive for a truck leaving at `departAt`. */
  routeOf(truckId: number, departAt: number): RoutePlan {
    const stops = this.stopsOf(truckId).map((o) => ({ orderId: o, place: this.order(o).place }));
    return planRoute(stops, departAt);
  }
}
