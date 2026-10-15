import { swings } from '../src/game/demand';
import { shortYesterday } from '../src/game/history';
import { clientPrice, growthPrice, supplierPrice, truckCost } from '../src/game/money';
import { mulberry32 } from '../src/game/random';
import { spaceOf } from '../src/game/rooms';
import { promisesFrom } from '../src/game/run';
import { planRoute } from '../src/game/routes';
import { KEPT_ORDER } from '../src/game/supply';
import type { Kept } from '../src/game/types';
import { App } from '../src/ui/app';
import { memoryStore } from '../src/ui/store';
import { fakeEffects, hold } from './helpers';

/**
 * Plays the real game through its keys, day after day, the way a player would, to see what thinking is worth.
 *
 * - `blind` presses ENTER and SPACE everywhere: every line as asked, the truck the cursor is on (one step down when it
 *   is too full), the first answer to every call, and A on the supplier order.
 * - `careful` does the same work with its head: it shares a short item out so that as few clients as possible go short,
 *   puts each order on the truck that adds least to the road, orders what the notes say tomorrow will need and no more
 *   than the rooms hold or the bank can pay for, and buys a room when the rooms are costing it sales.
 *
 * Both choose what to grow by the same rule: a new client, unless the trucks were well loaded and a truck can be paid for.
 * Everything chance decides comes from the seed, so the same seed always plays the same days.
 */
export type Policy = 'blind' | 'careful';

export interface DayStat {
  /** The day of the run; the first is 1. */
  day: number;
  /** What the day came to: taken in, less the supplier order and the trucks. */
  profit: number;
  takenIn: number;
  supplier: number;
  trucks: number;
  /** The cash in the bank once the day is settled, before growth. */
  cash: number;
  orders: number;
  inFull: number;
  pleased: number;
  /** Orders that got no truck. */
  stranded: number;
  /** Squares the trucks drove. */
  squares: number;
  /** Share of all the truck space that was loaded when the trucks left, 0 to 1. */
  load: number;
  /** Units that spoiled in the rooms overnight, at the start of this day. */
  spoiled: number;
  clients: number;
  trucksOwned: number;
  /** What a truck and a room would have cost that evening. */
  truckPrice: number;
  roomPrice: number;
  grew: 'truck' | 'room' | 'client';
}

/** Trucks that were this much loaded are worth another truck, if it can be paid for. */
const TRUCK_LOAD = 0.8;
/** A careful player keeps this share of the supplier order in the bank when growing. */
const RESERVE = 0.15;
/** A room that tomorrow's needs would fill this much, or more, is worth a bigger one. */
const ROOM_FULL = 0.9;
/** A careful player orders this much more than the notes say, where the rooms have space, so a small surprise leaves nobody short. */
const BUFFER = 0.1;

export function playRun(kind: 'small' | 'big', policy: Policy, seed: number, days: number): DayStat[] {
  const random = mulberry32(seed * 7919 + 13);
  const app = new App(fakeEffects([], random, memoryStore()), () => {}, kind);
  const out: DayStat[] = [];
  for (let d = 0; d < days; d++) out.push(playDay(app, policy));
  return out;
}

type Press = (...keys: string[]) => void;

/** What the supplier order learned about the rooms, for choosing what to grow. */
interface RoomNeeds {
  /** The margin an order gave up in a room because the room could not hold more. */
  lost: Record<Kept, number>;
  /** How full a room would be with just what tomorrow needs, 1 being full. */
  fill: Record<Kept, number>;
}

function playDay(app: App, policy: Policy): DayStat {
  const press: Press = (...keys) => keys.forEach((key) => app.press({ key }));
  const day = app.morning.day;
  const spoiled = app.run.spoiled.reduce((sum, s) => sum + s.units, 0);
  if (app.screen === 'messages') press(' ');
  if (policy === 'blind') blindDesk(app, press);
  else carefulDesk(app, press);

  const capacity = app.morning.trucks.reduce((sum, t) => sum + t.capacity, 0);
  const load = app.morning.trucks.reduce((sum, t) => sum + app.desk.load(t.id), 0) / capacity;
  press(' ');
  hold(app, ' ');
  for (let n = 0; n < 100 && !app.roadOver; n++) press(app.roadCall ? 'Enter' : ' ');
  press(' ', ' ');

  let needs: RoomNeeds | null = null;
  if (policy === 'blind') press('a');
  else needs = carefulSupply(app, press, !wantsTruck(app, load));
  hold(app, ' ');

  const summary = app.day!;
  const result = app.result!;
  const grew = choose(app, policy, load, needs);
  const [truck, room] = app.growthOptions;
  press(' ', String(['truck', 'room', 'client'].indexOf(grew) + 1), 'Enter');
  const stat: DayStat = {
    day,
    profit: summary.money.total,
    takenIn: summary.money.takenIn,
    supplier: summary.money.supplier,
    trucks: summary.money.trucks,
    cash: summary.money.cash,
    orders: result.orders.length,
    inFull: result.inFull,
    pleased: summary.orders.filter((o) => o.mood === 'pleased').length,
    stranded: result.orders.filter((o) => o.truckId == null).length,
    squares: summary.money.squares,
    load,
    spoiled,
    clients: app.run.clients.length,
    trucksOwned: app.run.trucks.length,
    truckPrice: truck?.price ?? 0,
    roomPrice: room?.price ?? 0,
    grew,
  };
  hold(app, ' ');
  if (app.morning.day !== day + 1) throw new Error(`day ${day} did not end`);
  return stat;
}

// ------------------------------------------------------------------ the desk
/** ENTER on every line, ENTER on the truck the cursor is on, a step down when it is too full. */
function blindDesk(app: App, press: Press): void {
  const tried = new Set<number>();
  while (app.desk.unfinishedCount() > 0 && !tried.has(app.orderSel)) {
    const o = app.orderSel;
    tried.add(o);
    press(...Array(app.desk.order(o).lines.length).fill('Enter'));
    pickAnyTruck(app, press, o);
    if (!app.desk.isFinished(o)) skipOrder(app, press);
  }
}

/** ENTER on the truck cursor; when it is too full, the next one down, and back up from the bottom. */
function pickAnyTruck(app: App, press: Press, o: number): void {
  const last = app.morning.trucks.length - 1;
  for (let n = 0; n <= last * 2 + 1 && !app.desk.isFinished(o); n++) {
    if (app.pane !== 'trucks') return;
    press('Enter');
    if (app.desk.isFinished(o)) return;
    press(app.truckSel < last ? 'ArrowDown' : 'ArrowUp');
  }
}

/** Leaves an order that no truck could take and moves to the next one. */
function skipOrder(app: App, press: Press): void {
  while (app.pane !== 'orders') press('Tab');
  press('ArrowDown', 'Enter');
}

function goToOrder(app: App, press: Press, o: number): void {
  while (app.pane !== 'orders') press('Tab');
  while (app.orderSel < o) press('ArrowDown');
  while (app.orderSel > o) press('ArrowUp');
  press('Enter');
}

function pickTruck(app: App, press: Press, truckId: number): void {
  const at = app.morning.trucks.findIndex((t) => t.id === truckId);
  press(...Array(app.morning.trucks.length).fill('ArrowUp'), ...Array(at).fill('ArrowDown'), 'Enter');
}

/** What to give on every line: as asked, except that a short item goes whole to as few clients as can be, those short before first. */
function shareOut(app: App): number[][] {
  const { orders, stock } = app.morning;
  const gives = orders.map((o) => o.lines.map((l) => l.asked));
  for (const item of app.morning.items) {
    const askers = orders.flatMap((o, oi) => o.lines.flatMap((l, li) => (l.item === item.id ? [{ oi, li, asked: l.asked }] : [])));
    let left = stock[item.id] ?? 0;
    if (askers.reduce((sum, a) => sum + a.asked, 0) <= left) continue;
    const before = (oi: number) => (shortYesterday(app.run.history[orders[oi]!.client]) ? 0 : 1);
    askers.sort((a, b) => before(a.oi) - before(b.oi) || a.asked - b.asked || a.oi - b.oi);
    for (const a of askers) {
      const give = Math.min(a.asked, left);
      gives[a.oi]![a.li] = give;
      left -= give;
    }
  }
  return gives;
}

type Stop = { orderId: number; place: App['morning']['orders'][number]['place'] };

/** Every order on the truck that adds least to what the trucks cost, the biggest orders first; then keyed in as a player would. */
function carefulDesk(app: App, press: Press): void {
  const { orders, trucks } = app.morning;
  const size = new Map(app.morning.items.map((i) => [i.id, i.size]));
  const gives = shareOut(app);
  const space = (o: number) => orders[o]!.lines.reduce((sum, l, li) => sum + gives[o]![li]! * (size.get(l.item) ?? 1), 0);
  const used = new Map(trucks.map((t) => [t.id, 0]));
  const stops = new Map(trucks.map((t) => [t.id, [] as Stop[]]));
  const squares = (id: number, extra?: Stop) => planRoute([...stops.get(id)!, ...(extra ? [extra] : [])], 0).squares;
  const plan = new Map<number, number>();
  const sequence = orders.map((_, o) => o).sort((a, b) => space(b) - space(a) || a - b);
  for (const o of sequence) {
    // An order too big for any truck is trimmed, the biggest line first, until the roomiest truck takes it.
    const roomiest = Math.max(...trucks.map((t) => t.capacity - used.get(t.id)!));
    const spaceOfLine = (li: number) => gives[o]![li]! * (size.get(orders[o]!.lines[li]!.item) ?? 1);
    while (space(o) > roomiest) {
      const biggest = gives[o]!.reduce((best, _, li) => (spaceOfLine(li) > spaceOfLine(best) ? li : best), 0);
      gives[o]![biggest] = Math.max(0, gives[o]![biggest]! - 1);
    }
    const own = space(o);
    let best: { id: number; cost: number; spare: number } | null = null;
    for (const t of trucks) {
      const spare = t.capacity - used.get(t.id)! - own;
      if (spare < 0) continue;
      const stop = { orderId: o, place: orders[o]!.place };
      const now = stops.get(t.id)!.length > 0 ? truckCost(squares(t.id)) : 0;
      const cost = own === 0 ? 0 : truckCost(squares(t.id, stop)) - now;
      if (!best || cost < best.cost || (cost === best.cost && spare < best.spare)) best = { id: t.id, cost, spare };
    }
    const truck = best?.id ?? trucks[0]!.id;
    plan.set(o, truck);
    used.set(truck, used.get(truck)! + own);
    if (own > 0) stops.get(truck)!.push({ orderId: o, place: orders[o]!.place });
  }
  for (const o of sequence) {
    goToOrder(app, press, o);
    orders[o]!.lines.forEach((_, li) => press(...String(gives[o]![li]).split(''), 'Enter'));
    if (app.pane === 'trucks') pickTruck(app, press, plan.get(o)!);
    if (!app.desk.isFinished(o) && app.pane === 'trucks') pickAnyTruck(app, press, o);
  }
}

// ------------------------------------------------------------------ the supplier order
const marginPerSpace = (item: string): number => (clientPrice(item) - supplierPrice(item)) / spaceOf(item);
const marginPerPound = (item: string): number => (clientPrice(item) - supplierPrice(item)) / supplierPrice(item);

/** Whether the growth rule asks for a truck tonight, which leaves tomorrow's usual amounts as they are. */
function wantsTruck(app: App, load: number): boolean {
  return load >= TRUCK_LOAD && app.cash >= growthPrice({ kind: 'truck' }, app.run.clients.length);
}

/** Takes one unit off the row, among those satisfying `of`, that earns least by `worth`. Returns false if there is none. */
function giveUpOne(app: App, of: (r: number) => boolean, worth: (item: string) => number): number {
  const supply = app.supply!;
  let worst = -1;
  supply.rows.forEach((row, r) => {
    if (supply.amount(r) === 0 || !of(r)) return;
    if (worst < 0 || worth(row.item.id) < worth(supply.rows[worst]!.item.id)) worst = r;
  });
  if (worst >= 0) supply.nudge(worst, -1);
  return worst;
}

/**
 * Orders what tomorrow needs: the usual amounts, what the notes say will be different, and what was promised on the
 * phone, less what is on hand. What a room cannot hold, and what the bank cannot pay for, is given up, the stock that
 * earns least first; then a little extra goes in where there is space. The amounts are keyed in, row by row.
 */
function carefulSupply(app: App, press: Press, newClient: boolean): RoomNeeds {
  const supply = app.supply!;
  const clients = app.run.clients.length;
  const usual = { ...app.run.usual };
  if (newClient) for (const [item, n] of Object.entries(usual)) usual[item] = n + Math.round(n / clients);
  const swing = new Map<string, number>();
  for (const s of swings(supply.ahead, usual, clients)) swing.set(s.item, (swing.get(s.item) ?? 0) + s.units);
  const promised = new Map<string, number>();
  for (const p of promisesFrom(app.calls, app.answers)) promised.set(p.item, (promised.get(p.item) ?? 0) + p.qty);
  const need = supply.rows.map((row) => Math.round((usual[row.item.id] ?? 0) + (swing.get(row.item.id) ?? 0)) + (promised.get(row.item.id) ?? 0));
  supply.rows.forEach((row, r) => supply.set(r, Math.max(0, need[r]! - row.onHand)));

  const needs: RoomNeeds = { lost: { freezer: 0, fridge: 0, dry: 0 }, fill: { freezer: 0, fridge: 0, dry: 0 } };
  for (const kept of KEPT_ORDER) {
    const used = supply.rows.reduce((sum, row, r) => sum + (row.kept === kept ? need[r]! * spaceOf(row.item.id) : 0), 0);
    needs.fill[kept] = used / supply.roomSpace(kept).capacity;
    while (supply.roomSpace(kept).spoils > 0) {
      const r = giveUpOne(app, (i) => supply.rows[i]!.kept === kept, marginPerSpace);
      if (r < 0) break;
      const item = supply.rows[r]!.item.id;
      needs.lost[kept] += clientPrice(item) - supplierPrice(item);
    }
  }
  const bank = Math.max(0, app.cash);
  while (supply.totalCost() > bank && giveUpOne(app, () => true, marginPerPound) >= 0);

  const byWorth = supply.rows.map((_, r) => r).sort((a, b) => marginPerSpace(supply.rows[b]!.item.id) - marginPerSpace(supply.rows[a]!.item.id));
  for (const r of byWorth) {
    const row = supply.rows[r]!;
    for (let k = 0; k < Math.ceil(need[r]! * BUFFER); k++) {
      supply.nudge(r, 1);
      if (supply.roomSpace(row.kept).spoils > 0 || supply.totalCost() > bank) {
        supply.nudge(r, -1);
        break;
      }
    }
  }
  supply.rows.forEach((_, r) => {
    const amount = supply.amount(r);
    supply.set(r, 0);
    while (app.supplySel < r) press('ArrowDown');
    while (app.supplySel > r) press('ArrowUp');
    if (amount > 0) press(...String(amount).split(''));
  });
  return needs;
}

// ------------------------------------------------------------------ growth
function choose(app: App, policy: Policy, load: number, needs: RoomNeeds | null): 'truck' | 'room' | 'client' {
  const [truck, room] = app.growthOptions;
  const reserve = policy === 'careful' ? app.day!.money.supplier * RESERVE : 0;
  const can = (o: typeof truck) => !!o?.affordable && app.cash - o.price >= reserve;
  if (load >= TRUCK_LOAD && can(truck)) return 'truck';
  if (needs && room?.growth.kind === 'room' && can(room)) {
    const kept = room.growth.room;
    if (needs.lost[kept] > 0 || needs.fill[kept] >= ROOM_FULL) return 'room';
  }
  return 'client';
}

// ------------------------------------------------------------------ results
export interface Summary {
  profit: number;
  /** The cash at the end of each run, on average. */
  cash: number;
  /** The least cash any run had after a day was settled. */
  minCash: number;
  inFull: number;
  pleased: number;
  stranded: number;
  squares: number;
  trucks: number;
  load: number;
  spoiled: number;
  clients: number;
  trucksOwned: number;
}

const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

/** The median of a list of numbers. */
export const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

/** Averages over all the runs, from day `from` of each on (the first day is 1). */
export function summarise(runs: DayStat[][], from = 1): Summary {
  const all = runs.flatMap((r) => r.filter((d) => d.day >= from));
  return {
    profit: mean(all.map((d) => d.profit)),
    cash: mean(runs.map((r) => r.at(-1)!.cash)),
    minCash: Math.min(...runs.map((r) => Math.min(...r.map((d) => d.cash)))),
    inFull: mean(all.map((d) => d.inFull / d.orders)),
    pleased: mean(all.map((d) => d.pleased / d.orders)),
    stranded: mean(all.map((d) => d.stranded)),
    squares: mean(all.map((d) => d.squares)),
    trucks: mean(all.map((d) => d.trucks)),
    load: mean(all.map((d) => d.load)),
    spoiled: mean(all.map((d) => d.spoiled)),
    clients: mean(runs.map((r) => r.at(-1)!.clients)),
    trucksOwned: mean(runs.map((r) => r.at(-1)!.trucksOwned)),
  };
}
