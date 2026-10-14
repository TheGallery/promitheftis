import { describe, expect, it } from 'vitest';
import { PLACES, touches, travelMinutes } from '../src/game/places';

describe('the nine squares', () => {
  it('has Town in the middle with eight places around it', () => {
    expect(PLACES).toHaveLength(9);
    const town = PLACES.find((p) => p.id === 'town');
    expect([town?.col, town?.row]).toEqual([1, 1]);
    const at = (col: number, row: number) => PLACES.find((p) => p.col === col && p.row === row)?.name;
    expect([at(0, 0), at(1, 0), at(2, 0)]).toEqual(['Oakley', 'Hollin', 'Rushmere']);
    expect([at(0, 1), at(1, 1), at(2, 1)]).toEqual(['Fenwick', 'Town', 'Docks']);
    expect([at(0, 2), at(1, 2), at(2, 2)]).toEqual(['Millford', 'Southgate', 'Ashby']);
  });

  it('counts squares that touch, corners included, as next to each other', () => {
    expect(touches('town', 'oakley')).toBe(true);
    expect(touches('fenwick', 'millford')).toBe(true);
    expect(touches('fenwick', 'hollin')).toBe(true);
    expect(touches('oakley', 'rushmere')).toBe(false);
    expect(touches('oakley', 'ashby')).toBe(false);
    expect(touches('docks', 'docks')).toBe(false);
  });

  it('makes places further apart take longer to drive between', () => {
    expect(travelMinutes('docks', 'docks')).toBe(0);
    expect(travelMinutes('town', 'docks')).toBe(20);
    expect(travelMinutes('town', 'ashby')).toBe(25);
    expect(travelMinutes('oakley', 'rushmere')).toBe(40);
    expect(travelMinutes('oakley', 'ashby')).toBe(50);
    expect(travelMinutes('oakley', 'ashby')).toBeGreaterThan(travelMinutes('oakley', 'hollin'));
  });

  it('drives the same time either way', () => {
    for (const a of PLACES) for (const b of PLACES) expect(travelMinutes(a.id, b.id)).toBe(travelMinutes(b.id, a.id));
  });
});
