import { weekdayName, weekdayOf } from './clock';
import type { Announced } from './demand';
import { PLACES, place, type PlaceId } from './places';
import type { Random } from './random';
import type { RunState } from './run';
import type { Message } from './types';

/**
 * How much clients ask for on each day of the week, from Sunday to Saturday: a quiet Sunday and Monday, a busy Friday and an even
 * busier Saturday. Over a week they come to the usual amount.
 */
const WEEK: readonly number[] = [0.9, 0.85, 0.95, 1, 1, 1.1, 1.2];
/** A day at or below this share of the usual is called quiet, one at or above the second is called busy. */
const QUIET_AT = 0.9;
const BUSY_AT = 1.1;

/** The share of a day's usual amount that clients ask for on a day of the run. */
export function weekFactor(day: number): number {
  return WEEK[weekdayOf(day)] ?? 1;
}

/** Whether a day of the run is a busy day of the week. */
export function isBusyWeekday(day: number): boolean {
  return weekFactor(day) >= BUSY_AT;
}

/** The arrow for a day of the run that is quieter (↓) or busier (↑) than the usual, and nothing for an ordinary one. */
export function weekMark(day: number): string {
  return weekFactor(day) <= QUIET_AT ? '↓' : isBusyWeekday(day) ? '↑' : '';
}

/** One line about a day of the run, for the player ordering for it: "Monday is a quiet day: clients ask for less." */
export function weekLine(day: number): string {
  const factor = weekFactor(day);
  const name = weekdayName(day);
  if (factor <= QUIET_AT) return `${name} is a quiet day: clients ask for less.`;
  if (isBusyWeekday(day)) return `${name} is a busy day: clients ask for more.`;
  return `${name} is an ordinary day.`;
}

/** The share of nights on which the next day is a town event, apart from the weekday: about one day in four or five. */
export const TOWN_CHANCE = 0.22;
/** The chance that an ordinary client is closed on a given day; a small client is closed more often, a big one less. At most one client in ten is closed at once. */
export const CLOSED_CHANCE = 0.03;
/** The most clients one night's news may name, so that a saved run stays small. */
const MOST_NAMED = 40;

/** A town event: which squares of the map it is about (any one of them for a match day) and what the news says. */
interface TownEvent {
  /** The id of the `DemandEvent` that says what it does to the orders. */
  id: string;
  places: readonly PlaceId[] | null;
  news: (where: string, when: string) => string;
}

const TOWN: readonly TownEvent[] = [
  { id: 'match', places: null, news: (where, when) => `Match day at ${where} on ${when}: everyone there will want more.` },
  { id: 'regatta', places: ['docks', 'millford'], news: (_, when) => `Regatta at the Docks and Millford on ${when}: everyone there will want more.` },
  { id: 'market', places: ['hollin', 'oakley', 'rushmere'], news: (_, when) => `Farmers' market in Hollin, Oakley and Rushmere on ${when}: everyone there will want more.` },
  { id: 'fair', places: ['saltmarket'], news: (_, when) => `Street fair in Saltmarket on ${when}: everyone there will want more.` },
];

/** Why a client is closed for a day, as it follows "for". */
const REASONS: readonly string[] = [
  'a family wedding',
  'a christening',
  'new floors going down',
  'a staff outing',
  'the owner on holiday',
  'a stock-take',
  'the oven being replaced',
];

type Note = Extract<Message, { kind: 'supplier' | 'staff' }>;

/** What the night's messages say about the day after, and the messages that say it. */
export interface Tomorrow {
  /** The clients each event is about, as the notes on orders give them. */
  ahead: Announced[];
  notes: Note[];
}

/** The names of the clients that are closed on the day the announcements are for. */
export function closedIn(ahead: readonly Announced[]): Set<string> {
  return new Set(ahead.filter((a) => a.event === 'closed').map((a) => a.client));
}

/** Whether an announcement is about the town's own event. */
export function isTownEvent(id: string): boolean {
  return TOWN.some((t) => t.id === id);
}

function choose<T>(entries: readonly T[], roll: number): T {
  return entries[Math.min(entries.length - 1, Math.floor(roll * entries.length))] as T;
}

/**
 * What a day's overnight messages tell the player about the next day: whether the town has something on (a match day,
 * a regatta) that makes the clients it touches ask for more, and which clients are closed. Clients that always ask for a
 * time (the hospital and the schools) are never closed, and a client still on a break tomorrow is never named. It takes all its chances from `random`, always the same number,
 * so that none of it moves anything else that chance decides. Nothing is announced on the first day.
 */
export function tomorrowFor(
  run: RunState,
  orders: ReadonlyArray<{ client: string; place: PlaceId }>,
  random: Random,
  from: number,
  to: number,
): Tomorrow {
  const eventRoll = random();
  const eventPick = random();
  const placePick = random();
  const eventAt = from + Math.floor(random() * (to - from + 1));
  const tries = run.clients.map((client) => ({
    client,
    roll: random(),
    reason: choose(REASONS, random()),
    at: from + Math.floor(random() * (to - from + 1)),
  }));
  const out: Tomorrow = { ahead: [], notes: [] };
  if (run.day < 2) return out;
  const lead = run.crews[0]?.names[0] ?? run.storeRoom[0] ?? 'Joe';
  const when = weekdayName(run.day + 1);
  const open = new Set(orders.map((o) => o.client));

  const closing = tries
    .filter((t) => open.has(t.client.name) && t.client.before == null && t.roll < CLOSED_CHANCE / (t.client.size ?? 1))
    .sort((a, b) => a.roll * (a.client.size ?? 1) - b.roll * (b.client.size ?? 1))
    .slice(0, Math.max(1, Math.floor(open.size / 10)));
  for (const t of closing) {
    out.ahead.push({ client: t.client.name, event: 'closed' });
    out.notes.push({ kind: 'staff', from: lead, text: `${t.client.name} rang: closed on ${when} for ${t.reason}. No order from them.`, at: t.at });
  }

  if (eventRoll < TOWN_CHANCE) {
    const here = PLACES.filter((p) => run.clients.some((c) => c.place === p.id)).map((p) => p.id);
    const kinds = TOWN.filter((t) => (t.places ?? here).some((p) => here.includes(p)));
    const event = kinds.length > 0 ? choose(kinds, eventPick) : null;
    if (event) {
      const area = event.places ?? [choose(here, placePick)];
      const named = run.clients
        .filter((c) => area.includes(c.place) && (run.standing[c.name]?.away ?? 0) <= 1 && !closing.some((t) => t.client.name === c.name))
        .slice(0, MOST_NAMED);
      if (named.length > 0) {
        for (const c of named) out.ahead.push({ client: c.name, event: event.id });
        out.notes.push({ kind: 'staff', from: lead, text: event.news(place(area[0] as PlaceId).name, when), at: eventAt });
      }
    }
  }
  return out;
}
