import { SUPPLIER_MINUTE } from '../../game/clock';
import { plainName } from '../../game/headsup';
import { KEPT_LABEL, type Supply } from '../../game/supply';
import { plural } from '../format';
import type { App } from '../app';
import { cat, clip, header, keyBar, layout, rule, s, wrapText, type Line } from '../grid';
import { clockLine } from './common';

const NAME_W = 21;
const NOTE_W = 66;

function titles(): Line {
  return s(` ${'ITEM'.padEnd(NAME_W + 1)}${'ON HAND'.padStart(8)}${'USUAL'.padStart(8)}${'ORDER'.padStart(9)}`, 'd');
}

function orderCell(app: App, supply: Supply, r: number): Line {
  const editing = !supply.placed && r === app.supplySel;
  if (editing) return s(`[${String(supply.amount(r)).padStart(3)}_]`.padStart(9), 'cur');
  const amount = supply.amount(r);
  return s(String(amount).padStart(9), amount === 0 ? 'd' : 'acc');
}

/** Who rang to have this item put on tomorrow's order, as a short note. */
function noteFor(supply: Supply, itemId: string): Line {
  const who = supply.notes.get(itemId)?.map((n) => n.client);
  if (!who || who.length === 0) return [];
  const names = who.length > 2 ? `${who.slice(0, 2).join(', ')} +${who.length - 2}` : who.join(', ');
  return s(`  ← ${clip(`${names} rang: add it to tomorrow's order`, NOTE_W - 4)}`, 'w');
}

function rows(app: App, supply: Supply): Line[] {
  const out: Line[] = [titles()];
  let kept: string | null = null;
  supply.rows.forEach((row, r) => {
    if (row.kept !== kept) {
      kept = row.kept;
      out.push(s(` ${KEPT_LABEL[row.kept]}`, 'b'));
    }
    const current = !supply.placed && r === app.supplySel;
    const mark = current ? '▶' : supply.isConfirmed(r) ? '✓' : ' ';
    const base = `${mark}${row.item.name.padEnd(NAME_W)}${String(row.onHand).padStart(9)}${String(row.usual).padStart(8)}`;
    out.push(cat(s(base, current ? 'hl' : supply.isConfirmed(r) ? 'd' : ''), orderCell(app, supply, r), noteFor(supply, row.item.id)));
  });
  return out;
}

function placedBlock(supply: Supply): Line[] {
  const list = supply
    .ordered()
    .map((o) => `${o.amount} × ${plainName(o.item.name)}`)
    .join(', ');
  return [
    [],
    s(' ORDER PLACED FOR TOMORROW', 'acc b'),
    ...wrapText(list, 116).slice(0, 4).map((t) => s(` ${t}`)),
  ];
}

export function supplyScreen(app: App): Line[] {
  const supply = app.supply;
  const top = header('SUPPLIER ORDER', clockLine(SUPPLIER_MINUTE));
  if (!supply) return layout(top, [], [rule(), [], keyBar([['F2', 'colours'], ['F4', 'sound']])]);
  const body = [...rows(app, supply)];
  if (supply.placed) body.push(...placedBlock(supply));
  const status = app.status
    ? s(` ${app.status}`, app.tone === 'warn' ? 'w' : 'acc')
    : s(` Tomorrow's order: ${plural(supply.ordered().length, 'item')}, ${plural(supply.total(), 'unit')}. Stock arrives the next morning.`, 'd');
  const keys: Array<readonly [string, string]> = supply.placed
    ? [['ESC', 'back'], ['R', 'play again'], ['B', 'big morning'], ['S', 'small morning']]
    : [['↑↓', 'move'], ['0-9', 'amount'], ['←→', '±1'], ['ENTER', 'next row'], ['U', 'fill row'], ['A', 'fill all'], ['F9', 'place order'], ['ESC', 'back']];
  return layout(top, body, [rule(), status, keyBar([...keys, ['F2', 'colours'], ['F4', 'sound']])]);
}
