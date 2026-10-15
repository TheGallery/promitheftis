import { formatTime } from '../game/clock';
import { place, type PlaceId } from '../game/places';
import type { RoomSpace } from '../game/rooms';

/**
 * The places a truck goes to, in `w` columns: the name of a single place, and for two or more their
 * three-letter codes, so one truck reads the same on every screen. When the codes do not all fit, whole codes
 * are kept and the rest are counted ("OAK HOL DCK +3").
 */
export function placesLabel(ids: readonly PlaceId[], w: number): string {
  const [only] = ids;
  if (ids.length === 1 && only) {
    const name = place(only).name;
    return [...name].length <= w ? name : [...name].slice(0, Math.max(0, w - 1)).join('') + '…';
  }
  const codes = ids.map((id) => place(id).code);
  if (codes.join(' ').length <= w) return codes.join(' ');
  for (let kept = codes.length - 1; kept >= 1; kept--) {
    const text = `${codes.slice(0, kept).join(' ')} +${codes.length - kept}`;
    if (text.length <= w) return text;
  }
  return codes.join(' ').slice(0, w);
}

export function plural(n: number, one: string, many = one + 's'): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** What a room says about what will not fit: the units that will spoil, or nothing when it all fits. */
export function spoilText(space: RoomSpace): string {
  return space.spoils > 0 ? `${space.spoils} will spoil` : '';
}

/** When a truck reaches a client, and, if the client asked for a time, whether that is in time. */
export interface Arrival {
  text: string;
  late: boolean;
  /** Minutes after the time asked; zero when in time or when no time was asked. */
  minutes: number;
}

/**
 * "~07:20 ✓" when the truck gets there by the time asked, "~09:10 ✗ 70 min late" when it does not, and the bare time
 * when no time was asked. The "~" says the time is an estimate.
 */
export function arrivalText(arriveAt: number, before: number | undefined | null): Arrival {
  const at = `~${formatTime(arriveAt)}`;
  if (before == null) return { text: at, late: false, minutes: 0 };
  const minutes = Math.max(0, arriveAt - before);
  return minutes > 0 ? { text: `${at} ✗ ${minutes} min late`, late: true, minutes } : { text: `${at} ✓`, late: false, minutes: 0 };
}
