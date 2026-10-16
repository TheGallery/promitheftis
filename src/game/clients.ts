import { formatTime } from './clock';
import { ITEM_LIST } from './morning';
import { DEPOT, PLACES, place, travelSquares, type PlaceId } from './places';
import { below, mulberry32, pick, type Random } from './random';
import type { Kept } from './types';

/**
 * What sets a client apart from an ordinary one: how big its orders are, whether it always wants them by a certain
 * time, and whether most of what it orders is kept in one store room. Where it is on the map is part of the client.
 */
export interface ClientShape {
  /** The size of its orders next to an ordinary client's, which is 1. */
  size: number;
  /** A time it always wants its order by, in minutes since midnight. */
  before?: number;
  /** The store room most of its order comes from. */
  heavy?: Kept;
}

/** A restaurant that asks to join: where it is on the nine squares, who to speak to, and what its orders are like. */
export interface NewClient {
  name: string;
  place: PlaceId;
  contact: string;
  shape: ClientShape;
}

/** The orders of a big client are this many times an ordinary client's, and a small client's this many. */
export const BIG_SIZE = 2;
export const SMALL_SIZE = 0.5;
/** A client heavy on a store room takes this many times as much from it as an ordinary client, and this many times as much from the other two. */
const HEAVY_IN = 2;
const HEAVY_OUT = 0.5;
/** Times a client that is always early may ask for. */
const EARLY_TIMES = [8 * 60, 9 * 60];
/** The longest a made-up name may be, so that it shows whole on every screen. */
const NAME_WIDTH = 20;

const KEPT_LIST: readonly Kept[] = ['freezer', 'fridge', 'dry'];
const KEPT_WORD: Record<Kept, string> = { freezer: 'freezer stock', fridge: 'fridge stock', dry: 'dry goods' };
const KEPT_OF = new Map(ITEM_LIST.map((i) => [i.id, i.kept]));

/** Just what a client's shape needs to be told apart from another's. */
interface Shaped {
  size?: number;
  heavy?: Kept;
}

export function sizeOf(client: Shaped): number {
  return client.size ?? 1;
}

/** How much of the items kept in `kept` a client takes, next to an ordinary client. */
export function itemWeight(client: Shaped, kept: Kept): number {
  return sizeOf(client) * (client.heavy == null ? 1 : client.heavy === kept ? HEAVY_IN : HEAVY_OUT);
}

/** How many ordinary clients the business is worth, counting a big one as more and a small one as less. */
export function clientWeight(clients: readonly Shaped[]): number {
  return clients.reduce((sum, c) => sum + sizeOf(c), 0);
}

/**
 * The usual amounts once `joining` is a client too: each grows by the share a client of its kind takes of the whole,
 * so a big client adds more than a small one, and one heavy on a room adds most of it to that room's items.
 */
export function usualWith(usual: Readonly<Record<string, number>>, clients: readonly Shaped[], joining: Shaped): Record<string, number> {
  const out = { ...usual };
  const total = clientWeight(clients);
  if (total <= 0) return out;
  for (const [item, n] of Object.entries(usual)) {
    const kept = KEPT_OF.get(item);
    if (kept) out[item] = n + Math.round((n * itemWeight(joining, kept)) / total);
  }
  return out;
}

/**
 * The usual amounts once `leaving`, one of `clients`, has gone for good: each falls by the share that client takes of the whole,
 * so the orders that are left are as big as before and the business is worth less by that client's orders.
 */
export function usualWithout(usual: Readonly<Record<string, number>>, clients: readonly Shaped[], leaving: Shaped): Record<string, number> {
  const out = { ...usual };
  const total = clientWeight(clients);
  if (total <= 0) return out;
  for (const [item, n] of Object.entries(usual)) {
    const kept = KEPT_OF.get(item);
    if (kept) out[item] = Math.max(0, n - Math.round((n * itemWeight(leaving, kept)) / total));
  }
  return out;
}

/** Squares from the depot to a place, one way. */
export function distanceFromDepot(id: PlaceId): number {
  return travelSquares(DEPOT, id);
}

/** "far from the depot", "close to the depot" or "at the depot". */
export function distanceText(id: PlaceId): string {
  const squares = distanceFromDepot(id);
  return squares === 0 ? 'at the depot' : squares === 1 ? 'close to the depot' : 'far from the depot';
}

/** What the client is like, in a line: "Big orders, Rushmere: far from the depot; always before 09:00". */
export function shapeText(client: { place: PlaceId; shape: ClientShape }): string {
  const { size, before, heavy } = client.shape;
  const orders = size > 1 ? 'Big orders' : size < 1 ? 'Small orders' : 'Ordinary orders';
  const traits = [distanceText(client.place), ...(before != null ? [`always before ${formatTime(before)}`] : []), ...(heavy ? [`mostly ${KEPT_WORD[heavy]}`] : [])];
  return `${orders}, ${place(client.place).name}: ${traits.join('; ')}`;
}

const NEAR: readonly PlaceId[] = PLACES.filter((p) => distanceFromDepot(p.id) <= 1).map((p) => p.id);
const FAR: readonly PlaceId[] = PLACES.filter((p) => distanceFromDepot(p.id) >= 2).map((p) => p.id);
const ANYWHERE: readonly PlaceId[] = PLACES.map((p) => p.id);

/** The kinds of client that can ask to join, each a trade-off between what it brings in and what it asks for. */
const SHAPES: ReadonlyArray<{ places: readonly PlaceId[]; make: (random: Random) => ClientShape }> = [
  { places: FAR, make: () => ({ size: BIG_SIZE }) },
  { places: NEAR, make: () => ({ size: SMALL_SIZE }) },
  { places: ANYWHERE, make: (random) => ({ size: 1, before: pick(random, EARLY_TIMES) }) },
  { places: ANYWHERE, make: (random) => ({ size: 1, heavy: pick(random, KEPT_LIST) }) },
];

const PLACE_KINDS = [
  'Kitchen', 'Bistro', 'Café', 'Chippy', 'Pie Shop', 'Grill', 'Bakehouse', 'Smokehouse',
  'Tea Garden', 'Noodle Bar', 'Brasserie', 'Deli', 'Canteen', 'Fish Bar', 'Tavern', 'Larder',
];
const THE_THINGS = [
  'Salt Cellar', 'Lantern', 'Acorn', 'Gull', 'Anchor', 'Harbour', 'Copper Kettle', 'Blue Door', 'Old Mill', 'Fisherman',
  'Wheatsheaf', 'Heron', 'Lamplighter', 'Bell', 'Orchard', 'Pelican', 'Rowan', 'Ferry', 'Barley Mow', 'Kingfisher',
];
const SURNAMES = [
  'Pell', 'Hobbs', 'Marlow', 'Tilley', 'Voss', 'Okafor', 'Brand', 'Quill', 'Yarrow', 'Fenn', 'Garrick', 'Ludlow', 'Sedge', 'Thorne', 'Wren',
  'Ashdown', 'Bellamy', 'Cobb', 'Dunmore', 'Eames', 'Fairley', 'Gaunt', 'Hale', 'Ingram', 'Jessop', 'Kemp', 'Larkin', 'Moss', 'Nash', 'Orme',
];
const THE_KINDS = ['Room', 'Inn', 'Tap', 'Kitchen', 'Table', 'Arms', 'Tavern', 'Pantry', 'Hall', 'Rest'];

const CONTACTS = [
  'Ines', 'Bram', 'Maud', 'Alf', 'Nuala', 'Yusuf', 'Fern', 'Gordon', 'Hattie', 'Callum', 'Ottilie', 'Rory', 'Elsie', 'Mei', 'Brendan',
  'Hester', 'Luca', 'Hettie', 'Beryl', 'Ivor', 'Tamsin', 'Dara', 'Wilf', 'Priya', 'Josef', 'Agnes', 'Kofi', 'Marta', 'Sunil', 'Edith',
  'Cormac', 'Dilys', 'Anselm', 'Petra', 'Haruki', 'Winnie', 'Tobias', 'Leila', 'Gwen', 'Matthias', 'Sorcha', 'Basil', 'Nell', 'Idris',
];

const NAMES = new Map<PlaceId, string[]>();

/** Every name a restaurant in `id` may be given, none too long to show whole. */
function namesIn(id: PlaceId): string[] {
  let names = NAMES.get(id);
  if (!names) {
    const here = place(id).name;
    const all = [
      ...PLACE_KINDS.map((k) => `${here} ${k}`),
      ...THE_THINGS.flatMap((t) => [`The ${t}`, ...THE_KINDS.map((k) => `The ${t} ${k}`)]),
      ...SURNAMES.flatMap((n) => PLACE_KINDS.map((k) => `${n}'s ${k}`)),
    ];
    names = all.filter((n) => [...n].length <= NAME_WIDTH);
    NAMES.set(id, names);
  }
  return names;
}

/** A name no client has, for when every name in a place is taken: the name with a number on the end, still short enough to show whole. */
function numbered(name: string, taken: ReadonlySet<string>): string {
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const candidate = `${[...name].slice(0, NAME_WIDTH - suffix.length).join('').trimEnd()}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * The restaurant that asks to join, made up with `random`: a kind of client, a place that suits it, a name and a contact.
 * Never one whose name is in `taken`, however many have joined already.
 */
export function newClientFor(taken: readonly string[], random: Random): NewClient {
  const kind = SHAPES[below(random, SHAPES.length)] as (typeof SHAPES)[number];
  const at = pick(random, kind.places);
  const shape = kind.make(random);
  const names = namesIn(at);
  const start = below(random, names.length);
  const used = new Set(taken);
  const name = names.map((_, step) => names[(start + step) % names.length] as string).find((n) => !used.has(n)) ?? numbered(names[start] as string, used);
  return { name, place: at, contact: pick(random, CONTACTS), shape };
}

/** A random source for one evening's new client: the same number always makes the same client. */
export function randomFrom(seed: number): Random {
  return mulberry32(Math.floor(seed * 4294967296));
}
