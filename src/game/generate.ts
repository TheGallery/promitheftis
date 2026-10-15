import { breakdownFor } from './breakdown';
import type { CallKind } from './calls';
import { itemWeight } from './clients';
import { formatTime } from './clock';
import { swings } from './demand';
import { plainName } from './headsup';
import { arrivalTime, generateLines, ITEM_LIST } from './morning';
import { moodEffect } from './moods';
import { below, pick, type Random } from './random';
import { rushFor, rushNote } from './rush';
import { shortNotes } from './shortfall';
import { KEPT_ORDER } from './supply';
import type { RunClient, RunState } from './run';
import type { Kept, Message, Morning, Order, OrderLine } from './types';

/** Longest note shown whole on the order desk, in characters, once the contact's name is counted. */
const NOTE_BUDGET = 58;
/** The share of clients that add a note of their own to an order. */
const NOTE_CHANCE = 0.3;
/** The share of clients that ask for a time on a given day, apart from those that always ask for one. */
const TIME_CHANCE = 0.3;
/** Times a client may ask to be reached by, in minutes since midnight. */
const ASKED_TIMES = [8 * 60, 9 * 60, 10 * 60, 11 * 60];
/** Orders may fill this share of all the truck space together, so a careful player can load them. */
export const TRUCK_SHARE = 0.85;
/** Each item's total for the day is its usual amount, give or take this share. */
const JITTER = 0.05;

const NOTES: readonly string[] = [
  'Quiz night on Friday.',
  'Harvest supper on Saturday.',
  'A wedding party this weekend.',
  'Same as last week, please.',
  'Thank you for last time!',
  'Half term, so we are busy.',
  'Chef is away, so keep it simple.',
  'New menu starts today.',
  'Please ring if anything is short.',
  'The walk-in fridge is being fixed.',
];

type Note = Extract<Message, { kind: 'supplier' | 'staff' }>;

const STAFF_NOTES: readonly Omit<Note, 'at'>[] = [
  { kind: 'staff', from: 'Joe', text: 'Loading crew starts at 6 sharp. Kettle is on.' },
  { kind: 'staff', from: 'Bea', text: 'Van 2 has a new tyre. Mind the loading ramp, it is wet.' },
  { kind: 'staff', from: 'Max', text: 'The store room is tidy and the labels are fresh.' },
  { kind: 'staff', from: 'Ines', text: 'Back in today. Pallet jack is by the freezer door.' },
  { kind: 'staff', from: 'Kit', text: 'Drivers have their route cards. Cold bags are on the hook.' },
];

const SUPPLIER_NOTES: readonly Omit<Note, 'at'>[] = [
  { kind: 'supplier', from: 'Grange Farm', text: 'Eggs and potatoes are on the way for the next order.' },
  { kind: 'supplier', from: 'Northfrost', text: 'Our freezer lorry runs to time this week.' },
  { kind: 'supplier', from: 'Hartley', text: 'Price list is unchanged this month.' },
  { kind: 'supplier', from: 'Quay Butchers', text: 'Pork is in good supply today.' },
];

const SUPPLIER_FIRST = 24 * 60 + 3 * 60;
const SUPPLIER_LAST = 24 * 60 + 5 * 60 + 15;

function shuffled<T>(random: Random, entries: readonly T[]): T[] {
  const out = [...entries];
  for (let i = out.length - 1; i > 0; i--) {
    const j = below(random, i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** The size of the lines an order asks for: scaled by `factor`, never below one of each. */
function scaled(lines: readonly OrderLine[], factor: number): OrderLine[] {
  return lines.map((l) => ({ item: l.item, asked: Math.max(1, Math.round(l.asked * factor)) }));
}

/** Adds what the client was promised on the phone: to the line for that item if there is one, as a new line if not. */
function addPromises(lines: OrderLine[], client: RunClient, run: RunState): void {
  for (const p of run.promises.filter((x) => x.client === client.name)) {
    const line = lines.find((l) => l.item === p.item);
    if (line) line.asked += p.qty;
    else lines.push({ item: p.item, asked: p.qty });
  }
}

/** The note on an order, most important first: what was promised, how the client feels, then the rest, while it all still shows. */
function noteFor(client: RunClient, run: RunState, ask: { before?: number; note?: string }): string | undefined {
  const promised = run.promises.filter((p) => p.client === client.name);
  const names = new Map(ITEM_LIST.map((i) => [i.id, plainName(i.name)]));
  const parts: string[] = [];
  if (promised.length > 0) parts.push(`As promised: ${promised.map((p) => `${p.qty} ${names.get(p.item) ?? p.item}`).join(', ')}.`);
  const mood = moodEffect(run.moods[client.name]).note;
  if (mood) parts.push(mood);
  if (ask.before != null) parts.push(client.before != null ? `Before ${formatTime(ask.before)} again, please.` : `Could you come before ${formatTime(ask.before)}?`);
  if (ask.note) parts.push(ask.note);
  const kept: string[] = [];
  for (const part of parts) {
    if (kept.length === 0 || [...[...kept, part].join(' ')].length <= NOTE_BUDGET - client.contact.length) kept.push(part);
  }
  return kept.length > 0 ? kept.join(' ') : undefined;
}

/** The orders' lines, with the client that asks, as `shapeDemand` works on them. */
interface Asking {
  client: RunClient;
  lines: OrderLine[];
}

/** Whole numbers that add up to `total`, in the proportions of `weights`: the biggest remainders get the extra ones. */
function apportion(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map((w) => (sum > 0 ? (total * w) / sum : total / weights.length));
  const out = exact.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((p, q) => q[0] - p[0] || p[1] - q[1]);
  for (const [, i] of order) {
    if (left <= 0) break;
    out[i] = (out[i] as number) + 1;
    left--;
  }
  return out;
}

/**
 * Turns the clients' made-up lines into the day's demand: each item is asked for about its usual amount, give or take a
 * little, shared between the clients that ask for it in the proportions they drew. Then what the notes of the day before
 * announced is added to (or taken from) the clients they were about, and a client let down yesterday asks for less.
 */
function shapeDemand(made: readonly Asking[], run: RunState, random: Random): void {
  const clients = made.length;
  const minAskers = Math.max(1, Math.ceil(clients / 4));
  for (const item of ITEM_LIST) {
    const askers = made.filter((m) => m.lines.some((l) => l.item === item.id));
    const without = made.filter((m) => !askers.includes(m));
    for (let k = askers.length; k < minAskers && without.length > 0; k++) {
      const chosen = without.splice(below(random, without.length), 1)[0] as Asking;
      chosen.lines.push({ item: item.id, asked: 1 });
    }
    const target = Math.max(1, Math.round((run.usual[item.id] ?? 0) * (1 + (random() * 2 - 1) * JITTER)));
    const lines = made.flatMap((m) => m.lines.filter((l) => l.item === item.id).map((line) => ({ line, weight: line.asked * itemWeight(m.client, item.kept) })));
    if (lines.length === 0) continue;
    const shares = apportion(target, lines.map((l) => l.weight));
    lines.forEach((l, i) => (l.line.asked = Math.max(1, shares[i] as number)));
  }
  for (const swing of swings(run.ahead, run.usual, clients)) {
    const m = made.find((x) => x.client.name === swing.client);
    if (!m) continue;
    const line = m.lines.find((l) => l.item === swing.item);
    if (line) line.asked = Math.max(1, line.asked + swing.units);
    else if (swing.units > 0) m.lines.push({ item: swing.item, asked: swing.units });
  }
  for (const m of made) m.lines = scaled(m.lines, moodEffect(run.moods[m.client.name]).scale);
}

/** Brings all the amounts down together if the orders would not fit on the trucks with room to spare. */
function fitToTrucks(orders: ReadonlyArray<{ lines: OrderLine[] }>, run: RunState): void {
  const size = new Map(ITEM_LIST.map((i) => [i.id, i.size]));
  const room = run.trucks.reduce((sum, t) => sum + t.capacity, 0) * TRUCK_SHARE;
  for (let round = 0; round < 4; round++) {
    const total = orders.reduce((sum, o) => sum + o.lines.reduce((n, l) => n + l.asked * (size.get(l.item) ?? 1), 0), 0);
    if (total <= room) return;
    for (const o of orders) o.lines = scaled(o.lines, room / total);
  }
}

/** The kinds of phone call today: a few more when there are more orders, at least one of each, in a different order each day. */
function callKindsFor(orderCount: number, random: Random): CallKind[] {
  const count = (orderCount >= 20 ? 5 : 3) + below(random, 2);
  const all: CallKind[] = ['short', 'time', 'forgot'];
  const kinds = [...all];
  while (kinds.length < count) kinds.push(pick(random, all));
  return shuffled(random, kinds);
}

const ROOM_WORD: Record<Kept, string> = { freezer: 'freezer', fridge: 'fridge', dry: 'dry store' };

/** "8 frozen chips", "8 frozen chips and 5 frozen peas", "a, b and c". */
function listed(entries: readonly string[]): string {
  return entries.length < 2 ? entries.join('') : `${entries.slice(0, -1).join(', ')} and ${entries.at(-1)}`;
}

/** One note from the store room for each room where stock spoiled overnight. */
function spoilNotes(run: RunState): Array<Omit<Note, 'at'>> {
  const keptOf = new Map(ITEM_LIST.map((i) => [i.id, i.kept]));
  const names = new Map(ITEM_LIST.map((i) => [i.id, plainName(i.name)]));
  return KEPT_ORDER.flatMap((kept): Array<Omit<Note, 'at'>> => {
    const lost = run.spoiled.filter((s) => keptOf.get(s.item) === kept && s.units > 0);
    if (lost.length === 0) return [];
    const what = listed(lost.map((s) => `${s.units} ${names.get(s.item) ?? s.item}`));
    return [{ kind: 'staff', from: run.storeRoom[0] ?? 'Max', text: `${what} spoiled: the ${ROOM_WORD[kept]} was full.` }];
  });
}

function overnightNotes(run: RunState, random: Random): Message[] {
  const notes: Array<Omit<Note, 'at'>> = [];
  if (run.delivery.units > 0) {
    const items = `${run.delivery.items} ${run.delivery.items === 1 ? 'item' : 'items'}`;
    const units = `${run.delivery.units} ${run.delivery.units === 1 ? 'unit' : 'units'}`;
    notes.push({ kind: 'supplier', from: 'Hartley', text: `Your order is in: ${items}, ${units}.` });
  }
  const left = shortNotes(run.short).map((n): Omit<Note, 'at'> => ({ kind: 'supplier', ...n }));
  // A supplier that has just said part of the order did not come does not also say all is well.
  const calm = SUPPLIER_NOTES.filter((n) => !left.some((l) => l.from === n.from));
  notes.push(...left, ...spoilNotes(run), pick(random, STAFF_NOTES), pick(random, calm));
  const slots = Math.max(4, notes.length);
  const times = Array.from({ length: slots }, (_, i) => SUPPLIER_FIRST + Math.round((i * (SUPPLIER_LAST - SUPPLIER_FIRST)) / (slots - 1)));
  return shuffled(random, times).slice(0, notes.length).sort((a, b) => a - b).map((at, i) => ({ ...(notes[i] as Omit<Note, 'at'>), at }));
}

/**
 * A morning after the first: the clients' orders, the notes and the calls are made up,
 * from the run's state — stock, trucks, rooms, clients, their moods and what was promised.
 * `random` is the one source of chance, so the same one gives the same morning.
 */
export function generateDay(run: RunState, random: Random): Morning {
  const made = shuffled(random, run.clients).map((client) => {
    const lines = generateLines(random);
    // Every client draws the same numbers whatever it does with them, so one client's choices do not move another's.
    const noteRoll = random();
    const noteText = pick(random, NOTES);
    const timeRoll = random();
    const timeText = pick(random, ASKED_TIMES);
    const before = client.before ?? (timeRoll < TIME_CHANCE ? timeText : undefined);
    const note = noteFor(client, run, { ...(before != null ? { before } : {}), ...(noteRoll < NOTE_CHANCE ? { note: noteText } : {}) });
    return { client, lines, note, before };
  });
  shapeDemand(made, run, random);
  fitToTrucks(made, run);
  for (const m of made) addPromises(m.lines, m.client, run);

  const orders: Order[] = made.map((m, index) => {
    const order: Order = {
      id: index + 1,
      client: m.client.name,
      place: m.client.place,
      contact: m.client.contact,
      leftAt: arrivalTime(index, made.length),
      lines: m.lines,
    };
    if (m.note) order.note = m.note;
    if (m.before != null) order.before = m.before;
    return order;
  });

  const messages: Message[] = [
    ...orders.map((o): Message => ({ kind: 'order', orderId: o.id, at: o.leftAt })),
    ...overnightNotes(run, random),
  ];
  const callKinds = callKindsFor(orders.length, random);
  const callSalt = below(random, 1000);
  // Drawn last, so that a truck at the garage moves nothing else that chance decides.
  const breakdown = breakdownFor(run, random, SUPPLIER_FIRST, SUPPLIER_LAST);
  if (breakdown) messages.push({ ...breakdown.note, at: breakdown.at });
  // The rush order is drawn after that, so it moves nothing either.
  const rush = rushFor(run, orders, random);
  if (rush) messages.push(rushNote(rush, run.crews[0]?.names[0] ?? 'Joe'));
  messages.sort((a, b) => a.at - b.at);

  return {
    id: run.kind,
    day: run.day,
    title: `Day ${run.day}`,
    items: ITEM_LIST,
    stock: { ...run.stock },
    usual: { ...run.usual },
    capacity: { ...run.capacity },
    trucks: run.trucks.map((t) => ({ ...t })),
    orders,
    messages,
    crews: run.crews.map((c) => ({ names: [...c.names], trucks: [...c.trucks] })),
    storeRoom: [...run.storeRoom],
    callKinds,
    callSalt,
    ...(run.short.length > 0 ? { short: run.short.map((s) => ({ ...s })) } : {}),
    ...(breakdown ? { garage: breakdown.garage } : {}),
    ...(rush ? { rush } : {}),
  };
}
