import type { Call } from './calls';
import { shortYesterday, type ClientDay } from './history';
import type { OrderResult } from './results';

export type Mood = 'pleased' | 'a bit let down' | 'let down';

/** What a client's mood is worked out from: how much arrived, when it came, and the short-delivery call if there was one. */
export interface MoodFacts {
  /** The share of the order delivered, 0 to 100. */
  percent: number;
  /** True when the truck came after the time the client asked for. */
  late: boolean;
  /** How the client's call about a short delivery was answered, if they rang. */
  shortCall: 'promised' | 'refused' | null;
  /** True when the client was also short the day before. */
  shortBefore?: boolean;
}

/** Below this share delivered, a client is let down by the delivery alone; at 100 they are not. */
const HALF = 50;

/**
 * Points of disappointment, never below zero: 1 for less than everything, 2 for less than half, 1 for
 * coming after the time asked, 1 more for being told "nothing more today" about a short delivery,
 * 1 less for being promised the rest tomorrow, and 1 more for being short again after being short the
 * day before. No points is pleased, one a bit let down, more let down. A full delivery on time is
 * pleased whatever came before.
 */
export function moodPoints({ percent, late, shortCall, shortBefore }: MoodFacts): number {
  const delivery = percent >= 100 ? 0 : percent >= HALF ? 1 : 2;
  const call = shortCall === 'refused' ? 1 : shortCall === 'promised' ? -1 : 0;
  const again = shortBefore && percent < 100 ? 1 : 0;
  return Math.max(0, delivery + (late ? 1 : 0) + call + again);
}

export function moodOf(facts: MoodFacts): Mood {
  const points = moodPoints(facts);
  return points === 0 ? 'pleased' : points === 1 ? 'a bit let down' : 'let down';
}

/** What went into the mood, in plain words: why the client is as they are. */
export function moodReasons(facts: MoodFacts, noTruck = false): string[] {
  const out: string[] = [];
  if (noTruck) out.push('got no truck');
  else if (facts.percent === 0) out.push('got nothing');
  else if (facts.percent < 100) out.push(`got ${facts.percent}% of the order`);
  else out.push('got everything');
  if (facts.late) out.push('came after the time asked');
  if (facts.shortCall === 'promised') out.push('was promised the rest tomorrow');
  if (facts.shortCall === 'refused') out.push('was told nothing more today');
  if (facts.shortBefore && facts.percent < 100) out.push('was short yesterday as well');
  return out;
}

/** The facts for one order: its delivery, the answer to the call about it going short, if any, and the client's recent days. */
export function moodFacts(
  order: OrderResult,
  calls: readonly Call[],
  answers: ReadonlyMap<number, number>,
  recent?: readonly ClientDay[],
): MoodFacts {
  const call = calls.find((c) => c.kind === 'short' && c.orderIndex === order.orderIndex && answers.has(c.id));
  const choice = call ? answers.get(call.id) : undefined;
  const shortCall = call == null || choice == null ? null : call.options[choice]?.addsToOrder ? 'promised' : 'refused';
  return { percent: order.percent, late: order.lateForAsk, shortCall, shortBefore: shortYesterday(recent) };
}

/** How a client's mood the day before changes today's order: the share of the usual quantities it asks for, and a note. */
export interface MoodEffect {
  scale: number;
  note: string | null;
}

const MOOD_EFFECT: Record<Mood, MoodEffect> = {
  pleased: { scale: 1, note: null },
  'a bit let down': { scale: 0.9, note: 'Last time was a bit thin. Please do your best.' },
  'let down': { scale: 0.75, note: 'Last time was poor. We are counting on you today.' },
};

/** The effect of yesterday's mood on today's order; a client with no mood yet, such as a new one, is pleased. */
export function moodEffect(mood: Mood | undefined): MoodEffect {
  return MOOD_EFFECT[mood ?? 'pleased'];
}
