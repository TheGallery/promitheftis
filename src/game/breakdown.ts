import { below, pick, type Random } from './random';
import type { RunState } from './run';
import type { Garage, Message } from './types';

/** The chance that a truck is at the garage on a morning after the first: about one day in four or five. */
export const BREAKDOWN_CHANCE = 0.22;
/** The fewest trucks a business needs before one can be taken: the last one is never at the garage. */
export const MIN_FLEET = 2;

/** What is wrong with a truck, as it follows "with". */
const REASONS: readonly string[] = [
  'a flat battery',
  'a burst tyre',
  'a broken fan belt',
  'a cracked windscreen',
  'a slipping clutch',
  'a leaking radiator',
  'worn brakes',
];

type Note = Extract<Message, { kind: 'supplier' | 'staff' }>;

/** A truck at the garage for the day, with the staff note that says so; the note's time is left to the caller. */
export interface Breakdown {
  garage: Garage;
  note: Omit<Note, 'at'>;
  /** When the note comes in, in minutes since the evening before, between `from` and `to`. */
  at: number;
}

/** The reminder shown on the messages and when the desk opens. */
export function garageNotice(garage: Garage): string {
  return `Truck ${garage.truckId} is at the garage today with ${garage.reason}: nothing can go on it.`;
}

/** What the reason says on a narrow screen: without the "a". */
export function shortReason(reason: string): string {
  return reason.replace(/^an? /, '');
}

/**
 * Whether a truck is at the garage this morning, and which, with the note from the staff that tells the player.
 * It always draws the same four numbers, so whether it happens never moves anything else that chance decides.
 */
export function breakdownFor(run: RunState, random: Random, from: number, to: number): Breakdown | null {
  const roll = random();
  const truck = below(random, Math.max(1, run.trucks.length));
  const reason = pick(random, REASONS);
  const at = from + below(random, to - from + 1);
  if (run.day < 2 || run.trucks.length < MIN_FLEET || roll >= BREAKDOWN_CHANCE) return null;
  const t = run.trucks[truck];
  if (!t) return null;
  const crew = run.crews.find((c) => c.trucks.includes(t.id));
  return {
    garage: { truckId: t.id, reason },
    note: { kind: 'staff', from: crew?.names[0] ?? run.storeRoom[0] ?? 'Joe', text: `Truck ${t.id} (${t.kind}) is at the garage with ${reason}. Back tomorrow.` },
    at,
  };
}
