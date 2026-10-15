import { dateLabel, DEPART_MINUTE, formatTime } from '../../game/clock';
import { plainName } from '../../game/headsup';
import { formatMoney } from '../../game/money';
import { shortNotes } from '../../game/history';
import type { App } from '../app';
import { bar, cat, clip, s, wrapText, type Line } from '../grid';

/** An amount of money, in the warning colour when it is below zero. */
export function moneySeg(amount: number, text = formatMoney(amount), extra = ''): Line {
  return s(text, amount < 0 ? `w ${extra}`.trim() : extra);
}

/**
 * Date of the day, clock and the time the trucks leave, shown at the right of every header; with `cash`, the
 * cash in the bank comes first.
 */
export function clockLine(day: number, minute: number, trucksWaiting = false, cash?: number): Line {
  const late = trucksWaiting && minute > DEPART_MINUTE;
  return cat(
    cash == null ? [] : cat(s('CASH ', 'd'), moneySeg(cash, undefined, 'b'), s('  ')),
    s(`${dateLabel(day)}  ${formatTime(minute)}  `),
    s(`TRUCKS ${formatTime(DEPART_MINUTE)} `, late ? 'w b' : 'b'),
  );
}

/**
 * B and S start a new run from a fixed morning. On the first day only the morning
 * that is not being played is offered; from the second day on, both are.
 */
export function otherMornings(app: App): ReadonlyArray<readonly [string, string]> {
  if (app.morning.day > 1) return [['B S', 'big / small']];
  return app.morning.id === 'small' ? [['B', 'big morning']] : [['S', 'small morning']];
}

/**
 * What the client of the current order went short of in its last two days, in the warning colour: each
 * day's text wraps onto an indented second line and is cut with "…" if it needs more than `rows` lines.
 */
export function shortfallLines(app: App, client: string, wide: number, named: number, rows = 2): Line[] {
  const nameOf = (id: string): string => plainName(app.desk.item(id).name);
  return shortNotes(app.run.history[client], nameOf, named).flatMap((note) => {
    const wrapped = wrapText(note, wide - 3);
    const kept = wrapped.length > rows ? [...wrapped.slice(0, rows - 1), clip(wrapped.slice(rows - 1).join(' '), wide - 3)] : wrapped;
    return kept.map((row, i) => s(i === 0 ? ` ${row}` : `   ${row}`, 'w'));
  });
}

/** Cells in the bar that fills while the key for a new run is held down. */
const HOLD_CELLS = 16;

/**
 * The question shown from day 2 on after B or S (and on the opening screen after choosing a new run): a button to hold down while its bar fills from left to right,
 * in the accent colour; null when there is no question.
 */
export function newRunPrompt(app: App): Line | null {
  const id = app.newRunAsk;
  if (!id) return null;
  const key = app.holdKeyName;
  return cat(
    s(` Start a new run? It replaces your saved day ${app.saved?.run.day ?? app.run.day}. `),
    s(`[ HOLD ${key} TO START A NEW RUN ]`, 'b'),
    s(' '),
    bar(app.holdProgress * 100, HOLD_CELLS),
    s('  ESC keeps playing', 'd'),
  );
}
