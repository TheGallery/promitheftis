import type { Mood } from './moods';
import { below, mulberry32 } from './random';
import type { RunClient } from './run';
import type { Message } from './types';

/** A client who ends this many days running let down, or a bit let down, takes a break. */
export const LET_DOWN_DAYS = 3;
/** A break lasts this many mornings at the least, and this many at the most. */
export const AWAY_FROM = 2;
export const AWAY_TO = 3;
/** A client who takes a second break less than this many days after the first goes for good. */
export const SECOND_WITHIN = 8;
/** A client who has just come back orders this share of what they would have. */
export const WARY_SCALE = 0.85;
/** Keeps the length of a break apart from the other chances a morning is made of. */
const SALT = 0x7f4a7c15;

/** Clients that never go for good: a hospital and schools cannot simply stop. They complain more plainly instead. */
const STEADY: ReadonlySet<string> = new Set(["St Jude's Hospital", 'Millford School', 'Ashby Primary School']);

/** Where one client stands: how many days running they have been let down, and any break they are on. */
export interface Standing {
  /** Days in a row, with an order, that the client ended let down or a bit let down. */
  streak: number;
  /** Mornings, counting this one, on which the client sends no order; 0 when they are ordering. */
  away: number;
  /** True on the morning the client comes back from a break: they order a little less, and say so. */
  back?: boolean;
  /** The day the client's last break began. */
  lastBreak?: number;
}

/** Each client's standing, by name; a client with nothing to say about them has no entry. */
export type Standings = Record<string, Standing>;

/** What a client says on the morning a break or a farewell begins. */
export interface Notice {
  client: string;
  contact: string;
  kind: 'break' | 'gone';
  /** True when a client that never goes for good takes a second break, and says so plainly. */
  plain?: boolean;
}

export const isSteady = (client: string): boolean => STEADY.has(client);

export function isAway(standing: Standings, client: string): boolean {
  return (standing[client]?.away ?? 0) > 0;
}

/** True when the client has been let down two days running and is ordering: one more bad day and they leave for a while. */
export function isWarned(standing: Standings, client: string): boolean {
  const s = standing[client];
  return s != null && s.away === 0 && s.streak >= LET_DOWN_DAYS - 1;
}

/** True on the morning the client is back from a break. */
export function isBack(standing: Standings, client: string): boolean {
  return standing[client]?.back === true;
}

/** The marker beside an order for a client let down two days running, empty for any other. */
export const WARN_MARK = '▼';

export function warnMarker(standing: Standings, client: string): string {
  return isWarned(standing, client) ? WARN_MARK : '';
}

/** What the order desk and the messages say of a client let down two days running; `named` leads with the client's name. */
export function warnNote(client: string, named = false): string {
  const text = 'let down two days running; another bad day and they will try someone else.';
  return named ? `${client}: ${text}` : `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/** The line on a returning client's order, in the contact's own voice. */
export const BACK_NOTE = 'We are back, a bit wary. Please look after us.';

/** What the clients who take a break or leave say, overnight, in order: each is a note from the client, in the client's voice. */
export function noticeNotes(news: readonly Notice[]): Array<Extract<Message, { kind: 'client' }>> {
  const first = 24 * 60 + 2 * 60 + 30;
  return news.map((n, i) => ({
    kind: 'client',
    from: n.client,
    text:
      n.kind === 'gone'
        ? `${n.contact} here. Thank you for everything, but we have found another supplier and will not be ordering again. Best wishes.`
        : n.plain
          ? `${n.contact} here. This is the second time we have been let down. We must try another supplier for a few days.`
          : `${n.contact} here. Thank you for your trouble, but we are going to try another supplier for a few days.`,
    at: first + 9 * i,
  }));
}

/** How a day leaves the clients: each one's standing, what they have to say tomorrow, and who has gone for good. */
export interface Settled {
  standing: Standings;
  news: Notice[];
  gone: string[];
}

/**
 * The clients' standing once the day is over, from how each ended it. A client who ordered extends their run of let-down
 * days or ends it; one who sent no order today (on a break) counts down to their return and is not counted as let down.
 * A client whose run reaches three takes a break of two or three mornings, drawn from `seed`; one whose last break began
 * within a week and a half goes for good, unless it is a hospital or a school. The last clients still ordering are never lost.
 */
export function settle(clients: readonly RunClient[], before: Standings, moods: Readonly<Record<string, Mood>>, day: number, seed = 0): Settled {
  const random = mulberry32((seed ^ SALT) >>> 0);
  const standing: Standings = {};
  const news: Notice[] = [];
  const gone: string[] = [];
  // Every client draws the same number whatever happens to them, so one client's fate does not move another's.
  const lengths = clients.map(() => AWAY_FROM + below(random, AWAY_TO - AWAY_FROM + 1));
  const next = clients.map((c): Standing => {
    const was = before[c.name] ?? { streak: 0, away: 0 };
    const kept = was.lastBreak != null ? { lastBreak: was.lastBreak } : {};
    if (was.away > 0) return { streak: 0, away: was.away - 1, ...(was.away === 1 ? { back: true } : {}), ...kept };
    const mood = moods[c.name];
    return { streak: mood == null ? was.streak : mood === 'pleased' ? 0 : was.streak + 1, away: 0, ...kept };
  });
  let ordering = next.filter((s) => s.away === 0).length;
  clients.forEach((c, i) => {
    const now = next[i] as Standing;
    if (now.away === 0 && now.streak >= LET_DOWN_DAYS && ordering > 1) {
      ordering--;
      const second = now.lastBreak != null && day - now.lastBreak < SECOND_WITHIN;
      if (second && !isSteady(c.name)) {
        gone.push(c.name);
        news.push({ client: c.name, contact: c.contact, kind: 'gone' });
        return;
      }
      news.push({ client: c.name, contact: c.contact, kind: 'break', ...(second ? { plain: true } : {}) });
      next[i] = { streak: 0, away: lengths[i] as number, lastBreak: day };
    }
    const s = next[i] as Standing;
    const recent = s.lastBreak != null && day + 1 - s.lastBreak <= SECOND_WITHIN;
    if (s.streak > 0 || s.away > 0 || s.back || recent) standing[c.name] = { streak: s.streak, away: s.away, ...(s.back ? { back: true } : {}), ...(recent ? { lastBreak: s.lastBreak as number } : {}) };
  });
  return { standing, news, gone };
}
