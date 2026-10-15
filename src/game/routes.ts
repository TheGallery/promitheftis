import { DEPOT, placeIndex, travelMinutes, travelSquares, type PlaceId } from './places';

/** Minutes spent at each client: unloading, a signature, a word. */
export const STOP_MINUTES = 25;

export interface Stop {
  orderId: number;
  place: PlaceId;
}

export interface VisitedStop {
  orderId: number;
  /** When the truck reaches this client. */
  arriveAt: number;
}

export interface Visit {
  place: PlaceId;
  arriveAt: number;
  stops: VisitedStop[];
}

export interface RoutePlan {
  /** Places in the order the truck drives to them. */
  visits: Visit[];
  /** When the truck is back at the depot. */
  backAt: number;
  /** Squares of the map driven, out from the depot through every place and back. */
  squares: number;
}

/**
 * The shortest drive from the depot through every place and back, found by
 * trying every subset (there are at most nine squares). Ties go to the
 * place that comes first on the map so the answer is always the same.
 */
function bestOrder(places: PlaceId[]): PlaceId[] {
  const n = places.length;
  if (n <= 1) return places.slice();
  const full = (1 << n) - 1;
  const cost: number[][] = Array.from({ length: 1 << n }, () => new Array<number>(n).fill(Infinity));
  const from: number[][] = Array.from({ length: 1 << n }, () => new Array<number>(n).fill(-1));
  for (let i = 0; i < n; i++) cost[1 << i]![i] = travelMinutes(DEPOT, places[i] as PlaceId);
  for (let mask = 1; mask <= full; mask++) {
    for (let last = 0; last < n; last++) {
      const here = cost[mask]![last] as number;
      if (!(mask & (1 << last)) || here === Infinity) continue;
      for (let next = 0; next < n; next++) {
        if (mask & (1 << next)) continue;
        const nm = mask | (1 << next);
        const c = here + travelMinutes(places[last] as PlaceId, places[next] as PlaceId);
        if (c < (cost[nm]![next] as number)) {
          cost[nm]![next] = c;
          from[nm]![next] = last;
        }
      }
    }
  }
  let end = 0;
  let endCost = Infinity;
  for (let last = 0; last < n; last++) {
    const c = (cost[full]![last] as number) + travelMinutes(places[last] as PlaceId, DEPOT);
    if (c < endCost) {
      endCost = c;
      end = last;
    }
  }
  const order: PlaceId[] = [];
  let mask = full;
  let at = end;
  while (at !== -1) {
    order.push(places[at] as PlaceId);
    const prev = from[mask]![at] as number;
    mask &= ~(1 << at);
    at = prev;
  }
  order.reverse();
  // Driving the loop either way round takes as long: go the way that starts earlier on the map.
  const first = order[0] as PlaceId;
  const last = order[order.length - 1] as PlaceId;
  return placeIndex(first) > placeIndex(last) ? order.reverse() : order;
}

/** Plans one truck's drive: out from the depot, every stop, and home again. */
export function planRoute(stops: readonly Stop[], departAt: number): RoutePlan {
  const places = [...new Set(stops.map((s) => s.place))].sort((a, b) => placeIndex(a) - placeIndex(b));
  if (places.length === 0) return { visits: [], backAt: departAt, squares: 0 };
  let now = departAt;
  let here: PlaceId = DEPOT;
  let squares = 0;
  const visits: Visit[] = [];
  for (const p of bestOrder(places)) {
    now += travelMinutes(here, p);
    squares += travelSquares(here, p);
    const visit: Visit = { place: p, arriveAt: now, stops: [] };
    for (const s of stops) {
      if (s.place !== p) continue;
      visit.stops.push({ orderId: s.orderId, arriveAt: now });
      now += STOP_MINUTES;
    }
    visits.push(visit);
    here = p;
  }
  now += travelMinutes(here, DEPOT);
  squares += travelSquares(here, DEPOT);
  return { visits, backAt: now, squares };
}
