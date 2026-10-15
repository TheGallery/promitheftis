import { describe, expect, it } from 'vitest';
import { STARTING_CASH } from '../src/game/money';
import { median, playRun, summarise, type DayStat, type GrowthRule, type Policy } from './sim';

/**
 * What thinking is worth: the real game played through its keys by `sim.ts`, once pressing ENTER, SPACE and A
 * everywhere (and taking the first growth option) and once with its head (reading the growth screen), over several seeds
 * and more than three weeks, on both mornings. If a number here moves, the game's economy has moved: look at what
 * changed before changing the limits.
 */
const SEEDS = [1, 2, 3, 4, 5, 6];
const DAYS = 24;
/** The days from which the figures are taken: the first two are the fixed morning and its day after. */
const FROM = 3;

const cache = new Map<string, DayStat[][]>();
function runs(kind: 'small' | 'big', policy: Policy, rule: GrowthRule = policy === 'blind' ? 'first' : 'screen'): DayStat[][] {
  const key = `${kind}/${policy}/${rule}`;
  if (!cache.has(key)) cache.set(key, SEEDS.map((seed) => playRun(kind, policy, seed, DAYS, rule)));
  return cache.get(key) as DayStat[][];
}

const later = (kind: 'small' | 'big', policy: Policy) => runs(kind, policy).flatMap((r) => r.filter((d) => d.day >= FROM));

describe.each(['small', 'big'] as const)('the %s morning', (kind) => {
  it('plays every day of every run to the end: nothing ends the game, with or without thinking', () => {
    for (const policy of ['blind', 'careful'] as const) {
      for (const run of runs(kind, policy)) expect(run.map((d) => d.day)).toEqual(Array.from({ length: DAYS }, (_, i) => i + 1));
    }
  });

  it('pays a careful player clearly more than one who presses ENTER, SPACE and A and takes the first growth option', () => {
    const blind = summarise(runs(kind, 'blind'), FROM);
    const careful = summarise(runs(kind, 'careful'), FROM);
    expect(careful.profit).toBeGreaterThan(0);
    // Thinking is worth about a fifth more each day than pressing buttons, and a lot more in the bank, since the first option
    // is a truck every night and every truck is paid for.
    expect(blind.profit).toBeLessThanOrEqual(careful.profit * 0.85);
    expect(blind.cash).toBeLessThanOrEqual(careful.cash * 0.6);
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
    // Taking the first growth option every night can leave the bank in debt for a while, which stops nothing; it stays within reach of the start.
    expect(blind.minCash).toBeGreaterThan(-2 * STARTING_CASH);
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

  it('makes each truck dearer than the last: the truck price climbs with the fleet, day after day, for a player who keeps buying them', () => {
    for (const run of runs(kind, 'careful', 'truck')) {
      const bought = run.filter((d) => d.grew === 'truck');
      expect(bought.length).toBeGreaterThan(5);
      for (let i = 1; i < bought.length; i++) expect(bought[i]!.truckPrice).toBeGreaterThan(bought[i - 1]!.truckPrice);
    }
  });

  it('makes buying a truck every night a poor plan: the fleet stands idle and the bank stays thin', () => {
    const always = summarise(runs(kind, 'careful', 'truck'), FROM);
    const reading = summarise(runs(kind, 'careful'), FROM);
    expect(always.load).toBeLessThan(0.6);
    expect(reading.load).toBeGreaterThan(always.load + 0.15);
    expect(always.trucksOwned).toBeGreaterThan(reading.trucksOwned);
    expect(always.cash).toBeLessThan(reading.cash * 0.8);
  });

  it('makes rooms matter: stock spoils for the player who never looks at the bars and keeps taking clients, and not for the one who does', () => {
    expect(summarise(runs(kind, 'blind', 'client'), FROM).spoiled).toBeGreaterThan(5);
    expect(summarise(runs(kind, 'careful'), FROM).spoiled).toBeLessThan(1);
  });

  it('makes a careful player\'s clients happier than a blind one\'s', () => {
    expect(summarise(runs(kind, 'careful'), FROM).pleased).toBeGreaterThan(summarise(runs(kind, 'blind'), FROM).pleased + 0.2);
  });

  it('shows grouping orders by place in pounds on the very first morning: the same orders cost less to send', () => {
    const first = (policy: Policy) => runs(kind, policy)[0]![0]!;
    expect(first('careful').trucks).toBeLessThan(first('blind').trucks);
  });

  it('leaves the supplier short on about one day in four or five, for both players alike, and never on the first morning', () => {
    for (const policy of ['blind', 'careful'] as const) {
      const days = runs(kind, policy).flat();
      expect(days.filter((d) => d.day === 1 && d.supplierShort)).toHaveLength(0);
      const share = days.filter((d) => d.day > 1 && d.supplierShort).length / days.filter((d) => d.day > 1).length;
      expect(share).toBeGreaterThan(0.15);
      expect(share).toBeLessThan(0.3);
    }
    expect(runs(kind, 'blind').map((r) => r.map((d) => d.supplierShort))).toEqual(runs(kind, 'careful').map((r) => r.map((d) => d.supplierShort)));
  });

  it('pays a careful player clearly more than a blind one on a day the supplier is short: sharing the scarce stock out keeps clients pleased', () => {
    const short = (d: DayStat) => d.supplierShort;
    const blind = summarise(runs(kind, 'blind'), FROM, short);
    const careful = summarise(runs(kind, 'careful'), FROM, short);
    expect(careful.profit).toBeGreaterThan(0);
    expect(careful.pleased).toBeGreaterThan(0.8);
    expect(careful.pleased).toBeGreaterThan(blind.pleased + 0.25);
    expect(careful.inFull).toBeGreaterThan(blind.inFull + 0.15);
    expect(blind.profit).toBeLessThan(careful.profit * 0.5);
  });

  it('keeps blind play calm on a short day: it costs a little, and does not turn the clients against it any further', () => {
    const short = summarise(runs(kind, 'blind'), FROM, (d) => d.supplierShort);
    const usual = summarise(runs(kind, 'blind'), FROM, (d) => !d.supplierShort);
    expect(short.pleased).toBeGreaterThan(0.4);
    expect(short.pleased).toBeGreaterThan(usual.pleased - 0.15);
    expect(short.profit).toBeGreaterThan(-STARTING_CASH / 10);
  });

  it('plays the same days again for the same seed', () => {
    expect(playRun(kind, 'careful', SEEDS[0]!, 6)).toEqual(runs(kind, 'careful')[0]!.slice(0, 6));
  });
});

/** Averages of one figure over the days where a truck was at the garage, or over the days where none was, leaving out the days the supplier was short so that one event does not blur the other. */
const onDays = (days: DayStat[], garage: boolean, figure: (d: DayStat) => number) => {
  const picked = days.filter((d) => d.garage === garage && !d.supplierShort);
  return picked.reduce((sum, d) => sum + figure(d), 0) / picked.length;
};
const inFull = (d: DayStat) => d.inFull / d.orders;
const pleased = (d: DayStat) => d.pleased / d.orders;

describe.each(['small', 'big'] as const)('a truck at the garage, on the %s morning', (kind) => {
  it('comes on about one day in four or five, and never on the first', () => {
    for (const policy of ['blind', 'careful'] as const) {
      const days = runs(kind, policy).flatMap((r) => r.filter((d) => d.day > 1));
      const share = days.filter((d) => d.garage).length / days.length;
      expect(share).toBeGreaterThan(0.1);
      expect(share).toBeLessThan(0.32);
      for (const run of runs(kind, policy)) expect(run[0]!.garage).toBe(false);
    }
  });

  it('is handled clearly better by a careful player: the orders still go out, and blind play leaves more of them short', () => {
    const blind = later(kind, 'blind');
    const careful = later(kind, 'careful');
    expect(onDays(careful, true, inFull)).toBeGreaterThan(onDays(blind, true, inFull) + 0.2);
    expect(onDays(careful, true, pleased)).toBeGreaterThan(onDays(blind, true, pleased) + 0.2);
    expect(onDays(careful, true, (d) => d.stranded)).toBeLessThan(0.5);
    expect(onDays(blind, true, (d) => d.stranded)).toBeGreaterThan(onDays(blind, false, (d) => d.stranded));
  });

  it('does not make blind play collapse: it still earns on those days, and still pleases most of its clients about as often as it does', () => {
    const blind = later(kind, 'blind');
    expect(onDays(blind, true, (d) => d.profit)).toBeGreaterThan(0);
    expect(onDays(blind, true, pleased)).toBeGreaterThan(onDays(blind, false, pleased) - 0.15);
    expect(onDays(blind, true, pleased)).toBeGreaterThan(0.4);
  });

  it('costs a careful player little', () => {
    const careful = later(kind, 'careful');
    const dip = onDays(careful, false, inFull) - onDays(careful, true, inFull);
    expect(dip).toBeLessThan(0.15);
    expect(onDays(careful, true, (d) => d.profit)).toBeGreaterThan(0);
  });
});

it('hurts a small fleet more than a big one: with no spare truck, a careful player loses more orders', () => {
  const dip = (kind: 'small' | 'big') => {
    const careful = later(kind, 'careful');
    return onDays(careful, false, inFull) - onDays(careful, true, inFull);
  };
  expect(dip('small')).toBeGreaterThan(dip('big') + 0.03);
});

describe.each(['small', 'big'] as const)('what to grow, on the %s morning', (kind) => {
  const reading = () => summarise(runs(kind, 'careful', 'screen'), FROM);
  const rules = ['client', 'truck'] as const;

  it.each(rules)('is not settled by always taking %s: reading the screen earns more each day and leaves clients happier', (rule) => {
    const fixed = summarise(runs(kind, 'careful', rule), FROM);
    expect(reading().profit).toBeGreaterThan(fixed.profit);
    expect(reading().pleased).toBeGreaterThan(fixed.pleased + 0.05);
  });

  it('is not settled by always taking a new client: the trucks stay full and the orders are cut to fit them', () => {
    const always = summarise(runs(kind, 'careful', 'client'), FROM);
    expect(reading().profit).toBeGreaterThan(always.profit * 1.1);
    expect(reading().pleased).toBeGreaterThan(always.pleased + 0.15);
    expect(always.load).toBeGreaterThan(0.7);
    expect(always.trucksOwned).toBeLessThan(reading().trucksOwned);
    expect(always.clients).toBeGreaterThan(reading().clients);
  });

  it('has no rule that beats reading the screen on earnings, on happy clients and on cash all at once', () => {
    for (const rule of [...rules, 'first'] as const) {
      const fixed = summarise(runs(kind, 'careful', rule), FROM);
      const beats = [fixed.profit >= reading().profit, fixed.pleased >= reading().pleased, fixed.cash >= reading().cash];
      expect(beats.every(Boolean)).toBe(false);
    }
  });

  it('still plays on and pays a profit for a player who always takes the first option', () => {
    const blind = summarise(runs(kind, 'blind', 'first'), FROM);
    expect(blind.profit).toBeGreaterThan(0);
    expect(blind.minCash).toBeGreaterThan(-2 * STARTING_CASH);
    expect(blind.load).toBeLessThan(reading().load);
  });
});
