import { describe, expect, it } from 'vitest';
import { median, playRun, summarise, type DayStat, type Policy } from './sim';

/**
 * What thinking is worth: the real game played through its keys by `sim.ts`, once pressing ENTER, SPACE and A
 * everywhere and once with its head, over several seeds and more than three weeks, on both mornings. If a number
 * here moves, the game's economy has moved: look at what changed before changing the limits.
 */
const SEEDS = [1, 2, 3, 4, 5, 6];
const DAYS = 24;
/** The days from which the figures are taken: the first two are the fixed morning and its day after. */
const FROM = 3;

const cache = new Map<string, DayStat[][]>();
function runs(kind: 'small' | 'big', policy: Policy): DayStat[][] {
  const key = `${kind}/${policy}`;
  if (!cache.has(key)) cache.set(key, SEEDS.map((seed) => playRun(kind, policy, seed, DAYS)));
  return cache.get(key) as DayStat[][];
}

const later = (kind: 'small' | 'big', policy: Policy) => runs(kind, policy).flatMap((r) => r.filter((d) => d.day >= FROM));

describe.each(['small', 'big'] as const)('the %s morning', (kind) => {
  it('plays every day of every run to the end: nothing ends the game, with or without thinking', () => {
    for (const policy of ['blind', 'careful'] as const) {
      for (const run of runs(kind, policy)) expect(run.map((d) => d.day)).toEqual(Array.from({ length: DAYS }, (_, i) => i + 1));
    }
  });

  it('pays a careful player clearly more than one who presses ENTER, SPACE and A', () => {
    const blind = summarise(runs(kind, 'blind'), FROM).profit;
    const careful = summarise(runs(kind, 'careful'), FROM).profit;
    expect(careful).toBeGreaterThan(0);
    // Thinking is worth at least a quarter more than pressing buttons, on either morning.
    expect(blind).toBeLessThanOrEqual(careful * 0.8);
  });

  it('asks for more times than it used to, and a late order costs money', () => {
    const asked = later(kind, 'blind').reduce((sum, d) => sum + d.timed, 0) / later(kind, 'blind').reduce((sum, d) => sum + d.orders, 0);
    expect(asked).toBeGreaterThan(0.25);
    expect(summarise(runs(kind, 'blind'), FROM).lateCut).toBeGreaterThan(0);
  });

  it('pays a careful player for planning the routes against the times asked: nearly all in time, and few pounds lost to late orders', () => {
    const blind = summarise(runs(kind, 'blind'), FROM);
    const careful = summarise(runs(kind, 'careful'), FROM);
    expect(careful.late / careful.timed).toBeLessThan(0.1);
    expect(blind.late / blind.timed).toBeGreaterThan(0.2);
    expect(careful.lateCut).toBeLessThan(blind.lateCut / 5);
  });

  it('keeps blind play calm: it still makes money and most clients are pleased, only less than for a careful player', () => {
    const blind = summarise(runs(kind, 'blind'), FROM);
    expect(blind.profit).toBeGreaterThan(0);
    expect(blind.pleased).toBeGreaterThan(0.5);
    expect(blind.minCash).toBeGreaterThan(0);
  });

  it('leaves a careful day in profit', () => {
    const days = later(kind, 'careful');
    expect(median(days.map((d) => d.profit))).toBeGreaterThan(0);
    expect(days.filter((d) => d.profit > 0).length / days.length).toBeGreaterThanOrEqual(0.9);
  });

  it('never needs the cash to go below zero for a careful player, who is never left without a truck', () => {
    const careful = summarise(runs(kind, 'careful'), 1);
    expect(careful.minCash).toBeGreaterThanOrEqual(0);
    expect(careful.stranded).toBeLessThan(0.5);
  });

  it('makes a truck and a room cost about two or three good days of a careful player', () => {
    const days = later(kind, 'careful');
    const profit = median(days.map((d) => d.profit));
    for (const price of ['truckPrice', 'roomPrice'] as const) {
      const inDays = median(days.map((d) => d[price])) / profit;
      expect(inDays).toBeGreaterThanOrEqual(1.8);
      expect(inDays).toBeLessThanOrEqual(3);
    }
  });

  it('makes rooms matter: stock spoils for the player who never looks at the bars, and not for the one who does', () => {
    expect(summarise(runs(kind, 'blind'), FROM).spoiled).toBeGreaterThan(5);
    expect(summarise(runs(kind, 'careful'), FROM).spoiled).toBeLessThan(1);
  });

  it('makes a careful player\'s clients happier than a blind one\'s', () => {
    expect(summarise(runs(kind, 'careful'), FROM).pleased).toBeGreaterThan(summarise(runs(kind, 'blind'), FROM).pleased + 0.2);
  });

  it('shows grouping orders by place in pounds on the very first morning: the same orders cost less to send', () => {
    const first = (policy: Policy) => runs(kind, policy)[0]![0]!;
    expect(first('careful').trucks).toBeLessThan(first('blind').trucks);
  });

  it('plays the same days again for the same seed', () => {
    expect(playRun(kind, 'careful', SEEDS[0]!, 6)).toEqual(runs(kind, 'careful')[0]!.slice(0, 6));
  });
});
