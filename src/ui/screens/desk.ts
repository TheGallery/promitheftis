import { place, PLACES, type PlaceId } from '../../game/places';
import { plainName, shortItems } from '../../game/headsup';
import { placesLabel } from '../format';
import type { App } from '../app';
import { bar, cat, clip, cols, header, keyBar, layout, pad, rule, s, scrollRows, wrapText, type Line } from '../grid';
import { clockLine } from './common';

const ORDERS_W = 33;
const LINES_W = 44;
const TRUCKS_W = 41;
const BODY_ROWS = 24;

function paneTitle(name: string, lit: boolean, rest: Line): Line {
  return cat(s(` ${name} `, lit ? 'focus' : 'pane'), rest);
}

function ordersPane(app: App): Line[] {
  const d = app.desk;
  const lit = app.pane === 'orders';
  const out: Line[] = [
    paneTitle('ORDERS', lit, s(`  ${app.orderSel + 1} of ${d.orderCount}`, 'd')),
    s(`   ${''.padEnd(17)}${'PLACE'.padEnd(10)}TRK`, 'd'),
  ];
  const rows: Line[] = d.morning.orders.map((o, i) => {
    const current = i === app.orderSel;
    const mark = current ? '▶' : d.isFinished(i) ? '✓' : ' ';
    const truck = d.truckFor(i);
    const text = ` ${mark} ${clip(o.client, 16).padEnd(17)}${clip(place(o.place).name, 9).padEnd(10)}${truck ?? ''}`;
    return s(text, current ? 'hl' : d.isFinished(i) ? 'd' : '');
  });
  out.push(...scrollRows(rows, app.orderSel, BODY_ROWS - out.length));
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
  const who = order.note ? `${order.contact} · "${order.note}"` : order.contact;
  for (const row of wrapText(who, 42).slice(0, 2)) out.push(s(` ${row}`, 'd'));
  out.push([], s(` ${'ITEM'.padEnd(19)}${'ASKED'.padStart(6)}${'ON HAND'.padStart(9)}${'GIVE'.padStart(8)}`, 'd'));
  order.lines.forEach((line, l) => {
    const current = l === app.lineSel;
    const base = `${current ? '▶' : ' '}${d.item(line.item).name.padEnd(19)}${String(line.asked).padStart(6)}${String(d.onHand(o, l)).padStart(9)}`;
    out.push(cat(s(base, current ? 'hl' : ''), giveCell(app, l)));
  });
  out.push([], s(' type a number, or ←→ for one more / less', 'd'), [], s(' NOTES', 'd'));
  if (order.before != null) out.push(s(` Wanted there before ${String(Math.floor(order.before / 60)).padStart(2, '0')}:${String(order.before % 60).padStart(2, '0')}.`, 'w'));
  out.push(...lineNotes(app));
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
      const name = p.id === 'town' ? 'TOWN' : p.name;
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

function trucksPane(app: App): Line[] {
  const d = app.desk;
  const lit = app.pane === 'trucks';
  const current = d.truckFor(app.orderSel);
  const out: Line[] = [
    paneTitle('TRUCKS', lit, app.truckPending ? s('  T: press 1-9 now', 'w') : s('  T then 1-9 to pick', 'd')),
  ];
  d.morning.trucks.forEach((t, i) => {
    const pct = Math.round(d.fullness(t.id) * 100);
    const places = d.placesOf(t.id);
    const cursor = lit && i === app.truckSel;
    const mark = t.id === current ? '▶' : ' ';
    const row = cat(
      s(`${mark}${t.id} ${t.driver.padEnd(6)} `, cursor ? 'hl' : ''),
      bar(pct, 8, cursor ? 'hl' : ''),
      s(` ${String(pct).padStart(3)}%  `, cursor ? 'hl' : ''),
      s((places.length ? placesLabel(places, 16) : '—').padEnd(16), `${places.length ? 'acc' : 'd'}${cursor ? ' hl' : ''}`),
    );
    out.push(row);
  });
  out.push([]);
  out.push(...nineSquares(app).map((l) => cat(s(' '), l)));
  return out;
}

function headsUp(app: App): Line {
  const label = s(' HEADS UP  ', 'w b');
  const items = shortItems(app.morning);
  if (items.length === 0) return cat(label, s('nothing is short today', 'acc'));
  let text = '';
  let shown = 0;
  for (const it of items) {
    const part = `${plainName(it.name)}: ${it.asked} asked today, ${it.onHand} on hand`;
    const next = text ? `${text} · ${part}` : part;
    if (next.length > 120 - 11 - 14 && shown > 0) break;
    text = next;
    shown++;
  }
  if (shown < items.length) text += ` · +${items.length - shown} more`;
  return cat(label, s(text, 'w'));
}

export function deskScreen(app: App): Line[] {
  const top = header('ORDER DESK', clockLine(app.desk.clock, true));
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
      ['TAB', 'next pane'], ['↑↓', 'move'], ['0-9', 'amount'], ['←→', '±1'], ['ENTER', 'next'],
      ['T 1-9', 'put on truck'], ['F2', 'colours'], ['F4', 'sound'], ['F10', 'truck sheets'],
    ]),
  ];
  return layout(top, body, footer);
}
