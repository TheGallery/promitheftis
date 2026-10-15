/** Screen text is built as lines of coloured segments, then written out as HTML. */
export type Seg = readonly [text: string, cls: string];
export type Line = Seg[];

export const COLS = 120;
export const ROWS = 30;

let strict = false;
/** In strict mode a line wider than its column throws instead of being cut. */
export function setStrictWidths(on: boolean): void {
  strict = on;
}

export function s(text: string, cls = ''): Line {
  return text === '' && cls === '' ? [] : [[text, cls]];
}

export function cat(...parts: Line[]): Line {
  return parts.flat();
}

export function width(line: Line): number {
  let n = 0;
  for (const [t] of line) n += [...t].length;
  return n;
}

/** Cuts text to `w` characters, ending with "…" if anything was lost. */
export function clip(text: string, w: number): string {
  const chars = [...text];
  return chars.length <= w ? text : chars.slice(0, Math.max(0, w - 1)).join('') + '…';
}

/** Breaks text into lines of at most `w` characters at spaces. */
export function wrapText(text: string, w: number): string[] {
  const out: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = current ? `${current} ${word}` : word;
    if ([...next].length <= w) current = next;
    else {
      if (current) out.push(current);
      current = clip(word, w);
    }
  }
  if (current) out.push(current);
  return out;
}

/** Cuts a line to `w` columns, ending with "…" if anything was lost. */
function cut(line: Line, w: number): Line {
  const out: Line = [];
  let left = w - 1;
  for (const [t, c] of line) {
    const chars = [...t];
    if (chars.length <= left) {
      out.push([t, c]);
      left -= chars.length;
    } else {
      out.push([chars.slice(0, left).join('') + '…', c]);
      return out;
    }
  }
  return out;
}

/** Pads a line with spaces to exactly `w` columns. */
export function pad(line: Line, w: number): Line {
  const n = width(line);
  if (n > w) {
    if (strict) throw new Error(`line is ${n} wide, room for ${w}: ${line.map(([t]) => t).join('')}`);
    return cut(line, w);
  }
  // A highlighted row stays highlighted to the end of its column.
  const fill = line[line.length - 1]?.[1] === 'hl' ? 'hl' : '';
  return n === w ? line : [...line, [' '.repeat(w - n), fill]];
}

/** Puts `left` and `right` at the two ends of a `w`-column line. */
export function spread(left: Line, right: Line, w = COLS): Line {
  const gap = w - width(left) - width(right);
  return cat(left, s(' '.repeat(Math.max(1, gap))), right);
}

/** Side-by-side panes, each padded to its width, joined by a thin rule. */
export function cols(parts: Line[], widths: number[], sep = '│'): Line {
  const out: Line = [];
  parts.forEach((p, i) => {
    if (i) out.push([sep, 'd']);
    out.push(...pad(p, widths[i] ?? 0));
  });
  return out;
}

export function rule(w = COLS): Line {
  return s('─'.repeat(w), 'd');
}

/** A bar of `cells` blocks, filled to `pct` per cent. */
export function bar(pct: number, cells: number, extra = ''): Line {
  const n = Math.max(0, Math.min(cells, Math.round((pct / 100) * cells)));
  return cat(s('█'.repeat(n), `bf ${extra}`.trim()), s('░'.repeat(cells - n), `be ${extra}`.trim()));
}

/** Header line and rule: title on the left, date and clock on the right. */
export function header(title: string, right: Line): Line[] {
  return [spread(s(' PROMITHEFTIS · ' + title, 'b'), right), rule()];
}

/** The key-hint bar along the bottom of every screen. */
export function keyBar(pairs: ReadonlyArray<readonly [key: string, label: string]>): Line {
  const out: Line = [[' ', 'kbar']];
  pairs.forEach(([k, label], i) => {
    if (i) out.push(['  ', 'kbar']);
    out.push([k, 'k'], [' ' + label, 'kbar']);
  });
  return pad(out, COLS).map(([t, c]): Seg => [t, c === '' ? 'kbar' : c]);
}

/** A window of `visible` rows onto `total` rows, centred on `selected`. */
export function windowStart(total: number, selected: number, visible: number): number {
  if (total <= visible) return 0;
  return Math.max(0, Math.min(total - visible, selected - Math.floor(visible / 2)));
}

/**
 * Takes the rows of a list that fit in `visible` lines around `selected`.
 * When rows are hidden, the first or last line says how many.
 */
export function scrollRows(rows: Line[], selected: number, visible: number): Line[] {
  if (rows.length <= visible) return rows;
  const start = windowStart(rows.length, selected, visible);
  const end = start + visible;
  const out = rows.slice(start, end);
  if (start > 0) out[0] = s(`   ↑ ${start + 1} more`, 'd');
  if (end < rows.length) out[out.length - 1] = s(`   ↓ ${rows.length - end + 1} more`, 'd');
  return out;
}

/** Makes a screen exactly COLS wide and ROWS tall. */
export function fitScreen(lines: Line[]): Line[] {
  const out = lines.slice(0, ROWS).map((l) => pad(l, COLS));
  while (out.length < ROWS) out.push(pad([], COLS));
  return out;
}

/** The part of a line from column `from` up to column `to`. */
function slice(line: Line, from: number, to: number): Line {
  const out: Line = [];
  let at = 0;
  for (const [text, cls] of line) {
    const chars = [...text];
    const a = Math.max(from, at);
    const b = Math.min(to, at + chars.length);
    if (a < b) out.push([chars.slice(a - at, b - at).join(''), cls]);
    at += chars.length;
    if (at >= to) break;
  }
  return out;
}

/** Puts `box` (every line the same width) over a screen, its top left corner at row `top`, column `left`. */
export function overlay(screen: Line[], box: Line[], top: number, left: number): Line[] {
  const w = box.length ? width(box[0] as Line) : 0;
  return screen.map((row, r) => {
    const over = box[r - top];
    if (!over) return row;
    const full = pad(row, COLS);
    return [...slice(full, 0, left), ...over, ...slice(full, left + w, COLS)];
  });
}

export function plain(lines: Line[]): string[] {
  return lines.map((l) => l.map(([t]) => t).join(''));
}

function escapeHtml(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Anything outside plain ASCII goes in a one-column box, so a symbol that a
 * fallback font draws at a different width cannot push the columns out of line.
 */
function glyphs(t: string): string {
  let out = '';
  for (const ch of t) {
    const code = ch.codePointAt(0) ?? 0;
    out += code > 126 ? `<i>${escapeHtml(ch)}</i>` : escapeHtml(ch);
  }
  return out;
}

export function toHtml(lines: Line[]): string {
  return lines
    .map((line) => line.map(([t, c]) => (c ? `<span class="${c}">${glyphs(t)}</span>` : glyphs(t))).join(''))
    .join('\n');
}

/**
 * A full screen: the top lines, then the body padded or cut to fill the room
 * between, then the footer fixed to the bottom of the screen.
 */
export function layout(top: Line[], body: Line[], footer: Line[]): Line[] {
  const room = Math.max(0, ROWS - top.length - footer.length);
  const mid = body.slice(0, room);
  while (mid.length < room) mid.push([]);
  return fitScreen([...top, ...mid, ...footer]);
}
