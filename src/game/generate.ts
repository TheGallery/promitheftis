import type { CallKind } from './calls';
import { formatTime } from './clock';
import { plainName } from './headsup';
import { arrivalTime, generateLines, ITEM_LIST } from './morning';
import { moodEffect } from './moods';
import { below, pick, type Random } from './random';
import type { RunClient, RunState } from './run';
import type { Message, Morning, Order, OrderLine } from './types';

/** Longest note shown whole on the order desk, in characters, once the contact's name is counted. */
const NOTE_BUDGET = 58;
/** The share of clients that add a note of their own to an order. */
const NOTE_CHANCE = 0.25;
/** The share of clients that ask for a time on a day they do not always ask. */
const TIME_CHANCE = 0.12;
/** Times a client may ask to be reached by, in minutes since midnight. */
const ASKED_TIMES = [8 * 60, 9 * 60, 10 * 60, 11 * 60];
/** Orders may fill this share of all the truck space together, so a careful player can load them. */
const TRUCK_SHARE = 0.7;

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

/** The lines one client asks for today: random items and amounts, a little less when yesterday left them let down. */
function clientLines(client: RunClient, run: RunState, random: Random): OrderLine[] {
  return scaled(generateLines(random), moodEffect(run.moods[client.name]).scale);
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

/** Brings the amounts down so each item is asked for no more than its usual daily amount. */
function fitToUsual(orders: ReadonlyArray<{ lines: OrderLine[] }>, run: RunState): void {
  const totals = new Map<string, number>();
  for (const o of orders) for (const l of o.lines) totals.set(l.item, (totals.get(l.item) ?? 0) + l.asked);
  for (const [item, total] of totals) {
    const usual = run.usual[item] ?? 0;
    if (usual <= 0 || total <= usual) continue;
    for (const o of orders) for (const l of o.lines) if (l.item === item) l.asked = Math.max(1, Math.floor((l.asked * usual) / total));
  }
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

function overnightNotes(run: RunState, random: Random): Message[] {
  const times = Array.from({ length: 4 }, (_, i) => SUPPLIER_FIRST + Math.round((i * (SUPPLIER_LAST - SUPPLIER_FIRST)) / 3));
  const notes: Array<Omit<Note, 'at'>> = [];
  if (run.delivery.units > 0) {
    const items = `${run.delivery.items} ${run.delivery.items === 1 ? 'item' : 'items'}`;
    const units = `${run.delivery.units} ${run.delivery.units === 1 ? 'unit' : 'units'}`;
    notes.push({ kind: 'supplier', from: 'Hartley', text: `Your order is in: ${items}, ${units}.` });
  }
  notes.push(pick(random, STAFF_NOTES), pick(random, SUPPLIER_NOTES));
  return shuffled(random, times).slice(0, notes.length).sort((a, b) => a - b).map((at, i) => ({ ...(notes[i] as Omit<Note, 'at'>), at }));
}

/**
 * A morning after the first: the clients' orders, the notes and the calls are made up,
 * from the run's state — stock, trucks, rooms, clients, their moods and what was promised.
 * `random` is the one source of chance, so the same one gives the same morning.
 */
export function generateDay(run: RunState, random: Random): Morning {
  const made = shuffled(random, run.clients).map((client) => {
    const lines = clientLines(client, run, random);
    // Every client draws the same numbers whatever it does with them, so one client's choices do not move another's.
    const noteRoll = random();
    const noteText = pick(random, NOTES);
    const timeRoll = random();
    const timeText = pick(random, ASKED_TIMES);
    const before = client.before ?? (timeRoll < TIME_CHANCE ? timeText : undefined);
    const note = noteFor(client, run, { ...(before != null ? { before } : {}), ...(noteRoll < NOTE_CHANCE ? { note: noteText } : {}) });
    return { client, lines, note, before };
  });
  fitToUsual(made, run);
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
  ].sort((a, b) => a.at - b.at);

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
    callKinds: callKindsFor(orders.length, random),
    callSalt: below(random, 1000),
  };
}
