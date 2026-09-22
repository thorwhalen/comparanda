/**
 * A reduction over non-independent assertions is flagged (#76, #64).
 *
 * Five draws of one model and five raters produce the same spread. The value a
 * reduction displays is the same in both cases -- this does not change it -- but
 * the reader must be told which one they are looking at. Absent `independence`
 * reads as unknown, never as independent (the reading `weakestIndependence`
 * already takes).
 */
import { describe, it, expect } from 'vitest';
import { Cell, reduce } from '../src/core/schema/values.js';

const assertion = (id: string, value: number, over: Record<string, unknown> = {}) => ({
  id, authorId: id, at: `2026-08-22T00:00:0${id.length}Z`, value, justification: 'x', ...over,
});
const cellOf = (assertions: unknown[]) => Cell.parse({
  alternativeId: 'x', criterionId: 'c', measure: 'score', assertions,
});
const opts = { defaultReduction: 'lower-median' as const, level: 'ordinal' as const };

describe('reduce() reports the independence of what it reduced', () => {
  it('says nothing about a single assertion', () => {
    const r = reduce(cellOf([assertion('a', 3, { independence: 'resampled' })]), opts);
    expect(r.independence).toBeUndefined();
    expect(r.value).toBe(3);
  });

  it('does not flag a set whose every member records independent', () => {
    const r = reduce(cellOf([
      assertion('a', 2, { independence: 'independent' }),
      assertion('bb', 4, { independence: 'independent' }),
    ]), opts);
    expect(r.independence).toEqual({ weakest: 'independent', flagged: false });
  });

  it('flags draws of one model, and names the rung', () => {
    const r = reduce(cellOf([
      assertion('a', 2, { independence: 'independent' }),
      assertion('bb', 4, { independence: 'resampled' }),
      assertion('ccc', 4, { independence: 'resampled' }),
    ]), opts);
    expect(r.independence?.flagged).toBe(true);
    expect(r.independence?.weakest).toBe('resampled');
    expect(r.independence?.reason).toMatch(/resampled/);
    expect(r.independence?.reason).toMatch(/3/);
  });

  it('flags an unrecorded rung as unknown, not as independent', () => {
    const r = reduce(cellOf([
      assertion('a', 2, { independence: 'independent' }),
      assertion('bb', 4),
    ]), opts);
    expect(r.independence).toMatchObject({ weakest: 'unknown', flagged: true });
    expect(r.independence?.reason).toMatch(/unknown/);
  });

  it('does not change the value, the spread or a refusal', () => {
    const cell = cellOf([
      assertion('a', 2, { independence: 'resampled' }),
      assertion('bb', 4, { independence: 'resampled' }),
    ]);
    const r = reduce(cell, opts);
    expect(r.value).toBe(2);
    expect(r.spread).toEqual([2, 4]);
    expect(r.disagreement).toBe(true);
    const refused = reduce(cell, { ...opts, defaultReduction: 'single' });
    expect(refused.refused).toMatch(/single/);
    expect(refused.independence?.flagged).toBe(true);
  });

  it('ignores superseded assertions, like the value does', () => {
    const r = reduce(cellOf([
      assertion('a', 2, { independence: 'independent' }),
      assertion('bb', 4, { independence: 'independent' }),
      assertion('ccc', 5, { supersededBy: 'bb' }),
    ]), opts);
    expect(r.independence).toEqual({ weakest: 'independent', flagged: false });
  });

  it('collapses personas of one principal when authors are given', () => {
    const cell = cellOf([
      assertion('a', 2, { independence: 'independent', authorId: 'ana-as-buyer' }),
      assertion('bb', 4, { independence: 'independent', authorId: 'ana-as-operator' }),
    ]);
    expect(reduce(cell, opts).independence?.flagged).toBe(false);
    const authors = [
      { id: 'ana-as-buyer', principalId: 'ana' },
      { id: 'ana-as-operator', principalId: 'ana' },
    ];
    const r = reduce(cell, { ...opts, authors });
    expect(r.independence).toMatchObject({ weakest: 'resampled', flagged: true });
  });
});
