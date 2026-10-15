import { HISTORY_DAYS, type ClientDay, type History } from './history';
import { ITEM_LIST } from './morning';
import { MOST_CASH, STARTING_CASH } from './money';
import type { Mood } from './moods';
import { PLACES, type PlaceId } from './places';
import type { Delivery, Promised, RunClient, RunState } from './run';
import type { Crew, Kept, Truck } from './types';

/**
 * The version of the saved data. The first version, which had no cash, is still read, and a run saved by it starts
 * from the starting cash; a save with any other version is not read.
 */
export const SAVE_VERSION = 2;
const FIRST_VERSION = 1;

/** The run, as it stood when a day began, with the seed that makes up that day (for day 1, the fixed morning, it is 0). */
export interface SavedRun {
  run: RunState;
  daySeed: number;
}

/** What the player has set up, kept apart from the run so that a run that cannot be read does not lose it. */
export interface Settings {
  /** The office blue colours instead of the soft green. */
  blue: boolean;
  soundOn: boolean;
}

/** Longest list of anything a save may hold, so that a save made by hand cannot make the game crawl. */
const MOST = 200;
const MAX_SEED = 4294967295;
const KEPT: readonly Kept[] = ['freezer', 'fridge', 'dry'];
const MOODS: readonly Mood[] = ['pleased', 'a bit let down', 'let down'];
const ITEM_IDS = new Set(ITEM_LIST.map((i) => i.id));
const PLACE_IDS = new Set<string>(PLACES.map((p) => p.id));

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1e9;
}

/** A sum of money: a whole number, which may be below zero. */
function isMoney(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && Math.abs(v) <= MOST_CASH;
}

function isText(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 200;
}

function listOf<T>(v: unknown, ok: (x: unknown) => x is T): T[] | null {
  return Array.isArray(v) && v.length <= MOST && v.every(ok) ? v : null;
}

/** The entries of an object whose values all pass `ok`, as a new object; null if anything is off. */
function recordOf<T>(v: unknown, ok: (x: unknown) => x is T, keyOk: (k: string) => boolean = () => true): Record<string, T> | null {
  if (!isObject(v)) return null;
  const entries = Object.entries(v);
  if (entries.length > MOST || !entries.every(([k, x]) => keyOk(k) && ok(x))) return null;
  return Object.fromEntries(entries) as Record<string, T>;
}

const isItem = (k: string) => ITEM_IDS.has(k);
const isMood = (v: unknown): v is Mood => MOODS.includes(v as Mood);

function truckOf(v: unknown): Truck | null {
  if (!isObject(v) || !isCount(v.id) || !isText(v.driver) || !isText(v.kind) || !isCount(v.capacity) || v.capacity < 1) return null;
  return { id: v.id, driver: v.driver, kind: v.kind, capacity: v.capacity };
}

function crewOf(v: unknown): Crew | null {
  if (!isObject(v)) return null;
  const names = listOf(v.names, isText);
  const trucks = listOf(v.trucks, isCount);
  return names && trucks ? { names: [...names], trucks: [...trucks] } : null;
}

function clientOf(v: unknown): RunClient | null {
  if (!isObject(v) || !isText(v.name) || !PLACE_IDS.has(v.place as string) || !isText(v.contact)) return null;
  if (v.before !== undefined && !isCount(v.before)) return null;
  return { name: v.name, place: v.place as PlaceId, contact: v.contact, ...(v.before !== undefined ? { before: v.before as number } : {}) };
}

function promisedOf(v: unknown): Promised | null {
  if (!isObject(v) || !isText(v.client) || !ITEM_IDS.has(v.item as string) || !isCount(v.qty) || v.qty < 1) return null;
  return { client: v.client, item: v.item as string, qty: v.qty };
}

function clientDayOf(v: unknown): ClientDay | null {
  if (!isObject(v) || !isCount(v.percent) || v.percent > 100 || typeof v.late !== 'boolean' || !Array.isArray(v.lacked) || v.lacked.length > MOST) return null;
  const lacked = [];
  for (const l of v.lacked) {
    if (!isObject(l) || !ITEM_IDS.has(l.item as string) || !isCount(l.asked) || !isCount(l.given)) return null;
    lacked.push({ item: l.item as string, asked: l.asked, given: l.given });
  }
  return { percent: v.percent, late: v.late, lacked };
}

function historyOf(v: unknown): History | null {
  if (!isObject(v) || Object.keys(v).length > MOST) return null;
  const out: Array<[string, ClientDay[]]> = [];
  for (const [name, days] of Object.entries(v)) {
    if (!Array.isArray(days) || days.length > HISTORY_DAYS) return null;
    const kept = days.map(clientDayOf);
    if (kept.some((d) => d === null)) return null;
    out.push([name, kept as ClientDay[]]);
  }
  return Object.fromEntries(out);
}

function mapped<T>(v: unknown, make: (x: unknown) => T | null): T[] | null {
  if (!Array.isArray(v) || v.length > MOST) return null;
  const out = v.map(make);
  return out.some((x) => x === null) ? null : (out as T[]);
}

/** Builds a run state from parsed data, copying only what it knows; null if any of it is not what a run holds. */
function runOf(v: unknown, version: number): RunState | null {
  if (!isObject(v)) return null;
  const { kind, day } = v;
  if ((kind !== 'small' && kind !== 'big') || !isCount(day) || day < 1) return null;
  const stock = recordOf(v.stock, isCount, isItem);
  const usual = recordOf(v.usual, isCount, isItem);
  const trucks = mapped(v.trucks, truckOf);
  const crews = mapped(v.crews, crewOf);
  const storeRoom = listOf(v.storeRoom, isText);
  const capacity = recordOf(v.capacity, isCount, (k) => KEPT.includes(k as Kept));
  const clients = mapped(v.clients, clientOf);
  const moods = recordOf(v.moods, isMood);
  const history = historyOf(v.history);
  const promises = mapped(v.promises, promisedOf);
  const delivery = v.delivery;
  const cash = version === FIRST_VERSION ? STARTING_CASH : v.cash;
  if (!stock || !usual || !trucks || !crews || !storeRoom || !capacity || !clients || !moods || !history || !promises) return null;
  if (trucks.length === 0 || clients.length === 0 || KEPT.some((k) => !((capacity[k] ?? 0) > 0))) return null;
  if (!isMoney(cash)) return null;
  if (!isObject(delivery) || !isCount(delivery.items) || !isCount(delivery.units)) return null;
  const sent: Delivery = { items: delivery.items, units: delivery.units };
  return {
    kind,
    day,
    stock,
    usual,
    trucks,
    crews,
    storeRoom: [...storeRoom],
    capacity: capacity as Record<Kept, number>,
    clients,
    moods,
    history,
    promises,
    delivery: sent,
    cash,
  };
}

function parse(text: string): Json | null {
  try {
    const data: unknown = JSON.parse(text);
    return isObject(data) && (data.version === FIRST_VERSION || data.version === SAVE_VERSION) ? data : null;
  } catch {
    return null;
  }
}

/** The text to keep for a run as a day begins. */
export function encodeRun(run: RunState, daySeed: number): string {
  return JSON.stringify({ version: SAVE_VERSION, daySeed, run });
}

/** The run in saved text, or null if the text is not a save this game can read: not JSON, another version, or not what a run holds. */
export function decodeRun(text: string): SavedRun | null {
  const data = parse(text);
  if (!data || typeof data.daySeed !== 'number' || !Number.isInteger(data.daySeed) || data.daySeed < 0 || data.daySeed > MAX_SEED) return null;
  const run = runOf(data.run, data.version as number);
  return run ? { run, daySeed: data.daySeed } : null;
}

export function encodeSettings(settings: Settings): string {
  return JSON.stringify({ version: SAVE_VERSION, blue: settings.blue, soundOn: settings.soundOn });
}

/** The settings in saved text, or null if the text cannot be read as settings. */
export function decodeSettings(text: string): Settings | null {
  const data = parse(text);
  if (!data || typeof data.blue !== 'boolean' || typeof data.soundOn !== 'boolean') return null;
  return { blue: data.blue, soundOn: data.soundOn };
}
