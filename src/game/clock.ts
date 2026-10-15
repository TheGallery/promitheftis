/** The morning starts when the first messages have been read. */
export const START_MINUTE = 5 * 60 + 31;
/** The trucks leave at 07:00. */
export const DEPART_MINUTE = 7 * 60;
/** Each action at the desk moves the clock on by this much. */
export const MINUTES_PER_ACTION = 1;

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const FIRST_DAY_UTC = Date.UTC(2023, 2, 14);
const MS_PER_DAY = 86_400_000;
/** The last day whose date can be shown: past it the date is out of the range a date can hold. */
export const LAST_DAY = Math.floor((8.64e15 - FIRST_DAY_UTC) / MS_PER_DAY) + 1;

/** The date of a day of the run, e.g. "TUE 14 MAR" for day 1 and "WED 15 MAR" for day 2. */
export function dateLabel(day: number): string {
  const d = new Date(FIRST_DAY_UTC + (Math.max(1, Math.trunc(day)) - 1) * MS_PER_DAY);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** Minutes since midnight as HH:MM; values past midnight wrap round. */
export function formatTime(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}
/** The supplier is rung at 13:00. */
export const SUPPLIER_MINUTE = 13 * 60;
/** The day is wrapped up at 18:00. */
export const DAY_END_MINUTE = 18 * 60;
