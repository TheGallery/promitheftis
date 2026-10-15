import { formatTime } from '../../game/clock';
import { shortMarker } from '../../game/history';
import { place } from '../../game/places';
import { plural } from '../format';
import type { App } from '../app';
import { cat, clip, header, keyBar, layout, pad, rule, s, scrollRows, wrapText, type Line } from '../grid';
import { clockLine, shortfallLines } from './common';

const LIST_ROWS = 16;

function messageRow(app: App, i: number): Line {
  const m = app.morning.messages[i];
  if (!m) return [];
  const mark = i === app.msgSel ? '▶' : ' ';
  const number = String(i + 1).padStart(3);
  let from: string;
  let where: string;
  let what: string;
  let extra = '';
  let marker = '';
  if (m.kind === 'order') {
    const o = app.desk.order(m.orderId - 1);
    from = o.client;
    where = place(o.place).name;
    what = `order · ${plural(o.lines.length, 'line')}`;
    if (o.note) extra = '+ note';
    marker = shortMarker(app.run.history[o.client]);
  } else {
    from = m.from;
    where = m.kind;
    what = m.text;
  }
  const text = ` ${mark}${number}  ${clip(from, 25).padEnd(26)}${clip(where, 11).padEnd(12)}${clip(what, 56).padEnd(57)}${extra.padEnd(7)}`;
  const hl = i === app.msgSel;
  return cat(s(text, hl ? 'hl' : ''), marker ? s(marker, hl ? 'w hl' : 'w') : []);
}

function detail(app: App): Line[] {
  const m = app.morning.messages[app.msgSel];
  if (!m) return [];
  const left = (at: number) => `left at ${formatTime(at)}`;
  if (m.kind === 'order') {
    const o = app.desk.order(m.orderId - 1);
    const out: Line[] = [cat(s(` ${o.client.toUpperCase()}`, 'b'), s(` · ${place(o.place).name} · ${left(o.leftAt)}`, 'd'))];
    out.push(s(o.note ? ` ${o.contact}: "${o.note}"` : ` Order from ${o.contact}`));
    const items = o.lines
      .map((l) => `${l.asked} × ${app.desk.item(l.item).name}`)
      .join(' · ');
    for (const row of wrapText(items, 116).slice(0, 2)) out.push(s(` ${row}`, 'd'));
    out.push(...shortfallLines(app, o.client, 118, 3));
    return out;
  }
  const out: Line[] = [cat(s(` ${m.from.toUpperCase()}`, 'b'), s(` · ${m.kind} · ${left(m.at)}`, 'd'))];
  for (const row of wrapText(`"${m.text}"`, 116).slice(0, 3)) out.push(s(` ${row}`));
  return out;
}

export function messagesScreen(app: App): Line[] {
  const top = header(
    `OVERNIGHT MESSAGES · ${app.morning.title.toLowerCase()}: ${plural(app.morning.trucks.length, 'truck')}, ${plural(app.morning.orders.length, 'order')}`,
    clockLine(app.morning.day, app.desk.clock, false, app.cash),
  );
  const rows = app.morning.messages.map((_, i) => messageRow(app, i));
  const list = scrollRows(rows, app.msgSel, LIST_ROWS);
  const body: Line[] = [s(`  ${'#'.padStart(3)}  ${'FROM'.padEnd(26)}${'PLACE'.padEnd(12)}WHAT`, 'd'), ...list.map((r) => pad(r, 120))];
  while (body.length < LIST_ROWS + 1) body.push([]);
  body.push(rule(), ...detail(app));
  const other: Array<readonly [string, string]> =
    app.morning.day > 1
      ? [['B S', 'big / small morning']]
      : app.morning.id === 'small' ? [['B', 'big morning (9 trucks, 38 orders)']] : [['S', 'small morning (2 trucks, 7 orders)']];
  const status = app.status ? s(` ${app.status}`, app.tone === 'warn' ? 'w' : 'acc') : [];
  const footer = [rule(), status, keyBar([['SPACE', 'start the morning'], ['↑↓', 'message'], ...other, ['H', 'how to play'], ['F2', 'colours'], ['F4', 'sound']])];
  return layout(top, body, footer);
}
