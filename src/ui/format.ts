import { place, type PlaceId } from '../game/places';

/** "Oakley, Hollin"; when that is too wide, three-letter codes; when still too wide, cut. */
export function placesLabel(ids: readonly PlaceId[], w: number): string {
  const full = ids.map((id) => place(id).name).join(', ');
  if ([...full].length <= w) return full;
  const codes = ids.map((id) => place(id).code).join(' ');
  return [...codes].length <= w ? codes : [...codes].slice(0, w - 1).join('') + '…';
}

export function plural(n: number, one: string, many = one + 's'): string {
  return `${n} ${n === 1 ? one : many}`;
}
