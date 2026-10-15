import { plural } from '../format';
import { NOT_HANDED_OUT, type App } from '../app';
import { bar, COLS, overlay, pad, ROWS, s, width, wrapText, type Line } from '../grid';

/** The hold box: its outer width, the room for text inside it, and the cells of the bar that fills. */
const BOX_W = 76;
const INNER = BOX_W;
const TEXT_W = INNER - 10;
export const BAR_CELLS = INNER - 10;

interface Words {
  title: string;
  what: string;
  warn?: string;
  back: string;
}

/** What the step being asked for is called, what it does and what letting go does. */
function words(app: App): Words | null {
  const ask = app.ask;
  if (!ask) return null;
  const key = app.holdKeyName;
  switch (ask.action) {
    case 'newRun':
      return {
        title: `HOLD ${key} TO START A NEW RUN`,
        what: `A new run starts from the first day and replaces your saved day ${app.saved?.run.day ?? app.run.day}.`,
        back: 'Let go, or press ESC, to keep your run.',
      };
    case 'send': {
      const left = app.desk.unfinishedCount();
      return {
        title: `HOLD ${key} TO SEND THE TRUCKS`,
        what: 'The trucks leave at once and cannot be called back.',
        warn: left > 0 ? `${plural(left, 'order')} not handed out. ${NOT_HANDED_OUT}` : undefined,
        back: 'Let go, or press ESC, and the trucks wait.',
      };
    }
    case 'order':
      return {
        title: `HOLD ${key} TO PLACE THE ORDER`,
        what: "Tomorrow's order goes to the supplier and cannot be changed.",
        back: 'Let go, or press ESC, to keep working on the order.',
      };
    case 'morning':
      return {
        title: `HOLD ${key} TO START THE NEXT MORNING`,
        what: 'Your choice is final and the next morning begins.',
        back: 'Let go, or press ESC, to stay on the choice.',
      };
    case 'again':
      return {
        title: `HOLD ${key} TO PLAY THE DAY AGAIN`,
        what: 'The day starts over from its overnight messages. What you did since the trucks left is dropped.',
        back: 'Let go, or press ESC, to keep this day.',
      };
  }
}

/** A line of the box: on the box colour, and as wide as the box. */
function onBox(inner: Line): Line {
  return pad(inner, INNER).map(([text, cls]): Line[number] => [text, cls.includes('box') ? cls : `${cls} box`.trim()]);
}

function centred(text: string, cls = ''): Line {
  const left = Math.floor((INNER - [...text].length) / 2);
  return s(' '.repeat(Math.max(0, left)) + text, cls);
}

/** Text at the left margin of the box, wrapped. */
function para(text: string, cls = ''): Line[] {
  return wrapText(text, TEXT_W).map((row) => s(`     ${row}`, cls));
}

/** The box for the step being asked for: its name and key, a bar that fills while the key is held, and what letting go does. */
export function holdBox(app: App): Line[] | null {
  const w = words(app);
  if (!w) return null;
  const filled = bar(app.holdProgress * 100, BAR_CELLS, 'box');
  const barRow: Line = [['     ', ''], ...filled];
  const rows: Line[] = [
    [],
    centred(w.title, 'b'),
    [],
    barRow,
    barRow,
    centred(app.holding ? 'Keep holding…' : `Press and hold ${app.holdKeyName} until the bar is full.`, app.holding ? 'acc' : 'd'),
    [],
    ...para(w.what),
    ...(w.warn ? [[], ...para(w.warn, 'w')] : []),
    [],
    ...para(w.back, 'd'),
    [],
  ];
  return [[['═'.repeat(INNER), 'acc box']], ...rows.map(onBox), [['═'.repeat(INNER), 'acc box']]];
}

/** The screen with the hold box over it, when a step is waiting for its key to be held. */
export function withHoldBox(app: App, screen: Line[]): Line[] {
  const box = holdBox(app);
  if (!box) return screen;
  const top = Math.max(2, Math.floor((ROWS - box.length) / 2));
  return overlay(screen, box, top, Math.floor((COLS - width(box[0] as Line)) / 2));
}
