/**
 * Van der Eijk's A and the disagreement index (#233, ADR-0022 / ADR-0024):
 * the corners the ADRs name, the direction of the re-expression, and the
 * cases the measure does not define.
 */
import { describe, it, expect } from 'vitest';

import { disagreementIndex, vanDerEijkA } from '../src/index.js';

const LEVELS = [1, 2, 3, 4, 5];

describe('vanDerEijkA', () => {
  it('is 1 for unanimity, 0 for a uniform spread, -1 for perfect bimodality', () => {
    expect(vanDerEijkA([0, 0, 7, 0, 0])).toBe(1);
    expect(vanDerEijkA([3, 3, 3, 3, 3])).toBeCloseTo(0, 12);
    expect(vanDerEijkA([4, 0, 0, 0, 4])).toBeCloseTo(-1, 12);
  });

  it('lies between, weighting each layer by its share: two adjacent levels agree more than two apart', () => {
    const near = vanDerEijkA([0, 2, 2, 0, 0])!;
    const far = vanDerEijkA([0, 2, 0, 2, 0])!;
    expect(near).toBeGreaterThan(far);
    expect(near).toBeLessThan(1);
    // A uniform layer (A 0) holding 5 of the 6 cases, then one case alone on level 3 (A 1).
    expect(vanDerEijkA([1, 1, 2, 1, 1])).toBeCloseTo((0 * 5 + 1 * 1) / 6, 12);
  });

  it('is undefined below three levels, with no observations, or with a negative count', () => {
    expect(vanDerEijkA([3, 3])).toBeUndefined();
    expect(vanDerEijkA([0, 0, 0])).toBeUndefined();
    expect(vanDerEijkA([1, -1, 2])).toBeUndefined();
  });
});

describe('disagreementIndex', () => {
  it('runs opposite to A: 0 unanimous, 1 perfectly bimodal, and carries n', () => {
    expect(disagreementIndex([3, 3, 3], LEVELS)).toEqual({ index: 0, a: 1, n: 3 });
    expect(disagreementIndex([1, 5, 1, 5], LEVELS)!.index).toBeCloseTo(1, 12);
    expect(disagreementIndex([1, 5, 1, 5], LEVELS)!.n).toBe(4);
    expect(disagreementIndex([], LEVELS)).toBeUndefined();
  });
});
