import type { App } from '../app';
import { cat, header, keyBar, layout, rule, s, wrapText, ROWS, type Line } from '../grid';
import { HELP_PAGES, type HelpBlock } from '../help';

/** Text starts one column in, and wraps before it gets near the right edge. */
const TEXT_W = 114;
/** Rows for a page's text: the screen less the header (2), the footer (3) and the page names with a blank row under them (2). */
export const HELP_ROOM = ROWS - 2 - 3 - 2;

/** A paragraph as lines, with each {KEY} set apart in the accent colour (the warning colour for a ! marker) and the braces left off. */
function paragraph(text: string): Line[] {
  return wrapText(text, TEXT_W).map((row) =>
    cat(
      s(' '),
      ...row
        .split(/(\{[^}]+\})/)
        .filter(Boolean)
        .map((part): Line => (part.startsWith('{') ? s(part.slice(1, -1), part.startsWith('{!') ? 'w b' : 'acc') : s(part))),
    ),
  );
}

/** The lines of one page, without the header and the footer. */
export function helpLines(blocks: readonly HelpBlock[]): Line[] {
  return blocks.flatMap((block, i): Line[] => [
    ...(i > 0 ? [[]] : []),
    ...(block.head ? [s(` ${block.head}`, 'b')] : []),
    ...paragraph(block.text),
  ]);
}

/** The names of the pages along the top, the one being read lit. */
function pageNames(page: number): Line {
  return cat(
    s(' '),
    ...HELP_PAGES.flatMap((p, i): Line[] => [i > 0 ? s('  ') : [], s(` ${i + 1} ${p.name} `, i === page ? 'hl' : 'd')]),
  );
}

export function helpScreen(app: App): Line[] {
  const page = app.helpPage;
  const top = header('HOW TO PLAY', s(`page ${page + 1} of ${HELP_PAGES.length}  `, 'd'));
  const body: Line[] = [pageNames(page), [], ...helpLines(HELP_PAGES[page]?.blocks ?? [])];
  const status = app.status ? s(` ${app.status}`, app.tone === 'warn' ? 'w' : 'acc') : [];
  const keys = keyBar([['←→ PgUp PgDn', 'turn the page'], ['H ESC', 'back to the game'], ['F2', 'colours'], ['F4', 'sound']]);
  return layout(top, body, [rule(), status, keys]);
}
