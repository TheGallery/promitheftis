import { formatTime } from '../../game/clock';
import { plainName } from '../../game/headsup';
import { place } from '../../game/places';
import { placesLabel, plural } from '../format';
import type { App } from '../app';
import { bar, cat, clip, cols, header, keyBar, layout, rule, s, scrollRows, wrapText, type Line } from '../grid';
import { clockLine, newRunPrompt, otherMornings } from './common';

const LEFT_W = 58;
const RIGHT_W = 61;

function shortSummary(app: App, i: number): string {
  const r = app.result?.orders[i];
  if (!r) return '';
  if (r.truckId == null) return 'no truck';
  return r.shortLines
    .map((l) => `${plainName(app.desk.item(l.item).name)} ${l.given}/${l.asked}`)
    .join(', ');
}

function leftColumn(app: App): Line[] {
  const r = app.result;
  if (!r) return [];
  const out: Line[] = [
    cat(s(' TRUCKS', 'b'), s(`   left at ${formatTime(r.departAt)}`, 'd')),
    s(` ${'TRUCK'.padEnd(9)}${'WENT TO'.padEnd(19)}${'STOPS'.padStart(5)}${'FULL'.padStart(6)}${'BACK'.padStart(8)}`, 'd'),
  ];
  for (const t of r.trucks) {
    const used = t.backAt != null;
    out.push(
      s(
        ` ${t.truckId} ${t.driver.padEnd(7)}${(used ? placesLabel(t.places, 17) : 'stayed in the yard').padEnd(19)}${String(t.stops).padStart(5)}${`${Math.round(t.fullness * 100)}%`.padStart(6)}${(used ? formatTime(t.backAt as number) : '—').padStart(8)}`,
        used ? '' : 'd',
      ),
    );
  }
  const calls = callsBlock(app);
  out.push([], s(' WHO GOT LESS', 'b'));
  if (r.gotLess.length === 0) {
    out.push(s(' Everybody got everything they asked for.', 'acc'));
    return [...out, ...calls];
  }
  // The calls keep their room at the bottom; the list of who got less takes what is left.
  const room = Math.max(2, 24 - out.length - calls.length);
  const shown = r.gotLess.length > room ? room - 1 : r.gotLess.length;
  for (const g of r.gotLess.slice(0, shown)) {
    out.push(s(` ${clip(g.client, 21).padEnd(22)}${`${g.percent}%`.padStart(4)}  ${clip(shortSummary(app, g.orderIndex), 29)}`, g.percent === 0 ? 'w' : ''));
  }
  if (shown < r.gotLess.length) out.push(s(` + ${r.gotLess.length - shown} more in the list`, 'd'));
  return [...out, ...calls];
}

/** One short line for each call that was answered on the road; a long one goes on, indented, under it. */
function callsBlock(app: App): Line[] {
  const lines = app.callLines;
  if (lines.length === 0) return [];
  return [[], s(' CALLS', 'b'), ...lines.flatMap(callRows)];
}

/** A call line as rows of the left column, never cut: the amount and the answer always show. */
function callRows(line: string): Line[] {
  const first = wrapText(line, LEFT_W - 2)[0] ?? '';
  const rest = line.slice(first.length).trim();
  return [s(` ${first}`), ...(rest ? wrapText(rest, LEFT_W - 4) : []).map((r) => s(`   ${r}`))];
}

function rightColumn(app: App): Line[] {
  const r = app.result;
  if (!r) return [];
  const rows: Line[] = r.orders.map((o, i) => {
    const sel = i === app.resultSel;
    const truck = o.truckId == null ? '-' : String(o.truckId);
    return cat(
      s(`${sel ? '▶' : ' '}${clip(o.client, 22).padEnd(23)}${place(o.place).name.padEnd(10)}${truck.padStart(2)} `, sel ? 'hl' : ''),
      bar(o.percent, 8),
      s(` ${String(o.percent).padStart(3)}%`, o.percent < 100 ? 'w' : ''),
    );
  });
  const selected = r.orders[app.resultSel];
  const detail: Line[] = [];
  if (selected) {
    detail.push(rule(RIGHT_W));
    detail.push(cat(s(` ${clip(selected.client.toUpperCase(), 26)}`, 'b'), s(` · ${place(selected.place).name}${selected.truckId ? ` · truck ${selected.truckId}` : ''}`, 'd')));
    if (selected.arriveAt != null) {
      const asked = selected.before != null ? ` (asked: before ${formatTime(selected.before)})` : '';
      detail.push(s(` Reached at ${formatTime(selected.arriveAt)}${asked}`, selected.lateForAsk ? 'w' : 'd'));
    } else {
      detail.push(s(' Nothing was delivered.', 'w'));
    }
    const missing = shortSummary(app, selected.orderIndex);
    if (missing && selected.truckId != null) {
      for (const row of wrapText(`Short: ${missing}`, 58).slice(0, 2)) detail.push(s(` ${row}`, 'w'));
    }
  }
  const room = 24 - 2 - detail.length;
  return [
    cat(s(' ORDERS', 'b'), s(`   ${app.resultSel + 1} of ${r.orders.length}`, 'd')),
    s(` ${'CLIENT'.padEnd(23)}${'PLACE'.padEnd(10)}${'TRK'.padStart(2)}  ${'DELIVERED'}`, 'd'),
    ...scrollRows(rows, app.resultSel, room),
    ...Array.from({ length: Math.max(0, room - Math.min(rows.length, room)) }, () => [] as Line),
    ...detail,
  ];
}

export function resultScreen(app: App): Line[] {
  const r = app.result;
  const top = header('THE TRUCKS HAVE GONE', clockLine(app.morning.day, r?.departAt ?? app.desk.clock));
  const left = leftColumn(app);
  const right = rightColumn(app);
  const n = Math.max(left.length, right.length);
  const body: Line[] = [];
  for (let i = 0; i < n; i++) body.push(cols([left[i] ?? [], right[i] ?? []], [LEFT_W, RIGHT_W]));
  const total = app.morning.orders.length;
  const summary =
    newRunPrompt(app) ??
    (app.status
      ? s(` ${app.status}`, app.tone === 'warn' ? 'w' : 'acc')
      : r
        ? cat(
            s(' '),
            s(`${r.inFull} of ${plural(total, 'order')} in full`, 'b'),
            s(` · ${plural(r.gotLess.length, 'client')} got less`),
            s(r.lastBack != null ? ` · last truck back at ${formatTime(r.lastBack)}` : ''),
          )
        : []);
  const footer = [rule(), summary, keyBar([['↑↓', 'orders'], ['ENTER', 'supplier order'], ['R', 'play again'], ...otherMornings(app), ['H', 'how to play'], ['F2', 'colours'], ['F4', 'sound']])];
  return layout(top, body, footer);
}
