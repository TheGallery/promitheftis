import { describe, expect, it } from 'vitest';
import { moodEffect, moodFacts, moodOf, moodPoints, moodReasons, type MoodFacts } from '../src/game/moods';
import type { Call } from '../src/game/calls';
import type { OrderResult } from '../src/game/results';

const facts = (over: Partial<MoodFacts> = {}): MoodFacts => ({ percent: 100, late: false, shortCall: null, ...over });

describe('the mood rule', () => {
  it('is pleased with a complete delivery on time', () => {
    expect(moodOf(facts())).toBe('pleased');
  });

  it('is a bit let down by a short delivery, and let down by less than half', () => {
    expect(moodOf(facts({ percent: 99 }))).toBe('a bit let down');
    expect(moodOf(facts({ percent: 50 }))).toBe('a bit let down');
    expect(moodOf(facts({ percent: 49 }))).toBe('let down');
    expect(moodOf(facts({ percent: 0 }))).toBe('let down');
  });

  it('is a bit let down by a late truck even when everything came', () => {
    expect(moodOf(facts({ late: true }))).toBe('a bit let down');
  });

  it('adds up what went wrong', () => {
    expect(moodPoints(facts({ percent: 80, late: true }))).toBe(2);
    expect(moodOf(facts({ percent: 80, late: true }))).toBe('let down');
  });

  it('is let down by being told nothing more today after a short delivery', () => {
    expect(moodOf(facts({ percent: 80, shortCall: 'refused' }))).toBe('let down');
  });

  it('is softened by being promised the rest tomorrow, but never above pleased', () => {
    expect(moodOf(facts({ percent: 80, shortCall: 'promised' }))).toBe('pleased');
    expect(moodOf(facts({ percent: 0, shortCall: 'promised' }))).toBe('a bit let down');
    expect(moodOf(facts({ percent: 100, shortCall: 'promised' }))).toBe('pleased');
    expect(moodPoints(facts({ shortCall: 'promised' }))).toBe(0);
  });

  it('gives the reasons in plain words', () => {
    expect(moodReasons(facts())).toEqual(['got everything']);
    expect(moodReasons(facts({ percent: 75, late: true, shortCall: 'refused' }))).toEqual([
      'got 75% of the order',
      'came after the time asked',
      'was told nothing more today',
    ]);
    expect(moodReasons(facts({ percent: 60, shortCall: 'promised' }))).toContain('was promised the rest tomorrow');
    expect(moodReasons(facts({ percent: 0 }))).toEqual(['got nothing']);
    expect(moodReasons(facts({ percent: 0 }), true)).toEqual(['got no truck']);
  });
});

describe('the facts for an order', () => {
  const order = { orderIndex: 3, percent: 70, lateForAsk: true } as OrderResult;
  const call = (id: number, kind: Call['kind'], orderIndex: number): Call => ({
    id,
    kind,
    at: 0,
    orderIndex,
    client: 'x',
    contact: 'y',
    topic: 't',
    say: '',
    options: [{ label: 'a', record: 'a', addsToOrder: true }, { label: 'b', record: 'b' }],
  });

  it('takes the percent and lateness from the delivery', () => {
    expect(moodFacts(order, [], new Map())).toEqual({ percent: 70, late: true, shortCall: null });
  });

  it('reads the answer to the short call about this order only', () => {
    const calls = [call(0, 'short', 1), call(1, 'short', 3), call(2, 'forgot', 3)];
    expect(moodFacts(order, calls, new Map([[0, 1], [1, 0], [2, 1]])).shortCall).toBe('promised');
    expect(moodFacts(order, calls, new Map([[0, 0], [1, 1], [2, 0]])).shortCall).toBe('refused');
  });

  it('ignores a short call that was not answered', () => {
    expect(moodFacts(order, [call(1, 'short', 3)], new Map()).shortCall).toBeNull();
  });
});

describe('what yesterday\'s mood does to today\'s order', () => {
  it('leaves a pleased client, and one with no mood yet, asking for the usual amounts with no note', () => {
    expect(moodEffect('pleased')).toEqual({ scale: 1, note: null });
    expect(moodEffect(undefined)).toEqual(moodEffect('pleased'));
  });

  it('makes a client who was let down ask for a little less, and say so', () => {
    const bit = moodEffect('a bit let down');
    const let_down = moodEffect('let down');
    expect(bit.scale).toBeLessThan(1);
    expect(let_down.scale).toBeLessThan(bit.scale);
    expect(let_down.scale).toBeGreaterThan(0.5);
    expect(bit.note).toMatch(/\S/);
    expect(let_down.note).toMatch(/\S/);
    expect(bit.note).not.toBe(let_down.note);
  });
});
