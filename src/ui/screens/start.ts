import { dateLabel } from '../../game/clock';
import { plural } from '../format';
import type { App, StartChoice } from '../app';
import { header, keyBar, layout, rule, s, cat, type Line } from '../grid';

const CHOICES: ReadonlyArray<{ choice: StartChoice; title: string; text: string }> = [
  { choice: 'continue', title: 'Continue', text: '' },
  { choice: 'small', title: 'New run: the small morning', text: '2 trucks, 7 orders. Replaces the saved run.' },
  { choice: 'big', title: 'New run: the big morning', text: '9 trucks, 38 orders. Replaces the saved run.' },
];

export function startScreen(app: App): Line[] {
  const saved = app.saved;
  const day = saved?.run.day ?? 1;
  const top = header('WELCOME BACK', s(`${dateLabel(day)}  `));
  const rows = CHOICES.flatMap(({ choice, title, text }, i): Line[] => {
    const sel = i === app.startSel;
    const more =
      choice === 'continue' && saved
        ? `Day ${day}, ${dateLabel(day)}: ${plural(saved.run.trucks.length, 'truck')}, ${plural(saved.run.clients.length, 'client')}. Starts at the overnight messages.`
        : text;
    return [cat(s(` ${sel ? '▶' : ' '} ${i + 1}  ${title}`, sel ? 'hl' : 'b'), sel ? s('', 'hl') : []), s(`      ${more}`, sel ? '' : 'd'), []];
  });
  const body: Line[] = [
    s(' YOUR RUN IS SAVED IN THIS BROWSER', 'b'),
    s(' It is saved by itself at the start of each day. Carry on from there, or start over from the first day.', 'd'),
    [],
    ...rows,
  ];
  const status = app.status ? s(` ${app.status}`, app.tone === 'warn' ? 'w' : 'acc') : [];
  const keys = keyBar([['↑↓', 'pick one'], ['ENTER', 'go'], ['C', 'continue'], ['S', 'small morning'], ['B', 'big morning'], ['F2', 'colours'], ['F4', 'sound']]);
  return layout(top, body, [rule(), status, keys]);
}
