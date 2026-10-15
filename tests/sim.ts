import type { Call } from '../src/game/calls';
import { isAway, isBack, isWarned } from '../src/game/churn';
import { DEPART_MINUTE, START_MINUTE, weekdayOf } from '../src/game/clock';
import { usualWith } from '../src/game/clients';
import { isTownEvent, weekFactor } from '../src/game/daysize';
import { swings } from '../src/game/demand';
import { shortYesterday } from '../src/game/history';
import { clientPrice, LATE_PAYS, supplierPrice, truckCost, truckPrice } from '../src/game/money';
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
 *   is too full or at the garage), the first answer to every call, and A on the supplier order.
 * - `careful` does the same work with its head: it shares a short item out (whatever made it short: a big day, or a supplier
 *   that left part of the order behind) so that as few clients as possible go short, those promised it on the phone first,
 *   plans the trucks against the times clients asked for (each order goes on the truck where it adds least to the road and
 *   to what coming late takes off, and the plan is looked over again), orders what the notes say tomorrow will need and no more
 *   than the rooms hold or the bank can pay for, and buys a room when the rooms are costing it sales. When the overnight
 *   notes say a client may ring for a rush order it keeps that much of the item back at the desk, and on the phone sends the
 *   truck that earns most (what the order pays less what the trip costs), or says no when none would.
 *
 * What to grow is a separate rule, so that the rules can be set against each other with the same careful desk:
 * - `first` presses ENTER on whatever is highlighted: the truck, and when it cannot be paid for the next one down.
 * - `client` and `truck` always take a new client, or a truck when it can be paid for and a client when it cannot.
 * - `screen` reads the growth screen: a truck when the trucks were full and one can be paid for with a cushion left,
 *   a bigger room when the rooms are costing sales, otherwise the new client.
 * Blind play uses `first` and careful play `screen`, unless the run says otherwise.
 * On a morning with a truck at the garage the blind desk meets the warning and moves down a truck, and the careful desk plans
 * on the trucks that are there, trimming the orders the others cannot carry. A client let down two days running is marked on the
 * desk: blind play does not look, and a careful player serves those clients first, from the scarce stock and on the trucks that
 * reach them in time, and sends a truck for their rush order even at a loss. Everything chance decides comes from the seed, so the same seed always plays the same days.
 */
export type Policy = 'blind' | 'careful';
export type GrowthRule = 'first' | 'client' | 'truck' | 'screen';

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
  /** Units all the orders together asked for. */
  asked: number;
  /** Orders that got no truck. */
  stranded: number;
  /** Orders that asked for a time, and of those the ones the truck reached too late. */
  timed: number;
  late: number;
  /** What the late orders paid less than they would have on time. */
  lateCut: number;
  /** Squares the trucks drove. */
  squares: number;
  /** Share of all the truck space that was loaded when the trucks left, 0 to 1. */
  load: number;
  /** True when a truck was at the garage that morning. */
  garage: boolean;
  /** Units that spoiled in the rooms overnight, at the start of this day. */
  spoiled: number;
  /** True when the supplier left part of the night's delivery behind, so that the morning began with an item short. */
  supplierShort: boolean;
  /** How a rush order went: `none` on a morning with no rush, otherwise whether a truck took it in time, late, or none did. */
  rush: 'none' | 'on time' | 'late' | 'turned down';
  /** What the rush order paid, and what its trip cost; nothing when no truck took it. */
  rushPaid: number;
  rushCost: number;
  /** The day of the week of the morning, 0 for Sunday. */
  weekday: number;
  /** True when a town event the night before announced made some clients ask for more this morning. */
  town: boolean;
  /** How many clients were closed this morning and sent no order. */
  closed: number;
  clients: number;
  trucksOwned: number;
  /** Orders that morning from a client let down two days running, and how many of those ended the day pleased. */
  warned: number;
  warnedPleased: number;
  /** Clients who began a break, and who went for good, on that morning; and how many sent no order, and how many were back. */
  breaks: number;
  gone: number;
  away: number;
  back: number;
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
/** A careful player counts a late truck for a client let down two days running this many times as dear. */
const WARNED_LATE = 6;
/** A careful player looks over the plan this many times, moving an order to a better truck. */
const ROUNDS = 2;

export function playRun(kind: 'small' | 'big', policy: Policy, seed: number, days: number, rule: GrowthRule = policy === 'blind' ? 'first' : 'screen'): DayStat[] {
  const random = mulberry32(seed * 7919 + 13);
  const app = new App(fakeEffects([], random, memoryStore()), () => {}, kind);
  const out: DayStat[] = [];
  for (let d = 0; d < days; d++) out.push(playDay(app, policy, rule));
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

function playDay(app: App, policy: Policy, rule: GrowthRule): DayStat {
  const press: Press = (...keys) => keys.forEach((key) => app.press({ key }));
  const day = app.morning.day;
  const spoiled = app.run.spoiled.reduce((sum, s) => sum + s.units, 0);
  const supplierShort = app.run.short.length > 0;
  const town = app.run.ahead.some((a) => isTownEvent(a.event));
  const { standing, news } = app.run;
  const away = app.run.clients.filter((c) => isAway(standing, c.name)).length;
  const back = app.run.clients.filter((c) => isBack(standing, c.name)).length;
  const closed = app.run.clients.length - away - app.morning.orders.length;
  const warned = app.morning.orders.filter((o) => isWarned(standing, o.client)).map((o) => o.client);
  if (app.screen === 'messages') press(' ');
  if (policy === 'blind') blindDesk(app, press);
  else carefulDesk(app, press);

  // A truck at the garage has no space to give, so it is left out of how full the trucks were.
  const free = app.morning.trucks.filter((t) => !app.desk.inGarage(t.id));
  const capacity = free.reduce((sum, t) => sum + t.capacity, 0);
  const load = free.reduce((sum, t) => sum + app.desk.load(t.id), 0) / capacity;
  const garage = app.morning.garage != null;
  press(' ');
  hold(app, ' ');
  for (let n = 0; n < 100 && !app.roadOver; n++) {
    const call = app.roadCall;
    if (call && policy === 'careful') press(...Array(carefulAnswer(call, isWarned(app.run.standing, call.client))).fill('ArrowDown'));
    press(call ? 'Enter' : ' ');
  }
  press(' ', ' ');

  let needs: RoomNeeds | null = null;
  if (policy === 'blind') press('a');
  else needs = carefulSupply(app, press, !wantsTruck(app, rule, load));
  hold(app, ' ');

  const summary = app.day!;
  const result = app.result!;
  const [truck, room] = app.growthOptions;
  press(' ');
  const grew = choose(app, press, rule, load, needs);
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
    asked: app.morning.orders.reduce((sum, o) => sum + o.lines.reduce((n, l) => n + l.asked, 0), 0),
    stranded: result.orders.filter((o) => o.truckId == null).length,
    timed: result.orders.filter((o) => o.before != null).length,
    late: result.orders.filter((o) => o.lateForAsk).length,
    lateCut: summary.money.lateCut,
    squares: summary.money.squares,
    load,
    garage,
    spoiled,
    supplierShort,
    rush: rushOutcome(app),
    rushPaid: result.rush?.paid ?? 0,
    rushCost: result.rush?.cost ?? 0,
    weekday: weekdayOf(day),
    town,
    closed,
    clients: app.run.clients.length,
    trucksOwned: app.run.trucks.length,
    warned: warned.length,
    warnedPleased: summary.orders.filter((o) => warned.includes(o.client) && o.mood === 'pleased').length,
    breaks: news.filter((n) => n.kind === 'break').length,
    gone: news.filter((n) => n.kind === 'gone').length,
    away,
    back,
    truckPrice: truck?.price ?? 0,
    roomPrice: room?.price ?? 0,
    grew,
  };
  hold(app, ' ');
  if (app.morning.day !== day + 1) throw new Error(`day ${day} did not end`);
  return stat;
}

/** How the morning's rush order went, by what the answer on the phone sent. */
function rushOutcome(app: App): DayStat['rush'] {
  if (!app.morning.rush) return 'none';
  const trip = app.result?.rush;
  return trip ? (trip.late ? 'late' : 'on time') : 'turned down';
}

/**
 * The answer on the phone that earns most: for a rush order, the truck whose trip pays most over what it costs, or no if none pays.
 * A client let down two days running is sent a truck that gets there in time even at a loss, since a no or a late truck would
 * let them down a third day.
 */
function carefulAnswer(call: Call, warned: boolean): number {
  if (call.kind !== 'rush') return 0;
  const net = (o: Call['options'][number]) => (o.rush ? o.rush.paid - o.rush.cost : 0);
  const onTime = (o: Call['options'][number]) => (warned && o.rush && !o.rush.late ? 1 : 0);
  let best = call.options.length - 1;
  call.options.forEach((o, i) => {
    if (onTime(o) > onTime(call.options[best]!) || (onTime(o) === onTime(call.options[best]!) && net(o) > net(call.options[best]!))) best = i;
  });
  return best;
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

/**
 * What to give on every line: as asked, except that a short item goes whole to as few clients as can be, those promised it
 * first, then those let down two days running, then those short before.
 */
function shareOut(app: App): number[][] {
  const { orders, stock, rush } = app.morning;
  const gives = orders.map((o) => o.lines.map((l) => l.asked));
  for (const item of app.morning.items) {
    const askers = orders.flatMap((o, oi) => o.lines.flatMap((l, li) => (l.item === item.id ? [{ oi, li, asked: l.asked }] : [])));
    // What a client may ring for in a rush is kept back first.
    let left = Math.max(0, (stock[item.id] ?? 0) - (rush?.item === item.id ? rush.qty : 0));
    if (askers.reduce((sum, a) => sum + a.asked, 0) <= left) continue;
    const promised = (oi: number) => (app.run.promises.some((p) => p.client === orders[oi]!.client && p.item === item.id) ? 0 : 1);
    const warned = (oi: number) => (isWarned(app.run.standing, orders[oi]!.client) ? 0 : 1);
    const before = (oi: number) => (shortYesterday(app.run.history[orders[oi]!.client]) ? 0 : 1);
    askers.sort((a, b) => promised(a.oi) - promised(b.oi) || warned(a.oi) - warned(b.oi) || before(a.oi) - before(b.oi) || a.asked - b.asked || a.oi - b.oi);
    for (const a of askers) {
      const give = Math.min(a.asked, left);
      gives[a.oi]![a.li] = give;
      left -= give;
    }
  }
  return gives;
}

type Stop = { orderId: number; place: App['morning']['orders'][number]['place'] };

/**
 * Every order on the truck that adds least to what the trucks cost and to what coming late takes off, the clients who
 * asked for a time first and then the biggest orders; then keyed in as a player would. The trucks leave when the last
 * order has been handed out, two minutes an order, which is when the plan is judged.
 */
function carefulDesk(app: App, press: Press): void {
  const { orders } = app.morning;
  const trucks = app.morning.trucks.filter((t) => !app.desk.inGarage(t.id));
  const size = new Map(app.morning.items.map((i) => [i.id, i.size]));
  const gives = shareOut(app);
  const space = (o: number) => orders[o]!.lines.reduce((sum, l, li) => sum + gives[o]![li]! * (size.get(l.item) ?? 1), 0);
  const worth = (o: number) => orders[o]!.lines.reduce((sum, l, li) => sum + gives[o]![li]! * clientPrice(l.item), 0);
  const departAt = Math.max(DEPART_MINUTE, START_MINUTE + 2 * orders.length);
  const used = new Map(trucks.map((t) => [t.id, 0]));
  const stops = new Map(trucks.map((t) => [t.id, [] as Stop[]]));
  const squares = (id: number, extra?: Stop) => planRoute([...stops.get(id)!, ...(extra ? [extra] : [])], 0).squares;
  /** What the clients on a truck who would be reached after the time they asked for stop paying. */
  const lost = (id: number, extra?: Stop) => {
    const all = [...stops.get(id)!, ...(extra ? [extra] : [])].sort((a, b) => a.orderId - b.orderId);
    let total = 0;
    for (const visit of planRoute(all, departAt).visits) {
      for (const stop of visit.stops) {
        const before = orders[stop.orderId]!.before;
        // A client let down two days running is not made late: a third bad day costs their orders for days.
        if (before != null && stop.arriveAt > before) total += worth(stop.orderId) * (1 - LATE_PAYS) * (isWarned(app.run.standing, orders[stop.orderId]!.client) ? WARNED_LATE : 1);
      }
    }
    return total;
  };
  const plan = new Map<number, number>();
  const asked = (o: number) => orders[o]!.before ?? Infinity;
  const sequence = orders.map((_, o) => o).sort((a, b) => asked(a) - asked(b) || space(b) - space(a) || a - b);
  const stopOf = (o: number): Stop => ({ orderId: o, place: orders[o]!.place });
  const put = (o: number) => {
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
      const now = stops.get(t.id)!.length > 0 ? truckCost(squares(t.id)) : 0;
      const cost = own === 0 ? 0 : truckCost(squares(t.id, stopOf(o))) - now + lost(t.id, stopOf(o)) - lost(t.id);
      if (!best || cost < best.cost || (cost === best.cost && spare < best.spare)) best = { id: t.id, cost, spare };
    }
    const truck = best?.id ?? trucks[0]!.id;
    plan.set(o, truck);
    used.set(truck, used.get(truck)! + own);
    if (own > 0) stops.get(truck)!.push(stopOf(o));
  };
  const take = (o: number) => {
    const truck = plan.get(o)!;
    used.set(truck, used.get(truck)! - space(o));
    stops.set(truck, stops.get(truck)!.filter((x) => x.orderId !== o));
  };
  for (const o of sequence) put(o);
  // A second look: each order is taken off its truck and put on the best one now that the others are placed.
  for (let round = 0; round < ROUNDS; round++) {
    for (const o of sequence) {
      take(o);
      put(o);
    }
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

/** What another truck would cost tonight. */
function truckBill(app: App): number {
  return truckPrice(app.run.clients.length, app.run.trucks.length);
}

/** Whether the growth rule asks for a truck tonight, which leaves tomorrow's usual amounts as they are. */
function wantsTruck(app: App, rule: GrowthRule, load: number): boolean {
  if (rule === 'client') return false;
  if (rule === 'screen' && load < TRUCK_LOAD) return false;
  return app.cash >= truckBill(app);
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
 * Orders what tomorrow needs: the usual amounts for the day of the week, what the notes and the overnight messages say will be different, and what was promised on the
 * phone, less what is on hand. What a room cannot hold, and what the bank cannot pay for, is given up, the stock that
 * earns least first; then a little extra goes in where there is space. The amounts are keyed in, row by row.
 */
function carefulSupply(app: App, press: Press, newClient: boolean): RoomNeeds {
  const supply = app.supply!;
  const clients = app.run.clients.length;
  const usual = { ...app.run.usual };
  if (newClient) Object.assign(usual, usualWith(usual, app.run.clients, {}));
  const swing = new Map<string, number>();
  for (const s of swings(supply.ahead, usual, clients)) swing.set(s.item, (swing.get(s.item) ?? 0) + s.units);
  const promised = new Map<string, number>();
  for (const p of promisesFrom(app.calls, app.answers)) promised.set(p.item, (promised.get(p.item) ?? 0) + p.qty);
  const week = weekFactor(supply.day + 1);
  const need = supply.rows.map((row) => Math.round((usual[row.item.id] ?? 0) * week + (swing.get(row.item.id) ?? 0)) + (promised.get(row.item.id) ?? 0));
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
/** Which of the three the rule takes tonight; `first` takes whichever it can pay for, top of the list first. */
function decide(app: App, rule: GrowthRule, load: number, needs: RoomNeeds | null): 'truck' | 'room' | 'client' {
  const [truck, room] = app.growthOptions;
  if (rule === 'client') return 'client';
  if (rule === 'truck' || rule === 'first') return truck?.affordable ? 'truck' : rule === 'first' && room?.affordable ? 'room' : 'client';
  const reserve = app.day!.money.supplier * RESERVE;
  const can = (o: typeof truck) => !!o?.affordable && app.cash - o.price >= reserve;
  if (load >= TRUCK_LOAD && can(truck)) return 'truck';
  if (needs && room?.growth.kind === 'room' && can(room)) {
    const kept = room.growth.room;
    if (needs.lost[kept] > 0 || needs.fill[kept] >= ROOM_FULL) return 'room';
  }
  return 'client';
}

/** Chooses what to grow on the growth screen, by the keys a player would press, and says what was chosen. */
function choose(app: App, press: Press, rule: GrowthRule, load: number, needs: RoomNeeds | null): 'truck' | 'room' | 'client' {
  const grew = decide(app, rule, load, needs);
  if (rule === 'first') {
    // ENTER on the first option; one that cannot be paid for says so, and the next one down is tried.
    for (let n = 0; n < app.growthOptions.length && !app.growth; n++) press('Enter', ...(app.growth ? [] : ['ArrowDown']));
  } else press(String(['truck', 'room', 'client'].indexOf(grew) + 1), 'Enter');
  return app.growth?.kind ?? grew;
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
  /** Orders a day that asked for a time, and how many of those came late. */
  timed: number;
  late: number;
  lateCut: number;
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

/** Averages over all the runs, from day `from` of each on (the first day is 1), over the days `only` takes if it is given. */
export function summarise(runs: DayStat[][], from = 1, only: (d: DayStat) => boolean = () => true): Summary {
  const all = runs.flatMap((r) => r.filter((d) => d.day >= from && only(d)));
  return {
    profit: mean(all.map((d) => d.profit)),
    cash: mean(runs.map((r) => r.at(-1)!.cash)),
    minCash: Math.min(...runs.map((r) => Math.min(...r.map((d) => d.cash)))),
    inFull: mean(all.map((d) => d.inFull / d.orders)),
    pleased: mean(all.map((d) => d.pleased / d.orders)),
    stranded: mean(all.map((d) => d.stranded)),
    timed: mean(all.map((d) => d.timed)),
    late: mean(all.map((d) => d.late)),
    lateCut: mean(all.map((d) => d.lateCut)),
    squares: mean(all.map((d) => d.squares)),
    trucks: mean(all.map((d) => d.trucks)),
    load: mean(all.map((d) => d.load)),
    spoiled: mean(all.map((d) => d.spoiled)),
    clients: mean(runs.map((r) => r.at(-1)!.clients)),
    trucksOwned: mean(runs.map((r) => r.at(-1)!.trucksOwned)),
  };
}
