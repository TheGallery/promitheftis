import { plainName } from './headsup';
import type { PlaceId } from './places';
import type { Desk } from './desk';
import type { MorningResult, ShortLine } from './results';
import { STOP_MINUTES } from './routes';

/** Game minutes the road clock moves on for each tick. */
export const ROAD_STEP_MINUTES = 3;
/** Real milliseconds between ticks: calm, not instant. */
export const ROAD_TICK_MS = 450;

export type RoadEvent =
  | { at: number; truckId: number; kind: 'leave'; places: PlaceId[]; stops: number }
  | { at: number; truckId: number; kind: 'deliver'; orderIndex: number; client: string; place: PlaceId; items: number }
  | { at: number; truckId: number; kind: 'short'; lines: { name: string; given: number; asked: number }[] }
  | { at: number; truckId: number; kind: 'rush'; client: string; place: PlaceId; units: number }
  | { at: number; truckId: number; kind: 'back' };

export interface RoadStop {
  arriveAt: number;
  place: PlaceId;
}

export interface RoadTruck {
  truckId: number;
  driver: string;
  stops: RoadStop[];
  backAt: number;
}

export interface Road {
  departAt: number;
  /** When the last truck is back: the log is complete from then on. */
  end: number;
  /** In the order they happen. */
  events: RoadEvent[];
  /** Only the trucks that left; the others stay in the yard. */
  trucks: RoadTruck[];
}

export type TruckState = { kind: 'out' } | { kind: 'stop'; place: PlaceId } | { kind: 'back'; at: number };

/** The drive from 07:00 on, from the same routes and return times as the result. */
export function buildRoad(desk: Desk, result: MorningResult): Road {
  const trucks: RoadTruck[] = [];
  const found: { event: RoadEvent; seq: number }[] = [];
  let seq = 0;
  const add = (event: RoadEvent) => void found.push({ event, seq: seq++ });

  for (const t of desk.morning.trucks) {
    const tr = result.trucks.find((x) => x.truckId === t.id);
    if (!tr || tr.backAt == null) continue;
    const route = desk.routeOf(t.id, result.departAt);
    const stops: RoadStop[] = [];
    add({ at: result.departAt, truckId: t.id, kind: 'leave', places: route.visits.map((v) => v.place), stops: tr.stops });
    for (const v of route.visits) {
      for (const s of v.stops) {
        const order = result.orders[s.orderId];
        if (!order) continue;
        stops.push({ arriveAt: s.arriveAt, place: v.place });
        add({
          at: s.arriveAt,
          truckId: t.id,
          kind: 'deliver',
          orderIndex: s.orderId,
          client: order.client,
          place: v.place,
          items: desk.unitsGiven(s.orderId),
        });
        if (order.shortLines.length > 0) {
          add({ at: s.arriveAt, truckId: t.id, kind: 'short', lines: order.shortLines.map((l) => shortLine(desk, l)) });
        }
      }
    }
    add({ at: tr.backAt, truckId: t.id, kind: 'back' });
    trucks.push({ truckId: t.id, driver: t.driver, stops, backAt: tr.backAt });
  }

  // Every truck leaves before any delivery at the same minute; a short note keeps its place after its delivery.
  const rank = (e: RoadEvent) => (e.kind === 'leave' ? 0 : e.kind === 'back' ? 2 : 1);
  found.sort((a, b) => a.event.at - b.event.at || rank(a.event) - rank(b.event) || a.seq - b.seq);
  const events = found.map((f) => f.event);
  return { departAt: result.departAt, end: Math.max(result.departAt, ...trucks.map((t) => t.backAt)), events, trucks };
}

function shortLine(desk: Desk, l: ShortLine): { name: string; given: number; asked: number } {
  return { name: plainName(desk.item(l.item).name), given: l.given, asked: l.asked };
}

/** The events that have happened by `clock`. */
export function happened(road: Road, clock: number): RoadEvent[] {
  return road.events.filter((e) => e.at <= clock);
}

/** Where a truck is at `clock`: on the road, unloading at a client, or back at the depot. */
export function truckState(truck: RoadTruck, clock: number): TruckState {
  if (clock >= truck.backAt) return { kind: 'back', at: truck.backAt };
  const unloading = truck.stops.find((s) => clock >= s.arriveAt && clock < s.arriveAt + STOP_MINUTES);
  return unloading ? { kind: 'stop', place: unloading.place } : { kind: 'out' };
}
