/**
 * Opt-in weighted sum behind a coverage gate (#84, ADR-0015 as amended).
 */
import { describe, it, expect } from 'vitest';

import { Analysis } from '../src/core/schema/analysis.js';
import { projectForReader } from '../src/core/schema/disclosure.js';
import { weightedSum, separability, DEFAULT_COVERAGE_FLOOR } from '../src/core/analyses/weighted-sum.js';
import { simulate, FIXTURES, BINS } from '../scripts/coverage-floor-simulation.js';

const ORD = { level: 'ordinal', preference: 'increasing', range: { min: 1, max: 5 }, levels: [1, 2, 3, 4, 5] };
const COST = { level: 'ratio', preference: 'decreasing', range: { min: 0, max: 100 } };

type V = number | undefined | 'na';

/** Criteria with measurements and weights; rows of values; `undefined` = not assessed, 'na' = not applicable. */
function doc(crits: { m: Record<string, unknown>; w?: number }[], rows: Record<string, V[]>) {
  return Analysis.parse({
    id: 'w', subject: { question: 'q' }, authors: [{ id: 'a', displayName: 'a', kind: 'human' }],
    alternatives: Object.keys(rows).map((id) => ({ id, label: id })),
    criteria: crits.map((c, j) => ({
      id: `c${j}`, label: `C${j}`, defaultMeasurement: c.m,
      ...(c.w === undefined ? {} : { weights: { substitution: c.w } }),
    })),
    cells: Object.entries(rows).flatMap(([alt, vals]) => vals.map((v, j) => ({
      alternativeId: alt, criterionId: `c${j}`, measure: 'score',
      assertions: [{
        id: `${alt}${j}`, authorId: 'a', at: '2026-01-01T00:00:00Z', version: 1, evidence: [],
        ...(v === undefined ? { missing: { code: 'not-assessed' } }
          : v === 'na' ? { missing: { code: 'not-applicable' } }
            : { value: v, justification: 'j', disclosure: { label: alt === 'secret' ? 'secret' : 'open' } }),
      }],
    }))),
  });
}
const run = (a: Analysis, extra: Record<string, unknown> = {}) => weightedSum(a, { measure: 'score', ...extra });
const row = (r: ReturnType<typeof weightedSum>, id: string) => r.rows.find((x) => x.alternativeId === id)!;

describe('refuses to run over a criterion it cannot normalise, with the reason', () => {
  it('no declared range', () => {
    const r = run(doc([{ m: ORD, w: 1 }, { m: { level: 'ratio', preference: 'increasing' }, w: 1 }], { x: [3, 10] }));
    expect(r.refused).toMatchObject({ criterionId: 'c1', reason: 'no-declared-range' });
    expect(r.refused!.message).toMatch(/declared range/);
    expect(r.rows).toEqual([]);
  });

  it('target preference, as dominance excludes it in v1', () => {
    const r = run(doc([{ m: { level: 'interval', preference: 'target', range: { min: 0, max: 10, target: 5 } }, w: 1 }], { x: [5] }));
    expect(r.refused).toMatchObject({ criterionId: 'c0', reason: 'target-preference' });
  });

  it('no direction of preference', () => {
    const r = run(doc([{ m: { level: 'nominal', preference: 'none', levels: ['a'] }, w: 1 }], { x: [1] }));
    expect(r.refused?.reason).toBe('no-preference-direction');
  });

  it('a negative weight, and nothing weighted at all', () => {
    expect(run(doc([{ m: ORD, w: -1 }], { x: [3] })).refused?.reason).toBe('negative-weight');
    expect(run(doc([{ m: ORD }], { x: [3] })).refused?.reason).toBe('no-weighted-criteria');
  });

  it('lists an unweighted criterion as excluded rather than refusing', () => {
    const r = run(doc([{ m: ORD, w: 1 }, { m: ORD }], { x: [3, 4] }));
    expect(r.refused).toBeUndefined();
    expect(r.excluded).toEqual([{ criterionId: 'c1', reason: 'no-substitution-weight' }]);
  });
});

describe('normalisation against declared ranges', () => {
  it('scores by position in the declared range, flipping a decreasing criterion', () => {
    const r = run(doc([{ m: ORD, w: 1 }, { m: COST, w: 1 }], { x: [5, 0], y: [1, 100], z: [3, 50] }));
    expect(row(r, 'x')).toMatchObject({ status: 'point', value: 1 });
    expect(row(r, 'y')).toMatchObject({ status: 'point', value: 0 });
    expect(row(r, 'z')).toMatchObject({ status: 'point', value: 0.5 });
  });

  it('never moves one alternative\'s score when another is added', () => {
    const before = run(doc([{ m: ORD, w: 2 }, { m: COST, w: 1 }], { x: [4, 30], y: [2, 60] }));
    const after = run(doc([{ m: ORD, w: 2 }, { m: COST, w: 1 }], { x: [4, 30], y: [2, 60], extreme: [5, 1] }));
    expect(row(after, 'x')).toEqual(row(before, 'x'));
    expect(row(after, 'y')).toEqual(row(before, 'y'));
  });
});

describe('the coverage gate', () => {
  const four = [{ m: ORD, w: 1 }, { m: ORD, w: 1 }, { m: ORD, w: 1 }, { m: ORD, w: 1 }];

  it('a point value only at full coverage', () => {
    expect(row(run(doc(four, { x: [3, 3, 3, 3] })), 'x')).toMatchObject({ status: 'point', coverage: 1 });
  });

  it('an interval over every completion of the blanks from 2/3 up, and no point value anywhere', () => {
    const r = row(run(doc(four, { x: [5, 5, 5, undefined] })), 'x');
    expect(r).toMatchObject({ status: 'interval', coverage: 0.75, blankCriteria: ['c3'] });
    if (r.status !== 'interval') throw new Error('unreachable');
    // Observed 3 x 1.0; the blank anywhere in [0, 1].
    expect(r.interval[0]).toBeCloseTo(0.75, 12);
    expect(r.interval[1]).toBeCloseTo(1, 12);
    expect('value' in r).toBe(false);
  });

  it('below the floor, nothing -- and the alternative stays visible, labelled', () => {
    const r = run(doc(four, { x: [5, 5, undefined, undefined], y: [1, 1, 1, 1] }));
    expect(row(r, 'x')).toEqual({ alternativeId: 'x', status: 'not-scored', label: 'not scored -- insufficient coverage', coverage: 0.5 });
    expect(r.rows.map((x) => x.alternativeId)).toEqual(['x', 'y']);
  });

  it('defaults the floor to 2/3, calls it provisional, and takes another', () => {
    const r = run(doc(four, { x: [5, 5, undefined, undefined] }), { coverageFloor: 0.5 });
    expect(DEFAULT_COVERAGE_FLOOR).toBeCloseTo(2 / 3, 12);
    expect(row(r, 'x').status).toBe('interval');
    expect(run(doc(four, { x: [5, 5, 5, 5] })).assumptions.join(' ')).toMatch(/2\/3 is a provisional default/);
  });

  it('orders two rows only when their intervals do not overlap', () => {
    const r = run(doc(four, { hi: [5, 5, 5, undefined], lo: [1, 1, 1, 1], mid: [5, 5, 2, undefined] }));
    expect(separability(row(r, 'hi'), row(r, 'lo'))).toBe('x-higher');
    expect(separability(row(r, 'hi'), row(r, 'mid'))).toBe('not-separable');
  });
});

describe('labels that cannot be switched off', () => {
  it('warns whenever an ordinal criterion is summed, and not otherwise', () => {
    expect(run(doc([{ m: ORD, w: 1 }], { x: [3] })).warnings.join(' ')).toMatch(/Ordinal criteria are in this sum/);
    expect(run(doc([{ m: COST, w: 1 }], { x: [30] })).warnings.join(' ')).not.toMatch(/Ordinal/);
  });

  it('labels renormalisation over a criterion that does not apply as the mean imputation it is', () => {
    const r = run(doc([{ m: ORD, w: 1 }, { m: ORD, w: 1 }, { m: ORD, w: 1 }], { x: [5, 5, 'na'] }));
    const x = row(r, 'x');
    expect(x).toMatchObject({ status: 'point', value: 1, coverage: 1 });
    if (x.status === 'not-scored') throw new Error('unreachable');
    expect(x.renormalised?.criteria).toEqual(['c2']);
    expect(x.renormalised?.label).toMatch(/mean imputation/);
    expect(r.warnings.join(' ')).toMatch(/mean imputation/);
  });

  it('takes no option that could suppress either', () => {
    // The options type has measure, scope and the floor. Anything else is
    // ignored, and the labels are still there.
    const r = weightedSum(doc([{ m: ORD, w: 1 }, { m: ORD, w: 1 }], { x: [5, 'na'] }), { measure: 'score', quiet: true, suppressWarnings: true } as never);
    expect(r.warnings.join(' ')).toMatch(/Ordinal/);
    expect(r.warnings.join(' ')).toMatch(/mean imputation/);
  });
});

describe('disclosure', () => {
  it('counts cells withheld from the reader, and reads them as blanks', () => {
    const src = doc([{ m: ORD, w: 1 }, { m: ORD, w: 1 }, { m: ORD, w: 1 }], { secret: [5, 5, 5], open: [3, 3, 3] });
    const p = projectForReader(src, (s) => s.disclosure?.label !== 'secret').analysis;
    const r = run(p);
    expect(r.widenedByDisclosure).toBe(3);
    expect(row(r, 'secret')).toMatchObject({ status: 'not-scored', coverage: 0 });
    expect(run(src).widenedByDisclosure).toBe(0);
  });
});

describe('the coverage-floor simulation (#84, item 4)', () => {
  it('is deterministic, and behaves as the design says it must', () => {
    for (const { fixture, criteria } of FIXTURES) {
      const small = { weightDraws: 4, completions: 2 };
      const a = simulate(fixture, criteria, small);
      expect(simulate(fixture, criteria, small)).toEqual(a);
      expect(a.map((b) => b.label)).toEqual(BINS.map((b) => b.label));
      const full = a[0]!;
      // At full coverage the aggregate is exact: every truly ordered pair is
      // ordered, and imputation has nothing to impute.
      expect(full.pairs).toBeGreaterThan(0);
      expect(full.separable).toBe(full.pairs);
      expect(full.imputationFlips).toBe(0);
      // Below the floor the interval aggregate separates less than at or above it.
      const rate = (i: number) => (a[i]!.pairs === 0 ? NaN : a[i]!.separable / a[i]!.pairs);
      expect(rate(3)).toBeLessThan(rate(2));
    }
  });
});

describe('review findings (#152)', () => {
  it('scores a row that sits exactly on the 2/3 floor, despite floating point', () => {
    // 0.225 blank + 0.15 + 0.3 observed: 0.45 / 0.675 = 2/3, computed as 0.6666666666666665.
    const r = run(doc([{ m: ORD, w: 0.225 }, { m: ORD, w: 0.15 }, { m: ORD, w: 0.3 }], { x: [undefined, 3, 4] }));
    expect(row(r, 'x').status).toBe('interval');
  });

  it('refuses a weighted criterion with no measurement instead of dropping it', () => {
    const a = doc([{ m: ORD, w: 1 }], { x: [3] });
    const withBare = { ...a, criteria: [...a.criteria, { ...a.criteria[0]!, id: 'bare', defaultMeasurement: undefined, measurements: {} }] };
    const r = weightedSum(withBare as Analysis, { measure: 'score' });
    expect(r.refused?.reason).toBe('no-measurement');
    expect(r.rows).toEqual([]);
  });

  it('refuses an ordinal criterion whose levels are not numbers, rather than reading every value as a blank', () => {
    const r = run(doc([{ m: { level: 'ordinal', preference: 'increasing', range: { min: 1, max: 3 }, levels: ['low', 'mid', 'high'] }, w: 1 }], { x: [undefined] }));
    expect(r.refused?.reason).toBe('non-numeric-levels');
  });

  it('carries an interval for a decreasing criterion with a blank, oriented best-high', () => {
    const r = run(doc([{ m: COST, w: 1 }, { m: ORD, w: 2 }], { x: [undefined, 5] }));
    const x = row(r, 'x');
    expect(x.status).toBe('interval');
    if (x.status === 'interval') {
      // c1 contributes 2/3 fully; the blank cost contributes [0, 1/3].
      expect(x.interval[0]).toBeCloseTo(2 / 3, 12);
      expect(x.interval[1]).toBeCloseTo(1, 12);
    }
  });
});
