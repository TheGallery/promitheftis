import { SUPPLIER_MINUTE } from '../../game/clock';
import { formatMoney } from '../../game/money';
import type { RoomSpace } from '../../game/rooms';
import { KEPT_LABEL, KEPT_ORDER, type Supply } from '../../game/supply';
import type { Kept } from '../../game/types';
import { plural } from '../format';
import type { App } from '../app';
import { cat, header, keyBar, layout, rule, s, width, wrapText, type Line } from '../grid';
import { clockLine, moneySeg } from './common';

const NAME_W = 20;
/** Where the panel on the right starts: the room bars and the money, with the call notes below them. */
const PANEL_AT = 60;
const PANEL_W = 120 - PANEL_AT;
const LABEL_W = 11;
const BAR_W = 26;
const MONEY_LABEL_W = 12;
const MONEY_W = 9;

/** What each shade of the room bars stands for. */
const SHADES = [
  ['█', 'rs', 'in store'],
  ['▓', 'ro', 'ordered'],
  ['░', 'rf', 'free'],
] as const;

function titles(): Line {
  return s(` ${'ITEM'.padEnd(NAME_W)}${'ON HAND'.padStart(8)}${'USUAL'.padStart(7)}${'PRICE'.padStart(7)}${'ORDER'.padStart(8)}${'COST'.padStart(8)}`, 'd');
}

function legend(): Line {
  return SHADES.flatMap(([glyph, cls, label], i) => cat(s(i ? '  ' : ''), s(glyph, cls), s(` ${label}`, 'd')));
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

/** A room's bar: stock now █, ordered ▓, space left ░. */
export function roomBar(space: RoomSpace, cells = BAR_W): Line {
  const [store, ordered, free] = barCells([space.inStore, space.ordered], space.capacity, cells) as [number, number, number];
  return cat(s('█'.repeat(store), 'rs'), s('▓'.repeat(ordered), 'ro'), s('░'.repeat(free), 'rf'));
}

/** A room's name, its bar and how full it is, with a warning when the order does not fit. */
function roomLine(kept: Kept, space: RoomSpace): Line {
  const over = space.overPct > 0;
  return cat(
    s(KEPT_LABEL[kept].padEnd(LABEL_W), 'b'),
    roomBar(space),
    s(` ${String(space.pct).padStart(3)}%`, over ? 'w' : ''),
    over ? s(`  over by ${space.overPct}%`, 'w') : [],
  );
}

/** Pads a line with spaces out to `w` columns. */
function padTo(line: Line, w: number): Line {
  return cat(line, s(' '.repeat(Math.max(0, w - width(line)))));
}

function orderCell(app: App, supply: Supply, r: number): Line {
  const editing = r === app.supplySel;
  if (editing) return s(`[${String(supply.amount(r)).padStart(3)}_]`.padStart(8), 'cur');
  const amount = supply.amount(r);
  return s(String(amount).padStart(8), amount === 0 ? 'd' : 'acc');
}

/** What a row's amount costs, or a dash while nothing is ordered. */
function costCell(supply: Supply, r: number, cls: string): Line {
  const cost = supply.cost(r);
  return s((cost > 0 ? formatMoney(cost) : '—').padStart(8), cls);
}

/** Who rang to have this item put on tomorrow's order, as lines for the panel. */
function noteLines(supply: Supply, itemId: string): Line[] {
  const who = supply.notes.get(itemId)?.map((n) => n.client);
  if (!who || who.length === 0) return [];
  const names = who.length > 2 ? `${who.slice(0, 2).join(', ')} +${who.length - 2}` : who.join(', ');
  const [first = '', ...rest] = wrapText(`${names} rang: add it to tomorrow's order`, PANEL_W - 4);
  return [s(` ← ${first}`, 'w'), ...rest.slice(0, 2).map((t) => s(`   ${t}`, 'w'))];
}

/** What the order costs, the cash in the bank now and what is left of it; amber, with a line to say so, when it falls below zero. */
function moneyLines(app: App, supply: Supply): Line[] {
  const cost = supply.totalCost();
  const left = app.cash - cost;
  const short = supply.shortfall(app.cash);
  const line = (label: string, amount: number, extra = ''): Line =>
    cat(s(` ${label.padEnd(MONEY_LABEL_W)}`, extra), moneySeg(amount, formatMoney(amount).padStart(MONEY_W), extra));
  return [
    s(' MONEY', 'b'),
    line('Order costs', cost),
    line('Cash now', app.cash),
    line('Cash after', left, 'b'),
    ...(short > 0
      ? [s(` This order leaves you ${formatMoney(short)} short.`, 'w'), s(' You can still place it; the cash goes below zero.', 'd')]
      : []),
  ];
}

/** The right-hand side, one line per screen line: the legend, a room bar for each room, the money, then the note for the highlighted row. */
function panel(app: App, supply: Supply): Line[] {
  const out: Line[] = [legend(), []];
  for (const kept of KEPT_ORDER) out.push(cat(s(' '), roomLine(kept, supply.roomSpace(kept))));
  out.push([], ...moneyLines(app, supply));
  const row = supply.rows[app.supplySel];
  if (row) out.push([], ...noteLines(supply, row.item.id));
  return out;
}

function rows(app: App, supply: Supply): Line[] {
  const out: Line[] = [titles()];
  let kept: string | null = null;
  supply.rows.forEach((row, r) => {
    if (row.kept !== kept) {
      kept = row.kept;
      out.push(s(` ${KEPT_LABEL[row.kept]}`, 'b'));
    }
    const current = r === app.supplySel;
    const done = supply.isConfirmed(r);
    const noted = (supply.notes.get(row.item.id)?.length ?? 0) > 0;
    const rest = `${String(row.onHand).padStart(8)}${String(row.usual).padStart(7)}${formatMoney(supply.price(r)).padStart(7)}`;
    const base = done && !current ? 'd' : '';
    const hl = (cls: string) => (current ? `${cls} hl`.trim() : cls);
    out.push(cat(
      s(current ? '▶' : done ? '✓' : ' ', hl(base)),
      s(row.item.name.padEnd(NAME_W), hl(noted ? 'w' : base)),
      s(rest, hl(base)),
      orderCell(app, supply, r),
      costCell(supply, r, current ? (supply.cost(r) > 0 ? 'acc hl' : 'hl') : done || supply.cost(r) === 0 ? 'd' : 'acc'),
    ));
  });
  const side = panel(app, supply);
  while (out.length < side.length) out.push([]);
  return out.map((line, i) => (side[i] && side[i]!.length ? cat(padTo(line, PANEL_AT), side[i]!) : line));
}

export function supplyScreen(app: App): Line[] {
  const supply = app.supply;
  const top = header('SUPPLIER ORDER', clockLine(app.morning.day, SUPPLIER_MINUTE, false, app.cash));
  if (!supply) return layout(top, [], [rule(), [], keyBar([['F2', 'colours'], ['F4', 'sound']])]);
  const body = rows(app, supply);
  const status = app.status
    ? s(` ${app.status}`, app.tone === 'warn' ? 'w' : 'acc')
    : s(` Tomorrow's order: ${plural(supply.ordered().length, 'item')}, ${plural(supply.total(), 'unit')}. Stock arrives the next morning.`, 'd');
  const keys: Array<readonly [string, string]> = [
    ['SPACE', 'hold: order'], ['↑↓', 'move'], ['0-9 ←→', 'amount'], ['ENTER', 'next row'], ['U', 'row'], ['A', 'all'], ['ESC', 'back'],
  ];
  return layout(top, body, [rule(), status, keyBar([...keys, ['H', 'how to play'], ['F2', 'colours'], ['F4', 'sound']])]);
}
