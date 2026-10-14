import { formatTime } from './clock';
import type { Desk } from './desk';
import { plainName } from './headsup';
import type { MorningResult, OrderResult } from './results';
import type { Road } from './road';

/** Calls that come in during the small morning; the big morning has a few more. */
const SMALL_KINDS: readonly CallKind[] = ['short', 'time', 'forgot'];
const BIG_KINDS: readonly CallKind[] = ['short', 'time', 'forgot', 'short', 'forgot'];

/** How long after a delivery its client rings about it, in game minutes. */
const SHORT_AFTER = 30;
const FORGOT_AFTER = 20;
/** How long before a truck arrives its client rings to ask when. */
const TIME_BEFORE = 40;
/** A client does not ring until the trucks have been out this long. */
const FIRST_RING_AFTER = 10;

/** A forgotten item is asked for in a small amount: this many, up to span - 1 more. */
const FORGOT_QTY_MIN = 2;
const FORGOT_QTY_SPAN = 4;

export type CallKind = 'short' | 'time' | 'forgot';

export interface CallOption {
  /** What the player says. */
  label: string;
  /** How the answer reads on the result screen. */
  record: string;
  /** True when the answer promises the item on tomorrow's order. */
  addsToOrder?: boolean;
}

export interface Call {
  id: number;
  kind: CallKind;
  /** Game minute the phone rings. */
  at: number;
  orderIndex: number;
  client: string;
  /** The person who rings. */
  contact: string;
  /** What the call is about, short, for the result screen. */
  topic: string;
  /** The item the call is about, when it is about one. */
  item?: string;
  /** How many the client is promised for tomorrow if the player adds them: what was missing, or what they ask for. */
  qty?: number;
  say: string;
  options: CallOption[];
}

/** One line of the result screen: who, what about, and what was answered. */
export function callLine(call: Call, choice: number): string {
  return `${call.client} · ${call.topic} · ${call.options[choice]?.record ?? ''}`;
}

/** The next quarter-hour boundary strictly after `minute`: a time the truck certainly beats. */
export function beforeTime(minute: number): number {
  return Math.floor(minute / 15) * 15 + 15;
}

/**
 * The calls of the morning, in the order they ring. Every call is about a client
 * the trucks really visit and about something that really happens to them: a
 * quoted time is the time the route gives, and "short" means the delivery was short.
 */
export function buildCalls(desk: Desk, result: MorningResult, road: Road): Call[] {
  const kinds = desk.morning.callKinds ?? (desk.morning.id === 'big' ? BIG_KINDS : SMALL_KINDS);
  const delivered = result.orders.filter((o) => o.arriveAt != null && o.truckId != null);
  const taken = new Set<number>();
  const calls: Omit<Call, 'id'>[] = [];

  const shorts = delivered
    .filter((o) => o.shortLines.length > 0)
    .sort((a, b) => a.percent - b.percent || a.orderIndex - b.orderIndex);
  const times = delivered
    .filter((o) => (o.arriveAt as number) - TIME_BEFORE >= road.departAt + FIRST_RING_AFTER)
    .sort((a, b) => rankForTime(a) - rankForTime(b) || (b.arriveAt as number) - (a.arriveAt as number) || a.orderIndex - b.orderIndex);
  const rest = delivered.slice().sort((a, b) => a.orderIndex - b.orderIndex);

  const take = (pool: OrderResult[]): OrderResult | undefined => {
    const found = pool.find((o) => !taken.has(o.orderIndex));
    if (found) taken.add(found.orderIndex);
    return found;
  };

  for (const kind of kinds) {
    const made =
      kind === 'short' ? shortCall(desk, take(shorts)) : kind === 'time' ? timeCall(desk, take(times)) : forgotCall(desk, take(rest));
    // A kind with nobody to ring about it gives way to an item forgotten by someone else.
    const call = made ?? (kind === 'forgot' ? undefined : forgotCall(desk, take(rest)));
    if (call) calls.push(call);
  }

  // A truck that unloads at the depot is back soon after: the last ring is before the end of the log.
  for (const call of calls) call.at = Math.min(call.at, road.end - 1);
  calls.sort((a, b) => a.at - b.at);
  // No two phones ring at the same minute; the last ring moves back rather than on.
  for (let i = calls.length - 2; i >= 0; i--) {
    const call = calls[i] as Omit<Call, 'id'>;
    const after = calls[i + 1] as Omit<Call, 'id'>;
    if (call.at >= after.at) call.at = after.at - 1;
  }
  return calls.map((c, id) => ({ ...c, id }));
}

/** Clients who asked for a time, and got it late, are the ones most likely to ring about it. */
function rankForTime(o: OrderResult): number {
  return o.lateForAsk ? 0 : o.before != null ? 1 : 2;
}

function contactOf(desk: Desk, o: OrderResult): string {
  return desk.order(o.orderIndex).contact;
}

function shortCall(desk: Desk, o: OrderResult | undefined): Omit<Call, 'id'> | undefined {
  if (!o) return undefined;
  const worst = o.shortLines.slice().sort((a, b) => a.given / a.asked - b.given / b.asked)[0];
  if (!worst) return undefined;
  const item = plainName(desk.item(worst.item).name);
  const qty = worst.asked - worst.given;
  return {
    kind: 'short',
    at: (o.arriveAt as number) + SHORT_AFTER,
    orderIndex: o.orderIndex,
    client: o.client,
    contact: contactOf(desk, o),
    topic: `short on ${item}`,
    item: worst.item,
    qty,
    say:
      worst.given === 0
        ? `The delivery came, thank you! But there was no ${item} in it, and we asked for ${worst.asked}. Is some coming?`
        : `The delivery came, thank you! But we only got ${worst.given} of the ${worst.asked} ${item}. Is some more coming?`,
    options: [
      { label: "Add the rest to tomorrow's order", record: `added ${qty} to tomorrow`, addsToOrder: true },
      { label: 'Sorry, nothing more today', record: 'told not today' },
    ],
  };
}

function forgotCall(desk: Desk, o: OrderResult | undefined): Omit<Call, 'id'> | undefined {
  if (!o) return undefined;
  const asked = new Set(desk.order(o.orderIndex).lines.map((l) => l.item));
  const items = desk.morning.items.filter((i) => !asked.has(i.id));
  const item = items[(o.orderIndex * 5 + 2 + (desk.morning.callSalt ?? 0)) % items.length];
  if (!item) return undefined;
  const name = plainName(item.name);
  const qty = FORGOT_QTY_MIN + (o.orderIndex * 3 + items.indexOf(item)) % FORGOT_QTY_SPAN;
  return {
    kind: 'forgot',
    at: (o.arriveAt as number) + FORGOT_AFTER,
    orderIndex: o.orderIndex,
    client: o.client,
    contact: contactOf(desk, o),
    topic: `asked for ${name}`,
    item: item.id,
    qty,
    say: `Silly me, I forgot to put ${name} on the order. Could you send ${qty}?`,
    options: [
      { label: "I'll add it to tomorrow's order", record: `added ${qty} to tomorrow`, addsToOrder: true },
      { label: 'Sorry, not today', record: 'told not today' },
    ],
  };
}

function timeCall(desk: Desk, o: OrderResult | undefined): Omit<Call, 'id'> | undefined {
  if (!o || o.arriveAt == null) return undefined;
  const ask = o.before != null ? ` We need it before ${formatTime(o.before)}.` : '';
  return {
    kind: 'time',
    at: o.arriveAt - TIME_BEFORE,
    orderIndex: o.orderIndex,
    client: o.client,
    contact: contactOf(desk, o),
    topic: 'asked for the time',
    say: `Hello, just checking on our delivery.${ask} What time will the truck be here?`,
    options: [
      { label: `It's on its way, about ${formatTime(o.arriveAt)}`, record: `told about ${formatTime(o.arriveAt)}` },
      { label: `It will be with you before ${formatTime(beforeTime(o.arriveAt))}`, record: `told before ${formatTime(beforeTime(o.arriveAt))}` },
    ],
  };
}
