/**
 * `rankShare` (#343, ADR-0015): the share of sampled weightings that put each alternative at each rank. Checked
 * against a case with a closed form, for reproducibility and the generator seam, and for the rules it keeps from
 * the weighted sum: unscored rows take no share, an interval is never given a midpoint.
 */
import { describe, expect, it } from 'vitest';

import { Analysis } from '../src/core/schema/analysis.js';
import { rankShare, seededRandom } from '../src/core/analyses/rank-share.js';
import { rankShareAnalysis } from '../src/core/analyses/definitions.js';
import { reversal, weighted } from './support/weighted.js';
import relocationJson from '../examples/relocation.json';

/** A and B are mirror images on two equally-declared criteria; C sits at the midpoint of both. */
function mirror(blankForC = false): Analysis {
  const values: Record<string, [number | undefined, number | undefined]> = { a: [100, 0], b: [0, 100], c: [50, blankForC ? undefined : 50] };
  return Analysis.parse({
    id: 'mirror', subject: { question: 'Which?' }, authors: [{ id: 'p', displayName: 'P', kind: 'human' }],
    alternatives: Object.keys(values).map((id) => ({ id, label: id.toUpperCase() })),
    criteria: ['x', 'y'].map((id) => ({
      id, label: id.toUpperCase(), defaultMeasurement: { level: 'ratio', preference: 'increasing', range: { min: 0, max: 100 } }, weights: { substitution: 1 },
    })),
    cells: Object.entries(values).flatMap(([alt, vs]) => ['x', 'y'].flatMap((crit, j) => (vs[j] === undefined ? [] : [{
      alternativeId: alt, criterionId: crit, measure: 'score',
      assertions: [{ id: `${alt}-${crit}`, authorId: 'p', at: '2026-01-01T00:00:00Z', version: 1, evidence: [], value: vs[j], justification: 'measured' }],
    }]))),
  });
}
const share = (r: ReturnType<typeof rankShare>, id: string) => r.rows.find((x) => x.alternativeId === id)!;

describe('the shares', () => {
  it('match the closed form: A beats C exactly when the weight on x passes a half, so A is first or last, C always second', () => {
    const r = rankShare(mirror(), { measure: 'score', samples: 20_000 });
    expect(r.ranks).toBe(3);
    expect(share(r, 'c').shares[1]).toBeCloseTo(1, 10);
    expect(share(r, 'a').shares[0]).toBeCloseTo(0.5, 1);
    expect(share(r, 'a').shares[2]).toBeCloseTo(0.5, 1);
    expect(share(r, 'a').shares[1]).toBe(0);
  });

  it('sum to one per alternative (not per rank: a row the data leave open spreads its unit over several)', () => {
    const r = rankShare(weighted(Analysis.parse(relocationJson)), { measure: 'score', samples: 2_000 });
    expect(r.rows.length).toBeGreaterThan(1);
    for (const row of r.rows) expect(row.shares.reduce((x, y) => x + y, 0)).toBeCloseTo(1, 9);
  });

  it('reproduce from the seed, and differ with another', () => {
    const once = rankShare(reversal(), { measure: 'score', samples: 500, seed: 7 });
    expect(rankShare(reversal(), { measure: 'score', samples: 500, seed: 7 })).toEqual(once);
    expect(rankShare(reversal(), { measure: 'score', samples: 500, seed: 8 })).not.toEqual(once);
  });

  it('take the generator as a seam: a caller\'s random replaces the seeded one, and no seed is reported', () => {
    const r = rankShare(reversal(), { measure: 'score', samples: 300, random: seededRandom(3) });
    expect(r.seed).toBeUndefined();
    expect(r).toEqual({ ...rankShare(reversal(), { measure: 'score', samples: 300, random: seededRandom(3) }) });
    expect(rankShare(reversal(), { measure: 'score' }).seed).toBe(1);
  });

  it('refuse a sample count that is not a whole number of at least one', () => {
    expect(() => rankShare(reversal(), { measure: 'score', samples: 0 })).toThrow(/samples/);
    expect(() => rankShare(reversal(), { measure: 'score', samples: 2.5 })).toThrow(/samples/);
  });
});

describe('the central weight vector', () => {
  it('is where an alternative is settled first: A\'s centre leans on x, B\'s on y, and C, never first, has none', () => {
    const r = rankShare(mirror(), { measure: 'score', samples: 10_000 });
    const weightOn = (id: string, crit: string) => share(r, id).centralWeights!.find((w) => w.criterionId === crit)!.weight;
    expect(weightOn('a', 'x')).toBeCloseTo(0.75, 1);
    expect(weightOn('b', 'y')).toBeCloseTo(0.75, 1);
    expect(share(r, 'c').centralWeights).toBeUndefined();
    for (const id of ['a', 'b']) expect(share(r, id).centralWeights!.reduce((t, w) => t + w.weight, 0)).toBeCloseTo(1, 9);
  });
});

describe('what it keeps from the weighted sum', () => {
  it('leaves a row the coverage gate does not score without a share, with its label', () => {
    const a = mirror();
    const gone = Analysis.parse({ ...a, cells: a.cells.filter((c) => !(c.alternativeId === 'c')) });
    const r = rankShare(gone, { measure: 'score', samples: 200 });
    expect(r.ranks).toBe(2);
    expect(r.rows.map((x) => x.alternativeId)).toEqual(['a', 'b']);
    expect(r.unscored).toEqual([expect.objectContaining({ alternativeId: 'c', label: expect.stringMatching(/insufficient coverage/) })]);
  });

  it('never gives an interval a midpoint: a row with a blank spreads evenly over the ranks the data leave open, and says how often', () => {
    const r = rankShare(mirror(true), { measure: 'score', samples: 5_000, coverageFloor: 0.4 });
    const c = share(r, 'c');
    // C's y is blank, so its aggregate is an interval; it is open to every rank in some samples.
    expect(c.unsettled).toBeGreaterThan(0);
    expect(c.shares.reduce((t, x) => t + x, 0)).toBeCloseTo(1, 9);
    expect(r.assumptions.join(' ')).toMatch(/evenly over the ranks/);
  });

  it('states its assumptions with the result, and takes the weighted sum\'s refusal as its own', () => {
    expect(rankShare(mirror(), { measure: 'score', samples: 10 }).assumptions.length).toBeGreaterThan(0);
    const refused = rankShare(Analysis.parse(relocationJson), { measure: 'score', samples: 10 });
    expect(refused.refused?.reason).toBe('no-weighted-criteria');
    expect(refused.rows).toEqual([]);
  });

  it('is a described analysis, so a composition root can register it', () => {
    expect(rankShareAnalysis.id).toBe('rank-share');
    expect(rankShareAnalysis.run(mirror(), { measure: 'score', samples: 10 }).method).toBe('rank-share');
  });
});
