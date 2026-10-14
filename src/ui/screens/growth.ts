import { DAY_END_MINUTE } from '../../game/clock';
import { tightestRoom, type GrowthOption } from '../../game/growth';
import { plural } from '../format';
import type { App } from '../app';
import { cat, header, keyBar, layout, rule, s, wrapText, type Line } from '../grid';
import { clockLine } from './common';
import { roomLine } from './day';

/** Room for text after the 7-column indent of an option's details. */
const TEXT_W = 108;
const DETAIL_INDENT = ' '.repeat(7);

function optionRows(app: App, options: readonly GrowthOption[]): Line[] {
  const done = app.growth != null;
  return options.flatMap((o, i): Line[] => {
    const sel = i === app.growthSel;
    const dim = done && !sel;
    const mark = done && sel ? s('  chosen', 'acc hl') : [];
    const title = cat(s(` ${sel ? '▶' : ' '} ${i + 1}  ${o.title}`, sel ? 'hl' : dim ? 'd' : 'b'), mark, sel ? s('', 'hl') : []);
    const details = [o.gain, `The extra work: ${o.work}`].flatMap((text) => wrapText(text, TEXT_W));
    return [title, ...details.map((d) => s(`${DETAIL_INDENT}${d}`, sel && !done ? '' : 'd')), []];
  });
}

/** What the day showed that bears on the choice: how late the trucks were and how full each room will be. */
function todayRows(app: App): Line[] {
  const day = app.day;
  if (!day) return [];
  const late = day.trucks.reduce((n, t) => n + t.lateTo.length, 0);
  const tight = tightestRoom(day.rooms);
  return [
    s(' WHAT TODAY SHOWED', 'b'),
    s(
      ` ${plural(day.trucks.length, 'truck')} out; ${late > 0 ? `${plural(late, 'client')} reached late` : 'every client reached on time'}.`,
      late > 0 ? 'w' : 'd',
    ),
    ...day.rooms.map((r) => cat(roomLine(r), r === tight ? s('   the tightest', 'd') : [])),
  ];
}

export function growthScreen(app: App): Line[] {
  const options = app.growthOptions;
  const chosen = app.growth ? options[app.growthSel] : undefined;
  const top = header('END OF THE DAY', clockLine(DAY_END_MINUTE));
  const intro: Line[] = chosen
    ? [
        s(' YOU CHOSE', 'b'),
        s(` ${chosen.title}`, 'acc'),
        s(' It takes effect tomorrow, when the next morning starts. Nothing changes for today.', 'd'),
      ]
    : [
        s(' WHAT TO GROW', 'b'),
        s(' Pick one thing for the business. Nothing is paid for, but each brings its own extra work.', 'd'),
        s(' It takes effect tomorrow, when the next morning starts.', 'd'),
      ];
  const body: Line[] = [...intro, [], ...optionRows(app, options), ...todayRows(app)];
  const other = app.morning.id === 'small' ? ([['B', 'big morning']] as const) : ([['S', 'small morning']] as const);
  const keys = chosen
    ? ([['ESC', 'back to the day']] as const)
    : ([['↑↓ 1-3', 'pick one'], ['ENTER', 'choose it'], ['ESC', 'back to the day']] as const);
  const status = app.status
    ? s(` ${app.status}`, app.tone === 'warn' ? 'w' : 'acc')
    : chosen
      ? s(` Chosen: ${chosen.title}. It takes effect tomorrow.`, 'acc')
      : [];
  return layout(top, body, [rule(), status, keyBar([...keys, ['R', 'play again'], ...other, ['F2', 'colours'], ['F4', 'sound']])]);
}
