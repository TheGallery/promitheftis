import { formatTime } from '../../game/clock';
import { happened, truckState, type Road, type RoadEvent } from '../../game/road';
import { place } from '../../game/places';
import { placesLabel, plural } from '../format';
import type { App } from '../app';
import type { Call } from '../../game/calls';
import { cat, clip, cols, header, keyBar, layout, rule, s, wrapText, type Line } from '../grid';
import { clockLine } from './common';

const LOG_W = 80;
const SIDE_W = 39;
const LOG_ROWS = 24;

function logLine(e: RoadEvent): Line {
  const when = `${formatTime(e.at)} `;
  switch (e.kind) {
    case 'leave':
      return cat(s(` ${when}`, 'd'), s(`Truck ${e.truckId}`, 'b'), s(` · leaves the depot · ${placesLabel(e.places, 30)} · ${plural(e.stops, 'stop')}`));
    case 'deliver':
      return cat(
        s(` ${when}`, 'd'),
        s(`Truck ${e.truckId}`, 'b'),
        s(` · ${clip(e.client, 28)}, ${place(e.place).name} · `),
        s(e.items > 0 ? plural(e.items, 'item') : 'nothing to unload', e.items > 0 ? 'acc' : 'd'),
      );
    case 'short': {
      const what = e.lines.map((l) => `${l.name} ${l.given} of ${l.asked}`).join(', ');
      return s(`       a little short: ${clip(what, 54)}`, 'w');
    }
    case 'back':
      return cat(s(` ${when}`, 'd'), s(`Truck ${e.truckId}`, 'b'), s(' · back at the depot', 'acc'));
  }
}

/** The answered call: who, what about and what was answered, with the client and topic shortened so the answer always shows. */
function answeredLine(app: App, c: Call): Line {
  const record = c.options[app.answers.get(c.id) ?? 0]?.record ?? '';
  // " HH:MM Call · " and ", " and " · " are 14 + 2 + 3 columns.
  const room = Math.max(0, LOG_W - 19 - [...record].length);
  const topic = clip(c.topic, Math.min(26, Math.max(10, room - 12)));
  const client = clip(c.client, Math.max(8, room - [...topic].length));
  return cat(s(` ${formatTime(c.at)} `, 'd'), s('Call', 'b'), s(` · ${client}, ${topic} · ${record}`, 'acc'));
}

/** The box for the call that is ringing: who, what they say, and the answers to pick from. */
function callBox(app: App, c: Call): Line[] {
  const where = app.morning.orders[c.orderIndex]?.place;
  const out: Line[] = [
    rule(LOG_W),
    cat(s(' INCOMING CALL', 'b'), s(` · ${clip(c.contact, 20)}, ${clip(c.client, 26)}${where ? `, ${place(where).name}` : ''}`)),
    ...wrapText(`"${c.say}"`, LOG_W - 4).slice(0, 3).map((row) => s(`   ${row}`)),
    [],
  ];
  c.options.forEach((o, i) => {
    const sel = i === app.callSel;
    out.push(s(`${sel ? '▶' : ' '} ${clip(o.label, LOG_W - 4)}`, sel ? 'hl' : ''));
  });
  return out;
}

function logColumn(app: App, road: Road, clock: number): Line[] {
  const ringing = app.roadCall;
  const box = ringing ? callBox(app, ringing) : [];
  const entries = [
    ...happened(road, clock).map((e) => ({ at: e.at, line: logLine(e), order: 1 })),
    ...app.calls.filter((c) => app.answers.has(c.id)).map((c) => ({ at: c.at, line: answeredLine(app, c), order: 2 })),
  ];
  // Events keep their own order; an answered call sits after everything that happened by the minute it rang.
  const lines = entries
    .map((e, i) => ({ ...e, i }))
    .sort((a, b) => a.at - b.at || a.order - b.order || a.i - b.i)
    .map((e) => e.line);
  const room = LOG_ROWS - box.length;
  const shown = lines.slice(-room);
  const hidden = lines.length - shown.length;
  const log = [cat(s(' ON THE ROAD', 'b'), s(hidden > 0 ? `   ${hidden} earlier lines above` : '', 'd')), ...shown];
  while (box.length > 0 && log.length < room + 1) log.push([]);
  return [...log, ...box];
}

function trucksColumn(road: Road, clock: number): Line[] {
  const out: Line[] = [s(' TRUCKS', 'b')];
  for (const t of road.trucks) {
    const state = truckState(t, clock);
    const done = t.stops.filter((x) => x.arriveAt <= clock).length;
    const text =
      state.kind === 'back' ? `back ${formatTime(state.at)}` : state.kind === 'stop' ? `at ${place(state.place).name}` : 'on the road';
    out.push(
      cat(
        s(` ${t.truckId} ${t.driver.padEnd(7)}`),
        s(text.padEnd(15), state.kind === 'back' ? 'acc' : state.kind === 'stop' ? 'b' : ''),
        s(`${done}/${t.stops.length}`.padStart(5), 'd'),
      ),
    );
  }
  return out;
}

export function roadScreen(app: App): Line[] {
  const road = app.road;
  const clock = app.roadClock;
  const top = header('ON THE ROAD', clockLine(app.morning.day, clock, false, app.cash));
  const body: Line[] = [];
  if (road) {
    const left = logColumn(app, road, clock);
    const right = trucksColumn(road, clock);
    for (let i = 0; i < Math.max(left.length, right.length); i++) body.push(cols([left[i] ?? [], right[i] ?? []], [LOG_W, SIDE_W]));
  }
  const over = app.roadOver;
  const ringing = app.roadCall;
  const status = ringing
    ? s(` ${clip(ringing.contact, 20)} from ${clip(ringing.client, 30)} is on the line.`, 'b')
    : over
      ? s(' Every truck is back at the depot.', 'acc')
      : s(' The trucks are out…', 'd');
  const keys: [string, string][] = ringing
    ? [['↑↓', 'choose an answer'], ['ENTER', 'answer the call']]
    : over
      ? [['SPACE', 'see how it went']]
      : [['SPACE', 'skip ahead']];
  return layout(top, body, [rule(), status, keyBar([...keys, ['H', 'how to play'], ['F2', 'colours'], ['F4', 'sound']])]);
}
