import { DEPART_MINUTE, formatTime } from '../../game/clock';
import { place } from '../../game/places';
import { plural, placesLabel } from '../format';
import type { App } from '../app';
import { bar, cat, clip, cols, header, keyBar, layout, rule, s, scrollRows, type Line } from '../grid';
import { clockLine } from './common';

const LIST_W = 83;
const SIDE_W = 36;

export function departureOf(app: App): number {
  return Math.max(DEPART_MINUTE, app.desk.clock);
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
    rows.push(
      cat(
        s(` ${open ? '▾' : '▸'} ${t.id} ${t.driver.padEnd(6)}${t.kind.padEnd(13)} `, cls),
        bar(pct, 12, selected ? 'hl' : ''),
        s(` ${String(pct).padStart(3)}%  `, cls),
        s((used ? placesLabel(route.visits.map((v) => v.place), 19) : 'not used').padEnd(20), `${used ? 'acc' : 'd'}${selected ? ' hl' : ''}`),
        s(`${String(stops.length).padStart(5)}${(used ? `~${formatTime(route.backAt)}` : '—').padStart(9)} `, cls),
      ),
    );
    if (open) {
      stops.forEach((o, n) => {
        const order = d.order(o);
        const units = d.unitsGiven(o);
        rows.push(
          s(
            `       ${n + 1}  ${clip(order.client, 20).padEnd(20)}${place(order.place).name.padEnd(10)}${(plural(units, 'item')).padStart(9)}`,
            used ? '' : 'd',
          ),
        );
      });
      if (!used) rows.push(s('       nothing loaded', 'd'));
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
  const out: Line[] = [s(` TRUCK ${t.id} · ROUTE`, 'b'), [], s(' depot (Town)', 'd')];
  if (route.visits.length === 0) return [...out, s('   │'), s(' nothing to deliver', 'd')];
  for (const v of route.visits) {
    out.push(s('   │'));
    out.push(cat(s(` ${place(v.place).name}`, 'acc'), s(`   ${plural(v.stops.length, 'stop')} · ~${formatTime(v.arriveAt)}`)));
  }
  out.push(s('   │'), s(` back at the depot ~${formatTime(route.backAt)}`, 'd'));
  return out;
}

export function sheetsScreen(app: App): Line[] {
  const d = app.desk;
  const top = header('TRUCK SHEETS', clockLine(d.clock, true));
  const { rows, selectedRow } = truckRows(app);
  const head = s(`   ${'TRUCK'.padEnd(22)}${'FULL'.padEnd(19)}${'GOES TO'.padEnd(20)}${'STOPS'.padStart(5)}${'BACK'.padStart(9)}`, 'd');
  const visible = scrollRows(rows, selectedRow, 23);
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
  }
  const footer = [
    rule(),
    loading,
    status,
    keyBar([
      ['↑↓', 'truck'], ['ENTER', 'open / close'], ['+ -', 'open / close all'], ['P', 'print sheets'],
      ['ESC', 'desk'], ['F9', 'send the trucks'], ['F2', 'colours'], ['F4', 'sound'],
    ]),
  ];
  return layout(top, body, footer);
}
