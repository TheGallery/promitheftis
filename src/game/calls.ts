import { formatTime } from './clock';
import { closedIn } from './daysize';
import type { Desk } from './desk';
import { plainName } from './headsup';
import { formatMoney } from './money';
import type { MorningResult, OrderResult } from './results';
import type { Road } from './road';
import { offered, RUSH_LOAD_MINUTES, RUSH_REASONS, rushTopic, rushTrips, type RushTrip } from './rush';
import { stockAfterDeliveries } from './supply';
import type { Rush } from './types';

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

export type CallKind = 'short' | 'time' | 'forgot' | 'rush';

export interface CallOption {
  /** What the player says. */
  label: string;
  /** How the answer reads on the result screen. */
  record: string;
  /** True when the answer promises the item on tomorrow's order: a promise, checked when tomorrow's trucks are loaded. */
  addsToOrder?: boolean;
  /** The truck this answer sends with a rush order, with when it gets there and what it pays and costs. */
  rush?: RushTrip;
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
  /** How many of the item are left in the store once today's trucks have gone, when the call is about one. */
  inStore?: number;
  /** How many more the usual order for tomorrow would bring in, when the call is about an item. */
  usualOrder?: number;
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
  const left = stockAfterDeliveries(desk);

  const shorts = delivered
    .filter((o) => o.shortLines.length > 0)
    .sort((a, b) => a.percent - b.percent || a.orderIndex - b.orderIndex);
  // A client rings about the time before the truck is there, and a client with a time asked for rings only when the truck
  // will be there by it, so the call is never after the time asked and no answer is later than it.
  const times = delivered
    .filter((o) => (o.arriveAt as number) - TIME_BEFORE >= road.departAt + FIRST_RING_AFTER && (o.before == null || (o.arriveAt as number) < o.before))
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
    if (call) calls.push(withStock(desk, call, left));
  }

  const rush = desk.morning.rush;
  if (rush) calls.push(withStock(desk, rushCall(desk, result, rush, left, rushRing(rush, road)), left));

  // A truck that unloads at the depot is back soon after: the last ring is before the end of the log.
  for (const call of calls) call.at = Math.min(call.at, road.end - 1);
  calls.sort((a, b) => a.at - b.at);
  // No two phones ring at the same minute; the last ring moves back rather than on.
  for (let i = calls.length - 2; i >= 0; i--) {
    const call = calls[i] as Omit<Call, 'id'>;
    const after = calls[i + 1] as Omit<Call, 'id'>;
    if (call.at >= after.at) call.at = after.at - 1;
  }
  // The rush is answered by trucks sent when it rings, so it is worked out for the minute it really rings.
  const ring = calls.find((c) => c.kind === 'rush');
  if (rush && ring) Object.assign(ring, withStock(desk, rushCall(desk, result, rush, left, ring.at), left));
  const closed = closedIn(desk.morning.tomorrow ?? []);
  return calls.map((c, id) => ({ ...c, id, options: c.options.map((o) => (closed.has(c.client) ? notWhileClosed(o) : o)) }));
}

/** A promise for tomorrow's order to a client that has said it is closed tomorrow cannot be kept, so the answer says so instead. */
function notWhileClosed(option: CallOption): CallOption {
  return option.addsToOrder ? { label: 'You are closed tomorrow, so not this time', record: 'told not this time, closed tomorrow' } : option;
}

/** A call about an item, with what is left of it in the store and what the usual order for tomorrow would add. */
function withStock(desk: Desk, call: Omit<Call, 'id'>, left: Record<string, number>): Omit<Call, 'id'> {
  if (!call.item) return call;
  const inStore = left[call.item] ?? 0;
  return { ...call, inStore, usualOrder: Math.max(0, (desk.morning.usual[call.item] ?? 0) - inStore) };
}

/** Clients who asked for a time are the ones most likely to ring about it. */
function rankForTime(o: OrderResult): number {
  return o.before != null ? 0 : 1;
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
        ? `The delivery came, thank you! But we got no ${item}, and we asked for ${worst.asked}. Is some coming?`
        : `The delivery came, thank you! But we only got ${worst.given} of the ${worst.asked} ${item}. Is some more coming?`,
    options: [
      { label: "Promise the rest for tomorrow's order", record: `added ${qty} to tomorrow`, addsToOrder: true },
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
      { label: "Promise it for tomorrow's order", record: `added ${qty} to tomorrow`, addsToOrder: true },
      { label: 'Sorry, not today', record: 'told not today' },
    ],
  };
}

function timeCall(desk: Desk, o: OrderResult | undefined): Omit<Call, 'id'> | undefined {
  if (!o || o.arriveAt == null) return undefined;
  const ask = o.before != null ? ` We need it before ${formatTime(o.before)}.` : '';
  // The time promised is the next quarter-hour, and never after the time the client asked for.
  const promised = o.before != null ? Math.min(beforeTime(o.arriveAt), o.before) : beforeTime(o.arriveAt);
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
      { label: `It will be with you before ${formatTime(promised)}`, record: `told before ${formatTime(promised)}` },
    ],
  };
}

/** When the rush rings: when its client rings, but not before the trucks are well on their way. */
function rushRing(rush: Rush, road: Road): number {
  return Math.max(rush.at, road.departAt + FIRST_RING_AFTER);
}

/** The client's ask for extra, answered by sending a truck that is still out or in the yard (never the one at the garage), or by saying no. Without the stock there is only no. */
function rushCall(desk: Desk, result: MorningResult, rush: Rush, left: Record<string, number>, at: number): Omit<Call, 'id'> {
  const order = desk.order(rush.orderIndex);
  const name = plainName(desk.item(rush.item).name);
  const trips = (left[rush.item] ?? 0) >= rush.qty ? offered(rushTrips(desk.morning.trucks.filter((t) => !desk.inGarage(t.id)), result, rush, order.place, at)) : [];
  const options: CallOption[] = trips.map((t) => ({ label: tripLabel(t), record: tripRecord(t), rush: t }));
  options.push(trips.length > 0 ? { label: 'Sorry, not today', record: 'turned down' } : { label: 'Sorry, we have none to spare', record: 'none to spare' });
  return {
    kind: 'rush',
    at,
    orderIndex: rush.orderIndex,
    client: rush.client,
    contact: order.contact,
    topic: rushTopic(rush, desk.item(rush.item).name),
    item: rush.item,
    qty: rush.qty,
    say: `${RUSH_REASONS[rush.why] ?? RUSH_REASONS[0]}! Could you bring ${rush.qty} ${name} before ${formatTime(rush.before)}? We will pay extra.`,
    options,
  };
}

/** What a truck on the phone would do: where it is, when it gets there, and what it pays and costs. */
function tripLabel(t: RushTrip): string {
  const where = t.wentOut ? `back ${formatTime(t.leaveAt - RUSH_LOAD_MINUTES)}` : 'in the yard';
  return `Truck ${t.truckId} ${t.driver}, ${where}: there ${formatTime(t.arriveAt)}, ${t.late ? 'late, pays half' : 'in time'} · pays ${formatMoney(t.paid)}, costs ${formatMoney(t.cost)}`;
}

function tripRecord(t: RushTrip): string {
  return `truck ${t.truckId}, ${formatTime(t.arriveAt)}${t.late ? ' late' : ''}, paid ${formatMoney(t.paid)}`;
}
