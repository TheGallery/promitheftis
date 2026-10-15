import { plural } from '../format';
import { NOT_HANDED_OUT, type App } from '../app';
import { bar, COLS, overlay, pad, ROWS, s, width, wrapText, type Line } from '../grid';

/** The hold box: its outer width, the room for text inside it, and the cells of the bar that fills. */
export const BOX_W = 48;
const INNER = BOX_W;
const MARGIN = 4;
const TEXT_W = INNER - 2 * MARGIN;
export const BAR_CELLS = INNER - 2 * MARGIN;

interface Words {
  title: string;
  warn?: string;
}

/** What the step being asked for is called, and any warning that goes with it. */
function words(app: App): Words | null {
  const ask = app.ask;
  if (!ask) return null;
  const key = app.holdKeyName;
  switch (ask.action) {
    case 'newRun':
      return {
        title: `HOLD ${key} TO START A NEW RUN`,
        warn: `Replaces your saved day ${app.saved?.run.day ?? app.run.day}.`,
      };
    case 'send': {
      const left = app.desk.unfinishedCount();
      return {
        title: `HOLD ${key} TO SEND THE TRUCKS`,
        warn: left > 0 ? `${plural(left, 'order')} not handed out. ${NOT_HANDED_OUT}` : undefined,
      };
    }
    case 'order':
      return {
        title: `HOLD ${key} TO PLACE THE ORDER`,
      };
    case 'morning':
      return {
        title: `HOLD ${key} TO START THE NEXT MORNING`,
      };
    case 'again':
      return {
        title: `HOLD ${key} TO PLAY THE DAY AGAIN`,
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
  return wrapText(text, TEXT_W).map((row) => s(' '.repeat(MARGIN) + row, cls));
}

/** The box for the step being asked for: its name and key, a bar that fills while the key is held, and how to cancel. */
export function holdBox(app: App): Line[] | null {
  const w = words(app);
  if (!w) return null;
  const filled = bar(app.holdProgress * 100, BAR_CELLS, 'box');
  const rows: Line[] = [
    [],
    centred(w.title, 'b'),
    [],
    [[' '.repeat(MARGIN), ''], ...filled],
    [],
    centred('Let go or ESC to cancel', app.holding ? 'acc' : 'd'),
    ...(w.warn ? [[], ...para(w.warn, 'w')] : []),
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
