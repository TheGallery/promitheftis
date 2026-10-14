import { formatTime } from '../../game/clock';
import { happened, truckState, type Road, type RoadEvent } from '../../game/road';
import { place } from '../../game/places';
import { placesLabel, plural } from '../format';
import type { App } from '../app';
import { cat, clip, cols, header, keyBar, layout, rule, s, type Line } from '../grid';
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

function logColumn(road: Road, clock: number): Line[] {
  const lines = happened(road, clock).map(logLine);
  const shown = lines.slice(-LOG_ROWS);
  const hidden = lines.length - shown.length;
  return [cat(s(' ON THE ROAD', 'b'), s(hidden > 0 ? `   ${hidden} earlier lines above` : '', 'd')), ...shown];
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
  const top = header('ON THE ROAD', clockLine(clock));
  const body: Line[] = [];
  if (road) {
    const left = logColumn(road, clock);
    const right = trucksColumn(road, clock);
    for (let i = 0; i < Math.max(left.length, right.length); i++) body.push(cols([left[i] ?? [], right[i] ?? []], [LOG_W, SIDE_W]));
  }
  const over = app.roadOver;
  const status = over ? s(' Every truck is back at the depot.', 'acc') : s(' The trucks are out…', 'd');
  const keys: [string, string][] = over
    ? [['ENTER', 'see how it went']]
    : [['SPACE', 'skip to the end'], ['ENTER', 'skip to the end']];
  return layout(top, body, [rule(), status, keyBar([...keys, ['F2', 'colours'], ['F4', 'sound']])]);
}
