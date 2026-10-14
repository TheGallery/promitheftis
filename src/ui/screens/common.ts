import { dateLabel, DEPART_MINUTE, formatTime } from '../../game/clock';
import type { App } from '../app';
import { cat, s, type Line } from '../grid';

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
