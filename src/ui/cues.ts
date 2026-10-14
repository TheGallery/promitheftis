/** The moments of play that make a key sound. One key press makes at most one. */
export type Moment =
  | 'move'
  | 'tab'
  | 'digit'
  | 'nudge'
  | 'confirm'
  | 'truckKey'
  | 'truck'
  | 'finish'
  | 'warn'
  | 'sheetOpen'
  | 'sheetClose';

export interface CueArg {
  /** For `nudge`: 1 for more, -1 for less. */
  dir?: 1 | -1;
}

/** A repeat of the same moment closer than this, in seconds, is dropped, so a held key does not machine-gun. */
export const REPEAT_GAP = 0.028;

/**
 * Says whether a moment should sound at time `now` (seconds), and if so notes it
 * in `last`. Each moment is thinned on its own, so a warning right after a digit is heard.
 */
export function allowCue(last: Map<Moment, number>, moment: Moment, now: number): boolean {
  const before = last.get(moment);
  if (before !== undefined && now - before < REPEAT_GAP) return false;
  last.set(moment, now);
  return true;
}
