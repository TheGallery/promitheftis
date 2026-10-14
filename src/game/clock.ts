/** The morning starts when the first messages have been read. */
export const START_MINUTE = 5 * 60 + 31;
/** The trucks leave at 07:00. */
export const DEPART_MINUTE = 7 * 60;
/** Each action at the desk moves the clock on by this much. */
export const MINUTES_PER_ACTION = 1;
export const DATE_LABEL = 'TUE 14 MAR';

/** Minutes since midnight as HH:MM; values past midnight wrap round. */
export function formatTime(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}
