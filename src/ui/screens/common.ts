import { dateLabel, DEPART_MINUTE, formatTime } from '../../game/clock';
import { plainName } from '../../game/headsup';
import { formatMoney } from '../../game/money';
import { isWarned, warnNote } from '../../game/churn';
import { shortNotes } from '../../game/history';
import type { App } from '../app';
import { cat, clip, s, wrapText, type Line } from '../grid';

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
 * B and S start a new run from a fixed morning, and drop the day in play, so their keys are held down. On the first
 * day only the morning that is not being played is offered; from the second day on, both are.
 */
export function otherMornings(app: App): ReadonlyArray<readonly [string, string]> {
  if (app.morning.day > 1) return [['B S', 'hold: big/small']];
  return app.morning.id === 'small' ? [['B', 'hold: big']] : [['S', 'hold: small']];
}

/**
 * What to say of the client of the current order, in the warning colour: that they have been let down two days running,
 * then what they went short of in their last two days. Each text wraps onto an indented second line and is cut with "…" if it
 * needs more than `rows` lines; `named` leads the warning with the client's name.
 */
export function shortfallLines(app: App, client: string, wide: number, named: number, rows = 2, withName = false): Line[] {
  const nameOf = (id: string): string => plainName(app.desk.item(id).name);
  const warned = isWarned(app.run.standing, client) ? [warnNote(client, withName)] : [];
  return [...warned, ...shortNotes(app.run.history[client], nameOf, named)].flatMap((note) => {
    const wrapped = wrapText(note, wide - 3);
    const kept = wrapped.length > rows ? [...wrapped.slice(0, rows - 1), clip(wrapped.slice(rows - 1).join(' '), wide - 3)] : wrapped;
    return kept.map((row, i) => s(i === 0 ? ` ${row}` : `   ${row}`, 'w'));
  });
}
