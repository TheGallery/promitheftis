import { describe, expect, it } from 'vitest';
import { beforeTime, buildCalls, callLine } from '../src/game/calls';
import { DEPART_MINUTE, formatTime } from '../src/game/clock';
import { Desk } from '../src/game/desk';
import { bigMorning, smallMorning } from '../src/game/morning';
import { buildResult } from '../src/game/results';
import { buildRoad } from '../src/game/road';

function handOut(d: Desk, client: string, truck: number) {
  const o = d.morning.orders.findIndex((x) => x.client === client);
  d.morning.orders[o]!.lines.forEach((_, l) => d.acceptLine(o, l));
  d.assignTruck(o, truck);
  d.finishOrder(o);
}

function smallDay() {
  const d = new Desk(smallMorning());
  const trucks: Record<string, number> = {
    'Café Lumen': 1, "Rosa's": 2, 'The Anchor': 2, 'Golden Dragon': 1, 'Hotel Bellevue': 1, 'Burger Shack': 1, 'The Plough': 2,
  };
  for (const [client, truck] of Object.entries(trucks)) handOut(d, client, truck);
  const result = buildResult(d, DEPART_MINUTE);
  const road = buildRoad(d, result);
  return { d, result, road, calls: buildCalls(d, result, road) };
}

describe('buildCalls', () => {
  it('has two or three calls in the small morning, in time order, while the trucks are out', () => {
    const { calls, road } = smallDay();
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.length).toBeLessThanOrEqual(3);
    expect(calls.map((c) => c.id)).toEqual(calls.map((_, i) => i));
    const times = calls.map((c) => c.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(new Set(times).size).toBe(times.length);
    for (const c of calls) {
      expect(c.at).toBeGreaterThan(road.departAt);
      expect(c.at).toBeLessThan(road.end);
    }
  });

  it('is always the same for the same morning', () => {
    expect(smallDay().calls).toEqual(smallDay().calls);
  });

  it('comes from real clients who were visited, each with two or three answers', () => {
    const { d, result, calls } = smallDay();
    for (const c of calls) {
      expect(d.order(c.orderIndex).client).toBe(c.client);
      expect(result.orders[c.orderIndex]!.arriveAt).not.toBeNull();
      expect(c.options.length).toBeGreaterThanOrEqual(2);
      expect(c.options.length).toBeLessThanOrEqual(3);
    }
    expect(new Set(calls.map((c) => c.client)).size).toBe(calls.length);
  });

  it('has a short client ask whether more is coming, after the truck was there', () => {
    const { result, calls } = smallDay();
    const call = calls.find((c) => c.kind === 'short');
    expect(call).toBeDefined();
    const order = result.orders[call!.orderIndex]!;
    expect(order.shortLines.length).toBeGreaterThan(0);
    expect(call!.at).toBeGreaterThan(order.arriveAt!);
    expect(call!.say).toMatch(/Is some (more )?coming/);
  });

  it('has a client forgetting something they did not order, after the delivery', () => {
    const { d, result, calls } = smallDay();
    const call = calls.find((c) => c.kind === 'forgot');
    expect(call).toBeDefined();
    expect(call!.at).toBeGreaterThan(result.orders[call!.orderIndex]!.arriveAt!);
    const ordered = d.order(call!.orderIndex).lines.map((l) => d.item(l.item).name.split(',')[0]!.toLowerCase());
    expect(ordered.some((name) => call!.say.includes(name))).toBe(false);
  });

  it('quotes a delivery time that matches the route', () => {
    const { result, calls } = smallDay();
    const call = calls.find((c) => c.kind === 'time');
    expect(call).toBeDefined();
    const arrive = result.orders[call!.orderIndex]!.arriveAt!;
    expect(call!.at).toBeLessThan(arrive);
    expect(call!.options[0]!.label).toContain(formatTime(arrive));
    // "Before" is a time the truck beats, never one it misses.
    for (const o of call!.options) {
      const quoted = o.label.match(/(\d\d:\d\d)/)![1]!;
      const [h, m] = quoted.split(':').map(Number) as [number, number];
      expect(h * 60 + m).toBeGreaterThanOrEqual(arrive);
    }
    expect(beforeTime(arrive)).toBeGreaterThan(arrive);
    expect(beforeTime(arrive) % 15).toBe(0);
  });

  it('writes a short line for each answer', () => {
    const { calls } = smallDay();
    const call = calls.find((c) => c.kind === 'short')!;
    expect(callLine(call, 0)).toBe(`${call.client} · ${call.topic} · added to tomorrow`);
    expect(callLine(call, 1)).toContain('told not today');
  });

  it('rings nobody when nothing went out', () => {
    const d = new Desk(smallMorning());
    const result = buildResult(d, DEPART_MINUTE);
    expect(buildCalls(d, result, buildRoad(d, result))).toEqual([]);
  });

  it('has a few more calls in the big morning, all before the last truck is back', () => {
    const d = new Desk(bigMorning());
    d.morning.orders.forEach((order, o) => {
      order.lines.forEach((_, l) => d.acceptLine(o, l));
      for (const t of d.morning.trucks) if (d.assignTruck(o, t.id).ok) break;
      d.finishOrder(o);
    });
    const result = buildResult(d, DEPART_MINUTE);
    const road = buildRoad(d, result);
    const calls = buildCalls(d, result, road);
    expect(calls.length).toBeGreaterThan(smallDay().calls.length);
    expect(calls.length).toBeLessThanOrEqual(5);
    for (const c of calls) expect(c.at).toBeLessThan(road.end);
    const times = calls.map((c) => c.at);
    expect(new Set(times).size).toBe(times.length);
  });
});
