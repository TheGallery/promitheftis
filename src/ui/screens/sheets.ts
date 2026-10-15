import { shortReason } from '../../game/breakdown';
import { DEPART_MINUTE, formatTime } from '../../game/clock';
import { formatMoney, PRICES, truckCost } from '../../game/money';
import { place } from '../../game/places';
import { arrivalText, plural, placesLabel } from '../format';
import type { App } from '../app';
import { bar, cat, clip, COLS, cols, header, keyBar, layout, rule, s, scrollRows, type Line } from '../grid';
import { clockLine } from './common';

const LIST_W = 86;
const SIDE_W = 33;

export function departureOf(app: App): number {
  return Math.max(DEPART_MINUTE, app.desk.clock);
}

/** A client who asked for a time, and whether the truck that goes to them is expected to be late, and by how much. */
interface Timed {
  client: string;
  late: boolean;
  minutes: number;
}

/** The clients of a truck who asked for a time, in the order the truck reaches them. */
function timedOn(app: App, truckId: number): Timed[] {
  const d = app.desk;
  const out: Timed[] = [];
  for (const v of d.routeOf(truckId, departureOf(app)).visits) {
    for (const stop of v.stops) {
      const order = d.order(stop.orderId);
      if (order.before == null) continue;
      const { late, minutes } = arrivalText(stop.arriveAt, order.before);
      out.push({ client: order.client, late, minutes });
    }
  }
  return out;
}

function truckRows(app: App): { rows: Line[]; selectedRow: number } {
  const d = app.desk;
  const departAt = departureOf(app);
  const rows: Line[] = [];
  let selectedRow = 0;
  d.morning.trucks.forEach((t, i) => {
    const open = app.sheetOpen.has(i);
    const selected = i === app.sheetSel;
    if (selected) selectedRow = rows.length;
    const stops = d.stopsOf(t.id);
    const pct = Math.round(d.fullness(t.id) * 100);
    const used = stops.length > 0;
    const route = d.routeOf(t.id, departAt);
    const cls = selected ? 'hl' : used ? '' : 'd';
    const garage = d.inGarage(t.id);
    const lateStops = timedOn(app, t.id).filter((x) => x.late).length;
    rows.push(
      cat(
        s(` ${open ? '▾' : '▸'} ${t.id} ${t.driver.padEnd(6)}${t.kind.padEnd(13)} `, cls),
        garage ? s('at the garage'.padEnd(8 + 7), selected ? 'w hl' : 'w') : cat(bar(pct, 8, selected ? 'hl' : ''), s(` ${String(pct).padStart(3)}%  `, cls)),
        s((garage ? clip(shortReason(d.morning.garage?.reason ?? ''), 19) : used ? placesLabel(route.visits.map((v) => v.place), 19) : 'not used').padEnd(20), `${used ? 'acc' : 'd'}${selected ? ' hl' : ''}`),
        s(' ', cls),
        s(lateStops > 0 ? '✗' : ' ', lateStops > 0 ? `w ${cls}`.trim() : cls),
        s(
          `${String(stops.length).padStart(3)}${(used ? String(route.squares) : '—').padStart(4)}${(used ? formatMoney(truckCost(route.squares)) : '—').padStart(6)}` +
            `${(used ? `~${formatTime(route.backAt)}` : '—').padStart(9)} `,
          cls,
        ),
      ),
    );
    if (open) {
      const arrivals = new Map(route.visits.flatMap((v) => v.stops.map((x) => [x.orderId, x.arriveAt] as const)));
      stops.forEach((o, n) => {
        const order = d.order(o);
        const units = d.unitsGiven(o);
        const arrival = arrivalText(arrivals.get(o) ?? departAt, order.before);
        rows.push(
          cat(
            s(`       ${n + 1}  ${clip(order.client, 17).padEnd(18)}${place(order.place).name.padEnd(11)}${(plural(units, 'item')).padStart(9)}`, used ? '' : 'd'),
            order.before != null
              ? cat(s(`  before ${formatTime(order.before)} · `), s(arrival.text, arrival.late ? 'w' : 'acc'))
              : s(`  ${arrival.text}`, 'd'),
          ),
        );
      });
      if (!used) rows.push(s(garage ? '       at the garage, back tomorrow' : '       nothing loaded', 'd'));
    }
  });
  return { rows, selectedRow };
}

function routePanel(app: App): Line[] {
  const d = app.desk;
  const t = d.morning.trucks[app.sheetSel];
  if (!t) return [];
  if (!app.sheetOpen.has(app.sheetSel)) {
    return [s(' ROUTE', 'b'), [], s(' ENTER opens a truck and', 'd'), s(' shows where it goes.', 'd')];
  }
  const route = d.routeOf(t.id, departureOf(app));
  if (d.inGarage(t.id)) {
    return [s(` TRUCK ${t.id} · ROUTE`, 'b'), [], s(' At the garage with', 'w'), s(` ${d.morning.garage?.reason}.`, 'w'), s(' Back tomorrow.', 'd'), s(' It costs nothing today.', 'd')];
  }
  const out: Line[] = [s(` TRUCK ${t.id} · ROUTE`, 'b'), [], s(' depot (Saltmarket)', 'd')];
  if (route.visits.length === 0) return [...out, s('   │'), s(' nothing to deliver', 'd')];
  for (const v of route.visits) {
    out.push(s('   │'));
    out.push(cat(s(` ${place(v.place).name}`, 'acc'), s(`   ${plural(v.stops.length, 'stop')} · ~${formatTime(v.arriveAt)}`)));
    for (const stop of v.stops) {
      const order = d.order(stop.orderId);
      if (order.before == null) continue;
      const { late } = arrivalText(stop.arriveAt, order.before);
      out.push(cat(s(`   ${late ? '✗' : '✓'} `, late ? 'w' : 'acc'), s(`${clip(order.client, 14).padEnd(14)} before ${formatTime(order.before)}`, late ? 'w' : 'd')));
    }
  }
  out.push(s('   │'), s(` back at the depot ~${formatTime(route.backAt)}`, 'd'), []);
  out.push(s(` ${plural(route.squares, 'square')} driven`), s(` ${formatMoney(PRICES.truckDriver)} driver + ${formatMoney(route.squares * PRICES.truckPerSquare)} road`, 'd'));
  out.push(cat(s(' costs '), s(formatMoney(truckCost(route.squares)), 'b')));
  return out;
}

/**
 * One line on the clients who asked for a time across all the trucks: that they are all reached in time, or which ones
 * are late and by how much, since a late one pays half.
 */
function deadlineLine(app: App): Line {
  const d = app.desk;
  const asked = d.morning.orders.filter((o) => o.before != null).length;
  const all = d.morning.trucks.flatMap((t) => timedOn(app, t.id));
  const late = all.filter((x) => x.late).sort((a, b) => b.minutes - a.minutes);
  const label = s(' DEADLINES  ', 'b');
  if (asked === 0) return cat(label, s('nobody asked for a time today.', 'd'));
  if (all.length === 0) return cat(label, s(`${plural(asked, 'client')} asked for a time, and none has a truck yet.`, 'd'));
  if (late.length === 0) return cat(label, s(all.length === 1 ? 'the one timed client is reached in time.' : `all ${all.length} timed clients are reached in time.`, 'acc'));
  const head = `${late.length} of ${all.length} timed ${all.length === 1 ? 'client' : 'clients'} would be late and pay half: `;
  const room = COLS - 12 - 1 - head.length;
  const parts = late.map((x) => `${x.client} ${x.minutes} min`);
  let shown = parts.length;
  const text = (n: number) => parts.slice(0, n).join(', ') + (n < parts.length ? `${n > 0 ? ', ' : ''}+${parts.length - n} more` : '');
  while (shown > 1 && text(shown).length > room) shown--;
  const names = text(shown);
  return cat(label, s(clip(`${head}${names}`, COLS - 13), 'w'));
}

export function sheetsScreen(app: App): Line[] {
  const d = app.desk;
  const top = header('TRUCK SHEETS', clockLine(app.morning.day, d.clock, true, app.cash));
  const { rows, selectedRow } = truckRows(app);
  const head = s(`   ${'TRUCK'.padEnd(22)}${'FULL'.padEnd(15)}${'GOES TO'.padEnd(20)}${'STOPS'.padStart(5)}${'SQ'.padStart(4)}${'COST'.padStart(6)}${'BACK'.padStart(9)}`, 'd');
  const visible = scrollRows(rows, selectedRow, 22);
  const left: Line[] = [head, ...visible];
  const right = routePanel(app);
  const n = Math.max(left.length, right.length);
  const body: Line[] = [];
  for (let i = 0; i < n; i++) body.push(cols([left[i] ?? [], right[i] ?? []], [LIST_W, SIDE_W]));

  const crews = app.morning.crews.map((c) => `${c.names.join(', ')} → ${c.trucks.join(' ')}`).join('  ·  ');
  const loading = cat(s(' LOADING  ', 'b'), s(crews), s('        STORE ROOM  ', 'b'), s(app.morning.storeRoom.join(', ')));
  let status: Line = [];
  if (app.printing) {
    status = s(` Printing… ${app.printing.done} of ${app.printing.total} lines`, 'acc');
  } else if (app.status) {
    status = s(` ${app.status}`, app.tone === 'warn' ? 'w' : 'acc');
  } else if (app.printed) {
    status = s(' Truck sheets printed.', 'acc');
  } else {
    const cost = d.morning.trucks.reduce((sum, t) => sum + (d.stopsOf(t.id).length > 0 ? truckCost(d.routeOf(t.id, departureOf(app)).squares) : 0), 0);
    status = s(` Sending these trucks costs ${formatMoney(cost)}: the driver and the road, by the squares driven.`, 'd');
  }
  const footer = [
    rule(),
    loading,
    deadlineLine(app),
    status,
    keyBar([
      ['SPACE', 'hold: send trucks'], ['↑↓', 'truck'], ['ENTER', 'open/close'], ['+ -', 'all'], ['P', 'print'],
      ['ESC', 'desk'], ['H', 'how to play'], ['F2', 'colours'], ['F4', 'sound'],
    ]),
  ];
  return layout(top, body, footer);
}
