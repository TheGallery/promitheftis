import type { Morning } from './types';

export interface ShortItem {
  item: string;
  name: string;
  asked: number;
  onHand: number;
  /** What the supplier delivered of it overnight when that was less than was ordered. */
  sent?: { came: number; ordered: number };
}

/** Items that today's orders ask for more of than there is on hand, worst first. */
export function shortItems(morning: Morning): ShortItem[] {
  const out: ShortItem[] = [];
  for (const item of morning.items) {
    const asked = morning.orders.reduce(
      (sum, o) => sum + o.lines.filter((l) => l.item === item.id).reduce((s, l) => s + l.asked, 0),
      0,
    );
    const onHand = morning.stock[item.id] ?? 0;
    const short = morning.short?.find((s) => s.item === item.id);
    if (asked > onHand) out.push({ item: item.id, name: item.name, asked, onHand, ...(short ? { sent: { came: short.came, ordered: short.ordered } } : {}) });
  }
  return out.sort((a, b) => Number(!!b.sent) - Number(!!a.sent) || a.onHand / a.asked - b.onHand / b.asked);
}

/** The short item's name without its unit: "Ketchup, bottle" becomes "ketchup". */
export function plainName(name: string): string {
  return (name.split(',')[0] ?? name).toLowerCase();
}
