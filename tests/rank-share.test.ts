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

/** Rows with the given values on criteria `crits` (every criterion 0 to 100, increasing, weight 1), every cell a point. */
function valued(values: Record<string, (number | undefined)[]>, crits: string[]): Analysis {
  return Analysis.parse({
    id: 'valued', subject: { question: 'Which?' }, authors: [{ id: 'p', displayName: 'P', kind: 'human' }],
    alternatives: Object.keys(values).map((id) => ({ id, label: id.toUpperCase() })),
    criteria: crits.map((id) => ({
      id, label: id.toUpperCase(), defaultMeasurement: { level: 'ratio', preference: 'increasing', range: { min: 0, max: 100 } }, weights: { substitution: 1 },
    })),
    cells: Object.entries(values).flatMap(([alt, vs]) => crits.flatMap((crit, j) => (vs[j] === undefined ? [] : [{
      alternativeId: alt, criterionId: crit, measure: 'score',
      assertions: [{ id: `${alt}-${crit}`, authorId: 'p', at: '2026-01-01T00:00:00Z', version: 1, evidence: [], value: vs[j], justification: 'measured' }],
    }]))),
  });
}
/** One row per criterion, each at the top of its own criterion and the bottom of the others. */
const strongOn = (crits: string[]) => valued(Object.fromEntries(crits.map((id) => [id, crits.map((c) => (c === id ? 100 : 0))])), crits);

describe('the shares', () => {
  it('match the closed form: A beats C exactly when the weight on x passes a half, so A is first or last, C always second', () => {
    const r = rankShare(mirror(), { measure: 'score', samples: 20_000 });
    expect(r.rows).toHaveLength(3);
    expect(share(r, 'c').shares[1]).toBeCloseTo(1, 10);
    expect(share(r, 'a').shares[0]).toBeCloseTo(0.5, 1);
    expect(share(r, 'a').shares[2]).toBeCloseTo(0.5, 1);
    expect(share(r, 'a').shares[1]).toBe(0);
  });

  it('are uniform over the orderings of three criteria\'s weights: each of three rows, strong on one criterion, takes each rank a third of the time', () => {
    const r = rankShare(strongOn(['p', 'q', 'r']), { measure: 'score', samples: 30_000 });
    for (const row of r.rows) for (const x of row.shares) expect(Math.abs(x - 1 / 3)).toBeLessThan(0.02);
    // Not "about": a row first only when its criterion carries the most weight, whose mean under the simplex is 11/18.
    expect(share(r, 'p').centralWeights!.find((w) => w.criterionId === 'p')!.weight).toBeCloseTo(11 / 18, 1);
  });

  it('with one weighted criterion, give each row its one rank at once, however many samples were asked', () => {
    const r = rankShare(strongOn(['p']), { measure: 'score', samples: 1_000_000 });
    expect(r.rows.map((x) => x.shares)).toEqual([[1]]);
    const two = rankShare(valued({ a: [90], b: [10] }, ['x']), { measure: 'score', samples: 1_000_000 });
    expect(share(two, 'a').shares).toEqual([1, 0]);
    expect(share(two, 'b').shares).toEqual([0, 1]);
  });

  it('keep a tie of complete rows as a tie, not as noise and not as an open rank', () => {
    const r = rankShare(valued({ a: [50, 50], b: [50, 50], c: [10, 10] }, ['x', 'y']), { measure: 'score', samples: 2_000 });
    expect(share(r, 'a')).toMatchObject({ tied: 1, unsettled: 0, shares: [0.5, 0.5, 0] });
    expect(share(r, 'c')).toMatchObject({ tied: 0, unsettled: 0, shares: [0, 0, 1] });
    expect(r.caption).toMatch(/The data leave 2 alternatives open \(a blank, or a tie\) in at least half/);
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
    expect(r.rows.map((x) => x.alternativeId)).toEqual(['a', 'b']);
    expect(r.unscored).toEqual([expect.objectContaining({ alternativeId: 'c', label: expect.stringMatching(/insufficient coverage/) })]);
  });

  it('never gives an interval a midpoint: a row with a blank spreads evenly over the ranks the data leave open, and says how often', () => {
    const r = rankShare(mirror(true), { measure: 'score', samples: 30_000, coverageFloor: 0.4 });
    const c = share(r, 'c');
    // C's y is blank: its aggregate is [w/2, w/2 + 1 - w] against A at w and B at 1 - w. Pinned to the closed form,
    // so a midpoint (which would give C 0/1/0 or a different spread) cannot pass: 2/9, 5/9, 2/9, open in 2/3 of the weightings.
    expect(Math.abs(c.shares[0]! - 2 / 9)).toBeLessThan(0.02);
    expect(Math.abs(c.shares[1]! - 5 / 9)).toBeLessThan(0.02);
    expect(Math.abs(c.shares[2]! - 2 / 9)).toBeLessThan(0.02);
    expect(Math.abs(c.unsettled - 2 / 3)).toBeLessThan(0.02);
    expect(c.tied).toBe(0);
    expect(r.assumptions.join(' ')).toMatch(/evenly over the ranks/);
  });

  it('captions a stability statement over the settled weightings, says what the data leave open, and never names a first', () => {
    const r = rankShare(mirror(), { measure: 'score', samples: 20_000, words: { alternative: 'option', alternatives: 'options' } });
    expect(r.caption).toBe('Across 20,000 random weightings of the 2 weighted criteria, 1 of the 3 options whose rank the data settle keeps one rank in at least 90% of the weightings that settle it; the others spread over several: the order is not stable under joint changes of weight.');
    expect(r.caption).not.toMatch(/\b(best|winner|wins|top|recommend\w*|choose|first)\b/i);
    const open = rankShare(mirror(true), { measure: 'score', samples: 2_000, coverageFloor: 0.4 });
    expect(open.caption).toMatch(/ The data leave \d alternatives? open \(a blank, or a tie\) in at least half of the weightings, so for (it|them) the shares rest on the stated spreading rule\.$/);
  });

  it('refuses a generator that does not return numbers in [0, 1), and a seed that is not a whole number', () => {
    expect(() => rankShare(mirror(), { measure: 'score', samples: 5, random: () => 0 })).toThrow(/\[0, 1\)/);
    expect(() => rankShare(mirror(), { measure: 'score', samples: 5, random: () => 1 })).toThrow(/\[0, 1\)/);
    expect(() => rankShare(mirror(), { measure: 'score', seed: 1.5 })).toThrow(/seed/);
  });

  it('reports the criteria it sampled, not the ones declared weightless', () => {
    const a = mirror();
    const weightless = Analysis.parse({ ...a, criteria: [...a.criteria, { id: 'z', label: 'Z', defaultMeasurement: { level: 'ratio', preference: 'increasing', range: { min: 0, max: 100 } }, weights: { substitution: 0 } }] });
    const r = rankShare(weightless, { measure: 'score', samples: 100 });
    expect(r.basis.map((b) => b.criterionId)).toEqual(['x', 'y']);
    expect(r.caption).toMatch(/of the 2 weighted criteria/);
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
