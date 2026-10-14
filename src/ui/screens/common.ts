import { dateLabel, DEPART_MINUTE, formatTime } from '../../game/clock';
import { plainName } from '../../game/headsup';
import { shortNotes } from '../../game/history';
import type { App } from '../app';
import { cat, clip, s, wrapText, type Line } from '../grid';

/** Date of the day, clock and the time the trucks leave, shown at the right of every header. */
export function clockLine(day: number, minute: number, trucksWaiting = false): Line {
  const late = trucksWaiting && minute > DEPART_MINUTE;
  return cat(
    s(`${dateLabel(day)}  ${formatTime(minute)}  `),
    s(`TRUCKS ${formatTime(DEPART_MINUTE)} `, late ? 'w b' : 'b'),
  );
}

/**
 * B and S start a new run from a fixed morning. On the first day only the morning
 * that is not being played is offered; from the second day on, both are.
 */
export function otherMornings(app: App): ReadonlyArray<readonly [string, string]> {
  if (app.morning.day > 1) return [['B S', 'big / small morning']];
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
