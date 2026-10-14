import type { OrderResult, ShortLine } from './results';

/** How one day went for one client: how much of the order came, whether the truck was late, and what was short. */
export interface ClientDay {
  /** The share of the order delivered, 0 to 100. */
  percent: number;
  late: boolean;
  lacked: ShortLine[];
}

/** The last days of each client, by name, the most recent first. */
export type History = Record<string, ClientDay[]>;

/** How many days back a client's deliveries are remembered. */
export const HISTORY_DAYS = 2;

const WHEN = ['yesterday', '2 days ago'] as const;
/** The most items named for one day before the rest are counted, unless the caller has more room. */
const NAMED = 3;

/** What a day's order result says about the client, to be remembered. */
export function clientDay(order: Pick<OrderResult, 'percent' | 'lateForAsk' | 'shortLines'>): ClientDay {
  return { percent: order.percent, late: order.lateForAsk, lacked: order.shortLines.map((l) => ({ ...l })) };
}

/** The history after a day: each client's day goes in front, and days older than the last two drop off. */
export function remember(history: History, today: Record<string, ClientDay>): History {
  const next: History = {};
  for (const name of new Set([...Object.keys(history), ...Object.keys(today)])) {
    const day = today[name];
    next[name] = [...(day ? [day] : []), ...(history[name] ?? [])].slice(0, HISTORY_DAYS).map((d) => ({ ...d, lacked: d.lacked.map((l) => ({ ...l })) }));
  }
  return next;
}

export function wasShort(day: ClientDay | undefined): boolean {
  return day != null && day.percent < 100;
}

/** True when the client went short the day before. */
export function shortYesterday(days: readonly ClientDay[] | undefined): boolean {
  return wasShort(days?.[0]);
}

/** How many of the remembered days the client went short: 0, 1 or 2. */
export function shortCount(days: readonly ClientDay[] | undefined): number {
  return (days ?? []).filter(wasShort).length;
}

/** The marker beside an order on the desk: "!" for a client short lately, "!!" for short two days running; empty if neither. */
export function shortMarker(days: readonly ClientDay[] | undefined): string {
  const n = shortCount(days);
  return n === 0 ? '' : n === 1 ? '!' : '!!';
}

/** In words, what went short on one day. */
function describe(day: ClientDay, nameOf: (item: string) => string, named: number): string {
  const got = day.percent === 0 ? 'got nothing' : `got ${day.percent}%`;
  const parts = day.lacked.slice(0, named).map((l) => `${nameOf(l.item)} (${l.given} of ${l.asked})`);
  const more = day.lacked.length - parts.length;
  if (more > 0) parts.push(`+${more} more`);
  const lack = parts.length > 0 ? `, short of ${parts.join(', ')}` : '';
  return `${got}${lack}${day.late ? ', and late' : ''}.`;
}

/**
 * The detail for an order from a client who went short lately: one entry per short day, most recent first,
 * each with the day, how much came and what was short; short two days running leads with a line of its own.
 */
export function shortNotes(days: readonly ClientDay[] | undefined, nameOf: (item: string) => string, named = NAMED): string[] {
  const out: string[] = [];
  if (shortCount(days) === HISTORY_DAYS) out.push('Short two days running.');
  (days ?? []).forEach((day, age) => {
    if (!wasShort(day)) return;
    const when = WHEN[age] as string;
    out.push(`${when.charAt(0).toUpperCase()}${when.slice(1)}: ${describe(day, nameOf, named)}`);
  });
  return out;
}
