import type { RoomSpace } from '../game/rooms';
import { place, type PlaceId } from '../game/places';

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
