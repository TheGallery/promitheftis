import { DAY_END_MINUTE, formatTime } from '../../game/clock';
import type { DayOrder, DayRoom, DaySummary } from '../../game/day';
import { plainName } from '../../game/headsup';
import { formatChange, formatMoney } from '../../game/money';
import type { Mood } from '../../game/moods';
import { KEPT_LABEL } from '../../game/supply';
import { plural } from '../format';
import type { App } from '../app';
import { cat, clip, cols, header, keyBar, layout, rule, s, scrollRows, wrapText, type Line } from '../grid';
import { clockLine, newRunPrompt, otherMornings } from './common';

const LEFT_W = 58;
const RIGHT_W = 61;
/** The lines between the header and the footer. */
const BODY_ROWS = 25;
/** Past this many trucks they are listed two to a line, so the calls and tomorrow's order keep their room. */
const TRUCKS_ONE_PER_LINE = 4;
const TRUCK_W = 29;
/** Most lines of tomorrow's order that list what was ordered. */
const MAX_ORDERED_ROWS = 4;

const MOOD_CLASS: Record<Mood, string> = { pleased: 'acc', 'a bit let down': 'w', 'let down': 'w' };

/** Text as rows of `w` columns: the first from the left edge, the rest indented under it, never cut. */
function wrapHanging(text: string, w: number, hang = 2): string[] {
  const first = wrapText(text, w)[0] ?? '';
  const rest = text.slice(first.length).trim();
  return [first, ...(rest ? wrapText(rest, w - hang) : []).map((r) => ' '.repeat(hang) + r)];
}

function orderRows(app: App, day: DaySummary): Line[] {
  return day.orders.map((o, i) => {
    const sel = i === app.daySel;
    const reached = o.arriveAt != null ? formatTime(o.arriveAt) : '—';
    return cat(
      s(`${sel ? '▶' : ' '}${clip(o.client, 21).padEnd(22)}${`${o.percent}%`.padStart(4)}  ${reached.padStart(5)}  `, sel ? 'hl' : ''),
      s((o.lateForAsk ? 'late' : '').padEnd(6), sel ? 'w hl' : 'w'),
      s(o.mood, sel ? `${MOOD_CLASS[o.mood]} hl` : MOOD_CLASS[o.mood]),
    );
  });
}

/** What is known about the highlighted order: how it went, and why the client is as they are. */
function detail(app: App, o: DayOrder): Line[] {
  const out: Line[] = [rule(LEFT_W), cat(s(` ${clip(o.client.toUpperCase(), 30)}`, 'b'), s(` · ${o.mood}`, MOOD_CLASS[o.mood]))];
  if (o.arriveAt != null) {
    const asked = o.before != null ? `, asked: before ${formatTime(o.before)}` : '';
    out.push(s(` Truck ${o.truckId} reached them at ${formatTime(o.arriveAt)}${asked}`, o.lateForAsk ? 'w' : 'd'));
  }
  const missing = o.truckId == null ? '' : o.shortLines.map((l) => `${plainName(app.desk.item(l.item).name)} ${l.given}/${l.asked}`).join(', ');
  if (missing) for (const row of wrapHanging(`Short: ${missing}`, LEFT_W - 2).slice(0, 2)) out.push(s(` ${row}`, 'w'));
  const why = `This client ${o.reasons.join(', ')}.`;
  for (const row of wrapHanging(why, LEFT_W - 2).slice(0, 2)) out.push(s(` ${row}`, 'd'));
  return out;
}

function leftColumn(app: App, day: DaySummary): Line[] {
  const sel = day.orders[app.daySel];
  const below = sel ? detail(app, sel) : [];
  const room = BODY_ROWS - 2 - below.length;
  const rows = orderRows(app, day);
  return [
    cat(s(' HOW THE DAY WENT', 'b'), s(`   ${app.daySel + 1} of ${day.orders.length}`, 'd')),
    s(` ${'CLIENT'.padEnd(22)}${'GOT'.padStart(4)} REACHED${' '.repeat(7)}MOOD`, 'd'),
    ...scrollRows(rows, app.daySel, room),
    ...Array.from({ length: Math.max(0, room - rows.length) }, () => [] as Line),
    ...below,
  ];
}

function truckCell(t: DaySummary['trucks'][number]): Line {
  const back = t.backAt != null ? `back ${formatTime(t.backAt)}` : 'stayed in yard';
  const late = t.lateTo.length > 0 ? `${t.lateTo.length} late` : t.backAt != null ? 'on time' : '';
  return cat(s(` ${t.truckId} ${clip(t.driver, 7).padEnd(8)}`), s(back.padEnd(t.backAt != null ? 11 : 15)), s(late, t.lateTo.length > 0 ? 'w' : 'd'));
}

function trucksBlock(day: DaySummary): Line[] {
  const cells = day.trucks.map(truckCell);
  const perLine = day.trucks.length > TRUCKS_ONE_PER_LINE ? 2 : 1;
  const out: Line[] = [s(' TRUCKS', 'b')];
  for (let i = 0; i < cells.length; i += perLine) out.push(cols(cells.slice(i, i + perLine), Array(perLine).fill(TRUCK_W), ' '));
  return out;
}

function callsBlock(day: DaySummary): Line[] {
  const out: Line[] = [s(' PHONE CALLS', 'b')];
  if (day.calls.length === 0) return [...out, s(' Nobody rang.', 'd')];
  for (const c of day.calls) out.push(...wrapHanging(c.line, RIGHT_W - 2).map((r) => s(` ${r}`, c.promised ? 'acc' : '')));
  return out;
}

export function roomLine({ kept, space }: DayRoom): Line {
  const over = space.overBy > 0;
  return cat(
    s(` ${KEPT_LABEL[kept].padEnd(11)}`),
    s(`${String(space.pct).padStart(3)}% full tomorrow`, over ? 'w' : ''),
    over ? s(`  over by ${space.overPct}%`, 'w') : [],
  );
}

/** Whole entries packed into rows of at most `w` columns, at most `rows` rows; what does not fit is counted. */
function packRows(entries: readonly string[], w: number, rows: number): { rows: string[]; hidden: number } {
  const packed: string[][] = [[]];
  let hidden = 0;
  for (const [i, entry] of entries.entries()) {
    if (packed.length === rows && [...[...(packed.at(-1) as string[]), entry].join(', ')].length > w) {
      hidden = entries.length - i;
      break;
    }
    if ([...[...(packed.at(-1) as string[]), entry].join(', ')].length > w) packed.push([]);
    (packed.at(-1) as string[]).push(entry);
  }
  // The last row keeps room to say how many are left out, rather than being cut.
  const last = packed.at(-1) as string[];
  while (hidden > 0 && last.length > 1 && [...`${last.join(', ')}, + ${hidden} more`].length > w) {
    last.pop();
    hidden++;
  }
  return { rows: packed.map((r) => r.join(', ')), hidden };
}

function tomorrowBlock(day: DaySummary, room: number): Line[] {
  const entries = day.ordered.map((o) => `${o.amount} ${plainName(o.item.name)}`);
  const { rows, hidden } = packRows(entries, RIGHT_W - 2, room);
  const last = rows.length - 1;
  return [
    cat(s(" TOMORROW'S ORDER", 'b'), s(`   ${plural(day.ordered.length, 'item')}, ${plural(day.units, 'unit')}`, 'd')),
    ...rows.map((r, i) => (i === last && hidden > 0 ? cat(s(` ${r}`), s(`, + ${hidden} more`, 'd')) : s(` ${r}`))),
    ...day.rooms.map(roomLine),
  ];
}

/** One entry of the money block: a label and an amount at the right, in the warning colour when `warn`. */
function moneyCell(label: string, text: string, labelW: number, amountW: number, extra = '', warn = false): Line {
  return cat(s(label.padEnd(labelW), extra), s(text.padStart(amountW), warn ? `w ${extra}`.trim() : extra));
}

/**
 * What the day took in and paid out, and the cash in the bank now. What was paid out is a cost, not a loss, so
 * only a day that ends below zero, and cash below zero, are in the warning colour.
 */
export function moneyBlock({ money }: DaySummary): Line[] {
  const left = (label: string, amount: number): Line => moneyCell(` ${label}`, formatMoney(amount), 15, 9);
  const right = (label: string, text: string, warn: boolean, extra = ''): Line => cat(s('    '), moneyCell(label, text, 9, 10, extra, warn));
  return [
    s(' MONEY', 'b'),
    cat(left('Taken in', money.takenIn)),
    cat(left('Supplier order', -money.supplier), right('Today', formatChange(money.total), money.total < 0)),
    cat(left(`Trucks (${money.trucksOut} out)`, -money.trucks), right('Cash now', formatMoney(money.cash), money.cash < 0, 'b')),
  ];
}

function rightColumn(day: DaySummary): Line[] {
  const trucks = trucksBlock(day);
  const calls = callsBlock(day);
  // What the three rooms and the headings leave of the column is for the list of what was ordered.
  const money = moneyBlock(day);
  const room = Math.max(1, Math.min(MAX_ORDERED_ROWS, BODY_ROWS - trucks.length - calls.length - money.length - 3 - 1 - day.rooms.length));
  return [...trucks, [], ...calls, [], ...money, [], ...tomorrowBlock(day, room)];
}

export function dayScreen(app: App): Line[] {
  const day = app.day;
  const top = header('END OF THE DAY', clockLine(app.morning.day, DAY_END_MINUTE));
  const body: Line[] = [];
  if (day) {
    const left = leftColumn(app, day);
    const right = rightColumn(day);
    for (let i = 0; i < Math.max(left.length, right.length); i++) body.push(cols([left[i] ?? [], right[i] ?? []], [LEFT_W, RIGHT_W]));
  }
  const pleased = day?.orders.filter((o) => o.mood === 'pleased').length ?? 0;
  const status =
    newRunPrompt(app) ??
    (app.status
      ? s(` ${app.status}`, app.tone === 'warn' ? 'w' : 'acc')
      : day
        ? s(` ${pleased} of ${plural(day.orders.length, 'client')} pleased. ENTER to choose what to grow.`, 'd')
        : []);
  return layout(top, body, [rule(), status, keyBar([['↑↓', 'look through the clients'], ['ENTER', 'what to grow'], ['R', 'play again'], ...otherMornings(app), ['H', 'how to play'], ['F2', 'colours'], ['F4', 'sound']])]);
}
