import { DAY_END_MINUTE } from '../../game/clock';
import { tightestRoom, type GrowthOption } from '../../game/growth';
import { formatMoney } from '../../game/money';
import { plural } from '../format';
import type { App } from '../app';
import { cat, header, keyBar, layout, rule, s, wrapText, type Line } from '../grid';
import { clockLine, moneySeg, newRunPrompt, otherMornings } from './common';
import { roomLine } from './day';

/** Room for text after the 7-column indent of an option's details. */
const TEXT_W = 108;
const DETAIL_INDENT = ' '.repeat(7);

/** Room for the title of an option before its price. */
const TITLE_W = 58;
const PRICE_W = 8;

/**
 * The options, each with its price. One that cannot be afforded stays in the list but is dim, without the highlight
 * even when the pointer is on it, and says why.
 */
function optionRows(app: App, options: readonly GrowthOption[]): Line[] {
  const done = app.growth != null;
  return options.flatMap((o, i): Line[] => {
    const sel = i === app.growthSel;
    const dim = (done && !sel) || !o.affordable;
    const hl = sel && o.affordable ? ' hl' : '';
    const mark = done && sel ? s('  chosen', 'acc hl') : [];
    const text = ` ${sel ? '▶' : ' '} ${i + 1}  ${o.title}`;
    const title = cat(
      s(text.padEnd(TITLE_W), hl ? 'hl' : dim ? 'd' : 'b'),
      s((o.price > 0 ? formatMoney(o.price) : 'free').padStart(PRICE_W), hl ? 'hl' : dim ? 'd' : 'acc'),
      mark,
      o.affordable ? s('', hl.trim()) : s('  Not enough money yet', 'w'),
    );
    const details = [o.gain, `The extra work: ${o.work}`].flatMap((line) => wrapText(line, TEXT_W));
    return [title, ...details.map((d) => s(`${DETAIL_INDENT}${d}`, sel && !done && o.affordable ? '' : 'd')), []];
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
  const top = header('END OF THE DAY', clockLine(app.morning.day, DAY_END_MINUTE, false, app.cash));
  const intro: Line[] = chosen
    ? [
        s(' YOU CHOSE', 'b'),
        s(` ${chosen.title}`, 'acc'),
        s(' It takes effect tomorrow, when the next morning starts. Nothing changes for today.', 'd'),
        chosen.price > 0
          ? cat(s(` ${formatMoney(chosen.price)} paid; the bank holds `, 'd'), moneySeg(app.cash), s('. U takes the choice back, and the money with it.', 'd'))
          : s(' A new client costs nothing.', 'd'),
      ]
    : [
        s(' WHAT TO GROW', 'b'),
        s(' Pick one thing. A truck or a bigger room is paid for from the bank; a new client is free. Each brings extra work.', 'd'),
        cat(s(' It takes effect tomorrow, when the next morning starts. The bank holds ', 'd'), moneySeg(app.cash), s('.', 'd')),
      ];
  const body: Line[] = [...intro, [], ...optionRows(app, options), ...todayRows(app)];
  const keys = chosen
    ? ([['ENTER', 'next morning'], ['U', 'change choice'], ['ESC', 'back to the day']] as const)
    : ([['↑↓ 1-3', 'pick one'], ['ENTER', 'choose it'], ['ESC', 'back to the day']] as const);
  const status =
    newRunPrompt(app) ??
    (app.status
      ? s(` ${app.status}`, app.tone === 'warn' ? 'w' : 'acc')
      : chosen
        ? s(` Chosen: ${chosen.title}. It takes effect tomorrow. ENTER starts the next morning, U changes the choice.`, 'acc')
        : []);
  return layout(top, body, [rule(), status, keyBar([...keys, ['R', 'play again'], ...otherMornings(app), ['F2', 'colours'], ['F4', 'sound']])]);
}
