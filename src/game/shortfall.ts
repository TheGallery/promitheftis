import { plainName } from './headsup';
import { formatMoney, supplierPrice } from './money';
import { ITEM_LIST } from './morning';
import { below, mulberry32 } from './random';
import type { Short } from './types';

/** The share of nights on which the supplier leaves some of the order behind. */
export const SHORT_CHANCE = 0.22;
/** Only an item ordered in at least this many units can come short, so that a shortfall is felt. */
const SMALLEST_ORDER = 6;
/** The share of the units ordered that still comes, from the least to the most. */
const CAME_FROM = 0.45;
const CAME_TO = 0.75;
/** The chance that a second item is short on the same night. */
const SECOND_CHANCE = 0.3;
/** Keeps the shortfall's chances apart from the ones the morning is made of, so that neither shifts the other. */
const SALT = 0x5bd1e995;

/** Who delivers each item. */
export const SUPPLIER_OF: Readonly<Record<string, string>> = {
  eggs: 'Grange Farm',
  potatoes: 'Grange Farm',
  mozzarella: 'Grange Farm',
  pork: 'Quay Butchers',
  chips: 'Northfrost',
  peas: 'Northfrost',
  ketchup: 'Hartley',
  flour: 'Hartley',
  gravy: 'Hartley',
  tomatoes: 'Hartley',
  oil: 'Hartley',
  rice: 'Hartley',
};

/**
 * What the supplier leaves behind of an order, on the night the order is delivered: nothing on most nights, and on some
 * one or two of the items ordered in some number come up short. The seed is the one that makes up the next morning, so the
 * same seed always gives the same night.
 */
export function shortfallFor(ordered: Readonly<Record<string, number>>, seed: number): Short[] {
  const random = mulberry32((seed ^ SALT) >>> 0);
  const roll = random();
  const second = random() < SECOND_CHANCE;
  const candidates = ITEM_LIST.filter((i) => (ordered[i.id] ?? 0) >= SMALLEST_ORDER).map((i) => i.id);
  if (roll >= SHORT_CHANCE || candidates.length === 0) return [];
  const out: Short[] = [];
  for (let n = 0; n < (second ? 2 : 1) && candidates.length > 0; n++) {
    const item = candidates.splice(below(random, candidates.length), 1)[0] as string;
    const asked = ordered[item] as number;
    const came = Math.min(asked - 1, Math.floor(asked * (CAME_FROM + random() * (CAME_TO - CAME_FROM))));
    out.push({ item, ordered: asked, came });
  }
  return out;
}

/** What the supplier delivers: the order, less what was left behind. */
export function deliveredOf(ordered: Readonly<Record<string, number>>, short: readonly Short[]): Record<string, number> {
  const out = { ...ordered };
  for (const s of short) out[s.item] = s.came;
  return out;
}

/** What the supplier does not charge for, in pounds. */
export function creditFor(short: readonly Short[]): number {
  return short.reduce((sum, s) => sum + (s.ordered - s.came) * supplierPrice(s.item), 0);
}

/** "8 frozen chips", "8 frozen chips and 5 frozen peas": the first and the last are joined by "and". */
function listed(entries: readonly string[]): string {
  return entries.length < 2 ? entries.join('') : `${entries.slice(0, -1).join(', ')} and ${entries.at(-1)}`;
}

/** One overnight note from each supplier that left something behind, in the supplier's own voice. */
export function shortNotes(short: readonly Short[]): Array<{ from: string; text: string }> {
  const names = new Map(ITEM_LIST.map((i) => [i.id, plainName(i.name)]));
  const bySupplier = new Map<string, Short[]>();
  for (const s of short) bySupplier.set(SUPPLIER_OF[s.item] ?? 'Hartley', [...(bySupplier.get(SUPPLIER_OF[s.item] ?? 'Hartley') ?? []), s]);
  return [...bySupplier].map(([from, lines]) => ({
    from,
    text:
      `Only ${listed(lines.map((s) => `${s.came} of ${s.ordered} ${names.get(s.item) ?? s.item}`))} came; the rest next time. ` +
      `You are not charged for it: ${formatMoney(creditFor(lines))} off.`,
  }));
}
