import { describe, expect, it } from 'vitest';
import { bar, clip, cols, layout, pad, plain, ROWS, s, scrollRows, setStrictWidths, toHtml, windowStart, wrapText } from '../src/ui/grid';

describe('grid helpers', () => {
  it('clips text with an ellipsis only when it is too long', () => {
    expect(clip('Hollin', 8)).toBe('Hollin');
    expect(clip('Southgate Leisure Centre', 10)).toBe('Southgate…');
  });

  it('wraps text at spaces', () => {
    expect(wrapText('one two three four', 9)).toEqual(['one two', 'three', 'four']);
    expect(wrapText('', 9)).toEqual([]);
  });

  it('pads a line to its column and keeps a highlight to the end', () => {
    const padded = pad(s('ab', 'hl'), 5);
    expect(plain([padded])[0]).toBe('ab   ');
    expect(padded[padded.length - 1]?.[1]).toBe('hl');
  });

  it('throws on a line that is too wide in strict mode and cuts it otherwise', () => {
    expect(() => pad(s('too wide'), 4)).toThrow(/room for 4/);
    setStrictWidths(false);
    try {
      expect(plain([pad(s('too wide'), 4)])[0]).toBe('too…');
    } finally {
      setStrictWidths(true);
    }
  });

  it('joins panes with a rule and pads each to its width', () => {
    expect(plain([cols([s('a'), s('b')], [3, 2])])[0]).toBe('a  │b ');
  });

  it('fills a bar by the per cent', () => {
    expect(plain([bar(50, 8)])[0]).toBe('████░░░░');
    expect(plain([bar(0, 4)])[0]).toBe('░░░░');
    expect(plain([bar(100, 4)])[0]).toBe('████');
  });

  it('keeps the selected row inside a window and says how many rows are hidden', () => {
    const rows = Array.from({ length: 30 }, (_, i) => s(`row ${i}`));
    expect(windowStart(30, 0, 10)).toBe(0);
    expect(windowStart(30, 29, 10)).toBe(20);
    const shown = plain(scrollRows(rows, 15, 10));
    expect(shown).toHaveLength(10);
    expect(shown).toContain('row 15');
    expect(shown[0]).toMatch(/↑ \d+ more/);
    expect(shown[9]).toMatch(/↓ \d+ more/);
    expect(plain(scrollRows(rows.slice(0, 5), 2, 10))).toHaveLength(5);
  });

  it('makes a screen of the right height with the footer at the bottom', () => {
    const screen = plain(layout([s('top')], [s('body')], [s('footer')]));
    expect(screen).toHaveLength(ROWS);
    expect(screen[0]?.trim()).toBe('top');
    expect(screen[ROWS - 1]?.trim()).toBe('footer');
  });

  it('puts every symbol outside ASCII in a box of one column and escapes markup', () => {
    expect(toHtml([s('a<b ▶', 'acc')])).toBe('<span class="acc">a&lt;b <i>▶</i></span>');
  });
});
