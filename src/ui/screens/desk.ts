import { shortReason } from '../../game/breakdown';
import { WARN_MARK, warnMarker } from '../../game/churn';
import { place, PLACES, type PlaceId } from '../../game/places';
import { plainName, shortItems } from '../../game/headsup';
import { shortMarker } from '../../game/history';
import { formatTime } from '../../game/clock';
import { arrivalText, placesLabel } from '../format';
import type { App } from '../app';
import { bar, cat, clip, cols, header, keyBar, layout, pad, rule, s, scrollRows, wrapText, type Line } from '../grid';
import { clockLine, shortfallLines } from './common';

const ORDERS_W = 34;
const LINES_W = 43;
const TRUCKS_W = 41;
const BODY_ROWS = 24;

function paneTitle(name: string, lit: boolean, rest: Line): Line {
  return cat(s(` ${name} `, lit ? 'focus' : 'pane'), rest);
}

const LEGEND = ['! went short lately', '!! short two days running'];
const WARN_LEGEND = `${WARN_MARK} let down two days running`;

function ordersPane(app: App): Line[] {
  const d = app.desk;
  const lit = app.pane === 'orders';
  const out: Line[] = [
    paneTitle('ORDERS', lit, s(`  ${app.orderSel + 1} of ${d.orderCount}`, 'd')),
    s(`   ${''.padEnd(17)}${'PLACE'.padEnd(11)}TRK`, 'd'),
  ];
  const markers = d.morning.orders.map((o) => shortMarker(app.run.history[o.client]) + warnMarker(app.run.standing, o.client));
  const rows: Line[] = d.morning.orders.map((o, i) => {
    const current = i === app.orderSel;
    const mark = current ? '▶' : d.isFinished(i) ? '✓' : ' ';
    const truck = d.truckFor(i);
    const base = current ? 'hl' : d.isFinished(i) ? 'd' : '';
    const warn = current ? 'w hl' : 'w';
    const marker = markers[i] ?? '';
    // A marked client gives up the last three columns of its name's room to the marker.
    return cat(
      s(` ${mark} ${marker ? clip(o.client, 13).padEnd(14) : clip(o.client, 16).padEnd(17)}`, base),
      marker ? s(marker.padEnd(3), warn) : [],
      s(`${clip(place(o.place).name, 10).padEnd(11)}${truck ?? ''}`, base),
    );
  });
  const legend = [...(markers.some((m) => m.includes('!')) ? LEGEND : []), ...(markers.some((m) => m.includes(WARN_MARK)) ? [WARN_LEGEND] : [])].map((text) => s(` ${text}`, 'w'));
  out.push(...scrollRows(rows, app.orderSel, BODY_ROWS - out.length - legend.length), ...legend);
  return out;
}

function giveCell(app: App, l: number): Line {
  const d = app.desk;
  const o = app.orderSel;
  const given = d.given(o, l);
  const asked = d.order(o).lines[l]?.asked ?? 0;
  const editing = app.pane === 'lines' && l === app.lineSel;
  if (editing) {
    const shown = given == null ? '' : String(given);
    return s(`[${shown.padStart(2)}_]`.padStart(8), 'cur');
  }
  if (given == null) return s('·'.padStart(8), 'd');
  return s(String(given).padStart(8), given < asked ? 'w' : '');
}

function lineNotes(app: App): Line[] {
  const d = app.desk;
  const o = app.orderSel;
  const order = d.order(o);
  const line = order.lines[app.lineSel];
  if (!line) return [];
  const item = d.item(line.item);
  const name = plainName(item.name);
  const label = name.charAt(0).toUpperCase() + name.slice(1);
  const out: string[] = [];
  const onHand = d.onHand(o, app.lineSel);
  if (onHand < line.asked) out.push(`${label}: ${onHand} left, ${order.client} asked for ${line.asked}.`);
  const truck = d.truckFor(o);
  if (truck != null && d.maxGive(o, app.lineSel) < Math.min(line.asked, onHand)) {
    out.push(`Truck ${truck} has room for ${d.maxGive(o, app.lineSel)} of these.`);
  }
  const waiting = d.morning.orders.filter(
    (other, i) => i !== o && !d.isFinished(i) && other.lines.some((l) => l.item === line.item),
  ).length;
  if (waiting > 0) out.push(`${waiting} ${waiting === 1 ? 'order' : 'orders'} still to come ${waiting === 1 ? 'wants' : 'want'} ${name}.`);
  const notes = out.flatMap((t) => wrapText(t, 42));
  return notes.map((t, i) => s(` ${t}`, i === 0 && onHand < line.asked ? '' : 'd'));
}

function linesPane(app: App): Line[] {
  const d = app.desk;
  const o = app.orderSel;
  const order = d.order(o);
  const lit = app.pane === 'lines';
  const out: Line[] = [
    paneTitle('LINES', lit, s(`  order ${o + 1} of ${d.orderCount}`, 'd')),
    [],
    cat(s(` ${clip(order.client.toUpperCase(), 28)}`, 'b'), s(` · ${place(order.place).name}`, 'acc')),
  ];
  const who = order.note ? `${order.contact}: "${order.note}"` : order.contact;
  for (const row of wrapText(who, 42).slice(0, 2)) out.push(s(` ${row}`, 'd'));
  out.push([], s(`  ${'ITEM'.padEnd(19)}${'ASKED'.padStart(5)}${'ON HAND'.padStart(9)}${'GIVE'.padStart(8)}`, 'd'));
  order.lines.forEach((line, l) => {
    const current = l === app.lineSel;
    const base = `${current ? '▶ ' : '  '}${d.item(line.item).name.padEnd(19)}${String(line.asked).padStart(5)}${String(d.onHand(o, l)).padStart(9)}`;
    out.push(cat(s(base, current ? 'hl' : ''), giveCell(app, l)));
  });
  out.push([], s(' type a number, or ←→ for one more / less', 'd'), [], s(' NOTES', 'd'));
  if (order.before != null) out.push(s(` Wanted there before ${String(Math.floor(order.before / 60)).padStart(2, '0')}:${String(order.before % 60).padStart(2, '0')}.`, 'w'));
  const notes = lineNotes(app);
  const room = Math.max(0, BODY_ROWS - out.length - notes.length);
  const full = shortfallLines(app, order.client, LINES_W, 2);
  const short = full.length > room ? shortfallLines(app, order.client, LINES_W, 2, 1).slice(0, room) : full;
  out.push(...short, ...notes);
  return out;
}

const CELL = 12;

/** The nine squares: each shows the trucks going there, and the current order's square is lit. */
export function nineSquares(app: App): Line[] {
  const d = app.desk;
  const here = d.order(app.orderSel).place;
  const trucksAt = (id: PlaceId): number[] => d.morning.trucks.filter((t) => d.placesOf(t.id).includes(id)).map((t) => t.id);
  const border = (l: string, m: string, r: string): Line => s(l + Array.from({ length: 3 }, () => '─'.repeat(CELL)).join(m) + r, 'd');
  const out: Line[] = [border('┌', '┬', '┐')];
  for (let row = 0; row < 3; row++) {
    const cells = PLACES.filter((p) => p.row === row).sort((a, b) => a.col - b.col);
    const top: Line = [];
    const bottom: Line = [];
    cells.forEach((p) => {
      const lit = p.id === here;
      const trucks = trucksAt(p.id);
      const name = p.id === 'saltmarket' ? 'SALTMARKET' : p.name;
      const nums = trucks.join(' ');
      top.push(['│', 'd'], [` ${clip(name, CELL - 1).padEnd(CELL - 1)}`, lit ? 'cur' : 'b']);
      const text = lit ? `▶ ${nums || 'no truck'}` : nums || '·';
      bottom.push(['│', 'd'], [` ${clip(text, CELL - 1).padEnd(CELL - 1)}`, lit ? 'cur' : nums ? 'acc' : 'd']);
    });
    top.push(['│', 'd']);
    bottom.push(['│', 'd']);
    out.push(top, bottom, row < 2 ? border('├', '┼', '┤') : border('└', '┴', '┘'));
  }
  return out;
}

/** Where the highlighted order would be reached: on the truck under the cursor while picking, on its own truck otherwise. */
function previewTruck(app: App): number | null {
  if (app.pane === 'trucks') return app.morning.trucks[app.truckSel]?.id ?? null;
  return app.desk.truckFor(app.orderSel);
}

/**
 * The clients who asked for a time, against when their trucks are expected to get there: the highlighted order first,
 * as it would be on the truck being picked, then the other clients on a truck who would be late. Shows what fits in
 * `room` lines, the most useful first.
 */
function deadlineRows(app: App, room: number): Line[] {
  const d = app.desk;
  const departAt = d.projectedDeparture();
  const current = d.order(app.orderSel);
  const late: Array<{ client: string; arriveAt: number; minutes: number }> = [];
  let placed = 0;
  d.morning.orders.forEach((order, i) => {
    const truck = d.truckFor(i);
    if (order.before == null || truck == null) return;
    const arriveAt = d.arrivalOn(i, truck, departAt);
    if (arriveAt == null) return;
    placed++;
    const { minutes } = arrivalText(arriveAt, order.before);
    if (minutes > 0 && i !== app.orderSel) late.push({ client: order.client, arriveAt, minutes });
  });
  late.sort((a, b) => b.minutes - a.minutes);

  const mine: Line[] = [];
  let mineLate = false;
  if (current.before != null) {
    mine.push(cat(s(` ${clip(current.client, 22)}`, 'b'), s(` before ${formatTime(current.before)}`)));
    const truck = previewTruck(app);
    const arriveAt = truck == null ? null : d.arrivalOn(app.orderSel, truck, departAt);
    if (truck != null && d.inGarage(truck)) mine.push(s(`   truck ${truck} is at the garage today`, 'w'));
    else if (truck == null || arriveAt == null) mine.push(s('   pick a truck to see when it gets there', 'd'));
    else {
      const arrival = arrivalText(arriveAt, current.before);
      mineLate = arrival.late;
      mine.push(cat(s(`   on truck ${truck}: `, 'd'), s(arrival.text, arrival.late ? 'w' : 'acc')));
    }
  }
  const lateCount = late.length + (mineLate && d.truckFor(app.orderSel) != null ? 1 : 0);
  const head = cat(
    s(' DEADLINES', 'b'),
    s(placed === 0 ? '  none on a truck yet' : `  ${placed} timed on trucks`, 'd'),
    placed > 0 ? s(lateCount > 0 ? ` · ${lateCount} late` : ' · none late', lateCount > 0 ? 'w' : 'acc') : [],
  );
  if (room < 1) return [];
  if (room < 3) return mine.length > 0 ? mine.slice(-room) : [head];
  const spare = room - 1 - mine.length;
  const rows = late.map((l): Line => s(` ✗ ${clip(l.client, 14).padEnd(14)} ~${formatTime(l.arriveAt)} · ${l.minutes} min late`, 'w'));
  // What does not fit is counted, unless only one line is left, which then names the worst.
  const keep = Math.max(0, spare === 1 ? 1 : spare - 1);
  const shown = rows.length > spare ? [...rows.slice(0, keep), ...(spare > 1 ? [s(` + ${rows.length - keep} more late`, 'd')] : [])] : rows;
  return [head, ...mine, ...shown.slice(0, Math.max(0, spare))];
}

function trucksPane(app: App): Line[] {
  const d = app.desk;
  const lit = app.pane === 'trucks';
  const current = d.truckFor(app.orderSel);
  const out: Line[] = [
    paneTitle('TRUCKS', lit, s('  ↑↓ ENTER to pick', 'd')),
  ];
  d.morning.trucks.forEach((t, i) => {
    const pct = Math.round(d.fullness(t.id) * 100);
    const places = d.placesOf(t.id);
    const cursor = lit && i === app.truckSel;
    const mark = t.id === current ? '▶' : ' ';
    if (d.inGarage(t.id)) {
      const reason = shortReason(d.morning.garage?.reason ?? '');
      out.push(cat(
        s(`${mark}${t.id} ${t.driver.padEnd(t.id > 9 ? 5 : 6)} `, cursor ? 'hl' : 'd'),
        s('at the garage'.padEnd(15), cursor ? 'w hl' : 'w'),
        s(clip(reason, 16).padEnd(16), cursor ? 'hl' : 'd'),
      ));
      return;
    }
    const row = cat(
      s(`${mark}${t.id} ${t.driver.padEnd(t.id > 9 ? 5 : 6)} `, cursor ? 'hl' : ''),
      bar(pct, 8, cursor ? 'hl' : ''),
      s(` ${String(pct).padStart(3)}%  `, cursor ? 'hl' : ''),
      s((places.length ? placesLabel(places, 16) : '—').padEnd(16), `${places.length ? 'acc' : 'd'}${cursor ? ' hl' : ''}`),
    );
    out.push(row);
  });
  out.push([]);
  out.push(...nineSquares(app).map((l) => cat(s(' '), l)));
  out.push(...deadlineRows(app, BODY_ROWS - out.length));
  return out;
}

/** The rush order that may ring this morning, as one phrase of the heads-up; empty when none is expected. */
function rushPhrase(app: App): string {
  const rush = app.morning.rush;
  if (!rush) return '';
  return `${rush.client} may ring for ${rush.qty} ${plainName(app.desk.item(rush.item).name)}`;
}

function headsUp(app: App): Line {
  const label = s(' HEADS UP  ', 'w b');
  const items = shortItems(app.morning);
  const rush = rushPhrase(app);
  if (items.length === 0) return rush ? cat(label, s('nothing is short today · ', 'acc'), s(rush, 'w')) : cat(label, s('nothing is short today', 'acc'));
  let text = '';
  let shown = 0;
  for (const it of items) {
    const part = `${plainName(it.name)}: ${it.asked} asked today, ${it.onHand} on hand${it.sent ? ` (supplier sent ${it.sent.came} of ${it.sent.ordered})` : ''}`;
    const next = text ? `${text} · ${part}` : part;
    if (next.length > 120 - 11 - 14 && shown > 0) break;
    text = next;
    shown++;
  }
  if (shown < items.length) text += ` · +${items.length - shown} more`;
  const room = 120 - 11 - text.length - 3;
  return cat(label, s(rush && rush.length <= room ? `${text} · ${rush}` : text, 'w'));
}

export function deskScreen(app: App): Line[] {
  const top = header('ORDER DESK', clockLine(app.morning.day, app.desk.clock, true, app.cash));
  const left = ordersPane(app);
  const mid = linesPane(app);
  const right = trucksPane(app);
  const rows = Math.max(left.length, mid.length, right.length);
  const body: Line[] = [];
  for (let i = 0; i < rows; i++) {
    body.push(cols([left[i] ?? [], mid[i] ?? [], right[i] ?? []], [ORDERS_W, LINES_W, TRUCKS_W]));
  }
  const status = app.status ? s(` ${app.status}`, app.tone === 'warn' ? 'w' : 'acc') : [];
  const footer = [
    rule(),
    pad(headsUp(app), 120),
    status,
    keyBar([
      ['SPACE', 'truck sheets'], ['TAB', 'next pane'], ['↑↓', 'move'], ['0-9', 'amount'], ['←→', '±1'], ['ENTER', 'next / truck'],
      ['H', 'how to play'], ['F2', 'colours'], ['F4', 'sound'],
    ]),
  ];
  return layout(top, body, footer);
}
