/** The nine squares: Town in the middle, eight places around it. */
export type PlaceId =
  | 'oakley'
  | 'hollin'
  | 'rushmere'
  | 'fenwick'
  | 'town'
  | 'docks'
  | 'millford'
  | 'southgate'
  | 'ashby';

export interface Place {
  id: PlaceId;
  name: string;
  /** Three-letter code used when a list of places would not fit. */
  code: string;
  col: number;
  row: number;
}

export const PLACES: readonly Place[] = [
  { id: 'oakley', name: 'Oakley', code: 'OAK', col: 0, row: 0 },
  { id: 'hollin', name: 'Hollin', code: 'HOL', col: 1, row: 0 },
  { id: 'rushmere', name: 'Rushmere', code: 'RUS', col: 2, row: 0 },
  { id: 'fenwick', name: 'Fenwick', code: 'FEN', col: 0, row: 1 },
  { id: 'town', name: 'Town', code: 'TWN', col: 1, row: 1 },
  { id: 'docks', name: 'Docks', code: 'DCK', col: 2, row: 1 },
  { id: 'millford', name: 'Millford', code: 'MIL', col: 0, row: 2 },
  { id: 'southgate', name: 'Southgate', code: 'STH', col: 1, row: 2 },
  { id: 'ashby', name: 'Ashby', code: 'ASH', col: 2, row: 2 },
];

/** The depot is in Town. */
export const DEPOT: PlaceId = 'town';

const BY_ID = new Map<PlaceId, Place>(PLACES.map((p) => [p.id, p]));

export function place(id: PlaceId): Place {
  const p = BY_ID.get(id);
  if (!p) throw new Error(`unknown place ${id}`);
  return p;
}

export function placeIndex(id: PlaceId): number {
  return PLACES.findIndex((p) => p.id === id);
}

/** Squares that touch (sides or corners) are close to each other. */
export function touches(a: PlaceId, b: PlaceId): boolean {
  if (a === b) return false;
  const pa = place(a);
  const pb = place(b);
  return Math.abs(pa.col - pb.col) <= 1 && Math.abs(pa.row - pb.row) <= 1;
}

/**
 * Minutes on the road between two squares. A step to a side neighbour costs
 * 20, a step to a corner neighbour 25, and each further square adds the same.
 */
export function travelMinutes(a: PlaceId, b: PlaceId): number {
  if (a === b) return 0;
  const pa = place(a);
  const pb = place(b);
  const dc = Math.abs(pa.col - pb.col);
  const dr = Math.abs(pa.row - pb.row);
  const reach = Math.max(dc, dr);
  const manhattan = dc + dr;
  return 20 * reach + 5 * (manhattan - reach);
}
