import { SUPPLIER_MINUTE } from '../../game/clock';
import { plainName } from '../../game/headsup';
import type { RoomSpace } from '../../game/rooms';
import { KEPT_LABEL, type Supply } from '../../game/supply';
import type { Kept } from '../../game/types';
import { plural } from '../format';
import type { App } from '../app';
import { cat, clip, header, keyBar, layout, rule, s, wrapText, type Line } from '../grid';
import { clockLine } from './common';

const NAME_W = 21;
const NOTE_W = 66;
/** Where the room bars start: after the item, on hand, usual and order columns. */
const BAR_AT = 50;
const BAR_W = 36;

/** What each shade of the room bars stands for. */
const SHADES = [
  ['█', 'rs', 'in store'],
  ['▓', 'ro', 'ordered'],
  ['▒', 're', 'this row'],
  ['░', 'rf', 'free'],
] as const;

function titles(): Line {
  const head = s(` ${'ITEM'.padEnd(NAME_W + 1)}${'ON HAND'.padStart(8)}${'USUAL'.padStart(8)}${'ORDER'.padStart(9)}`.padEnd(BAR_AT), 'd');
  const legend = SHADES.flatMap(([glyph, cls, label], i) => cat(s(i ? '  ' : ''), s(glyph, cls), s(` ${label}`, 'd')));
  return cat(head, legend);
}

/**
 * How many cells of a bar each part of a room takes: the parts in order, then
 * the free cells. A part with anything in it shows at least one cell, and the
 * bar is only full when the room is.
 */
export function barCells(parts: readonly number[], capacity: number, cells: number): number[] {
  const used = parts.reduce((sum, p) => sum + p, 0);
  const scale = cells / Math.max(capacity, used);
  const raw = parts.map((p) => p * scale);
  const out = raw.map((r, i) => (parts[i]! > 0 ? Math.max(1, Math.floor(r)) : 0));
  const target = used >= capacity ? cells : Math.min(cells - 1, Math.round(used * scale));
  const total = () => out.reduce((sum, n) => sum + n, 0);
  while (total() < target) {
    let best = -1;
    raw.forEach((r, i) => {
      if (parts[i]! > 0 && (best < 0 || r - out[i]! > raw[best]! - out[best]!)) best = i;
    });
    out[best]!++;
  }
  while (total() > target) {
    let most = -1;
    out.forEach((n, i) => {
      if (n > 1 && (most < 0 || n > out[most]!)) most = i;
    });
    if (most < 0) break;
    out[most]!--;
  }
  return [...out, cells - total()];
}

/** A room's bar: stock now █, already ordered ▓, the row being edited ▒, space left ░. */
export function roomBar(space: RoomSpace, cells = BAR_W): Line {
  const [store, ordered, editing, free] = barCells([space.inStore, space.ordered, space.editing], space.capacity, cells) as [number, number, number, number];
  return cat(s('█'.repeat(store), 'rs'), s('▓'.repeat(ordered), 'ro'), s('▒'.repeat(editing), 're'), s('░'.repeat(free), 'rf'));
}

/** The room's heading: its name, its bar and how full it is, with a warning when the order does not fit. */
function roomLine(kept: Kept, space: RoomSpace): Line {
  const label = KEPT_LABEL[kept];
  const over = space.overPct > 0;
  return cat(
    s(` ${label}`.padEnd(BAR_AT), 'b'),
    roomBar(space),
    s(` ${String(space.pct).padStart(3)}%`, over ? 'w' : ''),
    over ? s(`  ${label} over by ${space.overPct}%`, 'w') : [],
  );
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
  const editing = supply.placed ? null : app.supplySel;
  let kept: string | null = null;
  supply.rows.forEach((row, r) => {
    if (row.kept !== kept) {
      kept = row.kept;
      out.push(roomLine(row.kept, supply.roomSpace(row.kept, editing)));
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
