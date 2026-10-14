import type { DayRoom, DaySummary } from './day';
import { place, type PlaceId } from './places';
import type { Kept } from './types';

/** A restaurant that asks to join: where it is on the nine squares and who to speak to. */
export interface NewClient {
  name: string;
  place: PlaceId;
  contact: string;
}

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
  /** What it gives. */
  gain: string;
  /** The extra work it brings, since nothing is paid for; a clause that follows "The extra work:". */
  work: string;
}

const ROOM_NAME: Record<Kept, string> = { freezer: 'freezer', fridge: 'fridge', dry: 'dry store' };

/** Restaurants that could ask to join, none of them among the clients of either morning. */
export const NEW_CLIENTS: readonly NewClient[] = [
  { name: 'The Salt Cellar', place: 'saltmarket', contact: 'Ines' },
  { name: 'Quayside Kitchen', place: 'docks', contact: 'Bram' },
  { name: 'Hollin Bistro', place: 'hollin', contact: 'Maud' },
  { name: 'Fenwick Pie Shop', place: 'fenwick', contact: 'Alf' },
  { name: 'Station Road Grill', place: 'southgate', contact: 'Nuala' },
  { name: 'The Lantern Room', place: 'saltmarket', contact: 'Yusuf' },
  { name: 'Ashby Orchard Café', place: 'ashby', contact: 'Fern' },
  { name: 'Millford Chippy', place: 'millford', contact: 'Gordon' },
  { name: 'The Acorn Brasserie', place: 'oakley', contact: 'Hattie' },
  { name: 'Rushmere Boathouse', place: 'rushmere', contact: 'Callum' },
  { name: "The Fisherman's Rest", place: 'docks', contact: 'Ottilie' },
  { name: 'Oakley Smokehouse', place: 'oakley', contact: 'Rory' },
  { name: 'Hollin Dairy Café', place: 'hollin', contact: 'Elsie' },
  { name: 'Southgate Noodle Bar', place: 'southgate', contact: 'Mei' },
  { name: 'The Gull and Anchor', place: 'millford', contact: 'Brendan' },
  { name: 'Fenwick Bakehouse', place: 'fenwick', contact: 'Hester' },
  { name: 'Ashby Fish Kitchen', place: 'ashby', contact: 'Luca' },
  { name: 'Saltmarket Market Hall', place: 'saltmarket', contact: 'Hettie' },
  { name: 'Rushmere Tea Garden', place: 'rushmere', contact: 'Beryl' },
  { name: 'The Harbour Master', place: 'docks', contact: 'Ivor' },
];

/** The room that will be fullest tomorrow; the first listed wins a tie. */
export function tightestRoom(rooms: readonly DayRoom[]): DayRoom {
  return rooms.reduce((best, r) => (r.space.pct > best.space.pct ? r : best));
}

/**
 * The restaurant that asks to join: one of the pool picked with `random` (a number
 * from 0 up to but not including 1), never one that is a client already.
 */
export function newClientFor(taken: readonly string[], random: () => number): NewClient {
  const free = NEW_CLIENTS.filter((c) => !taken.includes(c.name));
  const pool = free.length > 0 ? free : NEW_CLIENTS;
  const at = Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)));
  return pool[at] as NewClient;
}

/** The three things the day can end by growing, in the order they are listed; `client` is the restaurant that asks to join. */
export function growthOptions(day: DaySummary, client: NewClient): GrowthOption[] {
  const tight = tightestRoom(day.rooms);
  const room = ROOM_NAME[tight.kept];
  return [
    {
      growth: { kind: 'truck' },
      title: 'Another truck',
      gain: 'More deliveries can go out on time.',
      work: 'one more truck to load and send out every morning.',
    },
    {
      growth: { kind: 'room', room: tight.kept },
      title: `A bigger ${room}`,
      gain: `Extra space in the ${room}, the tightest room: ${tight.space.pct}% full tomorrow.`,
      work: 'more stock to order and keep track of.',
    },
    {
      growth: { kind: 'client', client },
      title: `A new client: ${client.name}`,
      gain: `One more restaurant asks to join: ${client.name} in ${place(client.place).name}, contact ${client.contact}.`,
      work: 'more orders to hand out, and more to juggle between the trucks.',
    },
  ];
}
