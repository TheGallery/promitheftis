import { DATE_LABEL, DEPART_MINUTE, formatTime } from '../../game/clock';
import { cat, s, type Line } from '../grid';

/** Date, clock and the time the trucks leave, shown at the right of every header. */
export function clockLine(minute: number, trucksWaiting = false): Line {
  const late = trucksWaiting && minute > DEPART_MINUTE;
  return cat(
    s(`${DATE_LABEL}  ${formatTime(minute)}  `),
    s(`TRUCKS ${formatTime(DEPART_MINUTE)} `, late ? 'w b' : 'b'),
  );
}
