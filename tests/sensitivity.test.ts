/**
 * Stability of the weighted order under weight and alternative-set
 * perturbation (#85, ADR-0015 as amended).
 *
 * The load-bearing test is the one that spends the margin: take the weight the
 * analysis says would end an ordered pair, set it, and check the pair really
 * does end there -- and that just short of it, it does not. A margin nobody
 * re-derives is a number that looks like rigour.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Analysis } from '../src/core/schema/analysis.js';
import { weightedSum, separability } from '../src/core/analyses/weighted-sum.js';
import { sensitivity, FIVE_PERCENT } from '../src/core/analyses/sensitivity.js';

const ORD = { level: 'ordinal', preference: 'increasing', range: { min: 1, max: 5 }, levels: [1, 2, 3, 4, 5] };
const COST = { level: 'ratio', preference: 'decreasing', range: { min: 0, max: 100 } };

type V = number | undefined | 'na';

/** Criteria with measurements and weights; rows of values; `undefined` = blank, 'na' = not applicable. */
function doc(crits: { m: Record<string, unknown>; w?: number }[], rows: Record<string, V[]>) {
  return Analysis.parse({
    id: 's', subject: { question: 'q' }, authors: [{ id: 'a', displayName: 'a', kind: 'human' }],
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
            : { value: v, justification: 'j' }),
      }],
    }))),
  });
}

/** The same analysis with one criterion's substitution weight replaced. */
function withWeight(a: Analysis, criterionId: string, weight: number): Analysis {
  return {
    ...a,
    criteria: a.criteria.map((c) => (c.id === criterionId ? { ...c, weights: { ...c.weights, substitution: weight } } : c)),
  };
}

const run = (a: Analysis, extra: Record<string, unknown> = {}) => sensitivity(a, { measure: 'score', ...extra });

const ordered = (a: Analysis, higher: string, lower: string, weights?: { id: string; w: number }) => {
  const doc_ = weights ? withWeight(a, weights.id, weights.w) : a;
  const r = weightedSum(doc_, { measure: 'score' });
  const x = r.rows.find((row) => row.alternativeId === higher)!;
  const y = r.rows.find((row) => row.alternativeId === lower)!;
  return separability(x, y) === 'x-higher';
};

describe('both perturbations, reported together (#85 item 1)', () => {
  it('one call carries the weight margins and the alternative-set check', () => {
    const r = run(doc([{ m: ORD, w: 1 }, { m: COST, w: 1 }], { x: [5, 20], y: [3, 30] }));
    expect(r.method).toBe('sensitivity');
    expect(r.weightPerturbation.criteria.map((c) => c.criterionId)).toEqual(['c0', 'c1']);
    expect(r.alternativeSetPerturbation.removals.map((x) => x.removed)).toEqual(['x', 'y']);
    expect(r.orderedPairs).toEqual([{ higher: 'x', lower: 'y' }]);
    expect(r.finding).toMatch(/Weights: .*Alternative set: /);
  });
});

describe('the weight margin is a real margin, not a decoration', () => {
  it('the pair still holds just below the reported weight and is gone just above it', () => {
    // x is better on c0, worse on c1. Raising c1's weight must eventually end it.
    const a = doc([{ m: ORD, w: 3 }, { m: COST, w: 1 }], { x: [5, 60], y: [4, 20] });
    expect(ordered(a, 'x', 'y')).toBe(true);
    const c1 = run(a).weightPerturbation.criteria.find((c) => c.criterionId === 'c1')!;
    expect(c1.ifRaised).toBeDefined();
    const at = c1.ifRaised!.at;
    expect(at).toBeGreaterThan(1);
    expect(ordered(a, 'x', 'y', { id: 'c1', w: at * 0.999 }), 'still ordered just below the margin').toBe(true);
    expect(ordered(a, 'x', 'y', { id: 'c1', w: at * 1.001 }), 'no longer ordered just above it').toBe(false);
    expect(c1.ifRaised!.cause).toBe('pair-stops-being-ordered');
    expect(c1.ifRaised!.pair).toEqual({ higher: 'x', lower: 'y' });
    expect(c1.ifRaised!.shareOfOwnWeight).toBeCloseTo(c1.ifRaised!.delta / 1, 12);
  });

  it('flags a fragile order, and does not flag a robust one', () => {
    // x leads by a hair on the heavy criterion and loses the light one outright:
    // barely any weight has to move to the light one to end the ordering.
    const FINE = { level: 'ratio', preference: 'increasing', range: { min: 0, max: 10 } };
    const fragileDoc = doc([{ m: FINE, w: 50 }, { m: ORD, w: 0.1 }], { x: [5.2, 1], y: [5, 5] });
    const fragileResult = run(fragileDoc);
    expect(fragileResult.weightPerturbation.fragile).toBe(true);
    expect(fragileResult.weightPerturbation.smallest!.shareOfTotalWeight).toBeLessThan(FIVE_PERCENT);
    expect(fragileResult.finding).toMatch(/fragile/);

    // Dominant on every criterion: no weighting changes the order at all.
    const robust = run(doc([{ m: ORD, w: 1 }, { m: ORD, w: 1 }], { x: [5, 5], y: [1, 1] }));
    expect(robust.weightPerturbation.smallest).toBeUndefined();
    expect(robust.weightPerturbation.fragile).toBe(false);
    expect(robust.weightPerturbation.criteria.every((c) => !c.fragile)).toBe(true);
    expect(robust.finding).toMatch(/no movement of any single weight changes the order/);
  });
});

describe('blanks and the coverage gate (#85, ADR-0015)', () => {
  it('orders an interval row by separability, and stops the margin at the gate', () => {
    // x is blank on c1: its aggregate is an interval, and raising c1's weight
    // costs x its coverage (3/(3+t) crosses 2/3 at t = 1.5) long before the
    // intervals would overlap (t = 6). The margin must be the gate, not the
    // overlap -- past the gate there is no pair left to reorder.
    const a = doc([{ m: ORD, w: 3 }, { m: ORD, w: 1 }], { x: [5, undefined], y: [1, 3] });
    const r = run(a);
    expect(r.orderedPairs).toEqual([{ higher: 'x', lower: 'y' }]);
    const c1 = r.weightPerturbation.criteria.find((c) => c.criterionId === 'c1')!;
    expect(c1.ifRaised?.cause).toBe('row-leaves-the-coverage-gate');
    expect(c1.ifRaised?.at).toBeCloseTo(1.5, 9);
    expect(ordered(a, 'x', 'y', { id: 'c1', w: 1.4 })).toBe(true);
    const past = weightedSum(withWeight(a, 'c1', 1.6), { measure: 'score' });
    expect(past.rows.find((row) => row.alternativeId === 'x')!.status).toBe('not-scored');
  });

  it('names a zero-distance change when a row sits exactly on the floor', () => {
    // x's coverage is exactly 2/3: any increase in c1's weight puts it out.
    const a = doc([{ m: ORD, w: 2 }, { m: ORD, w: 1 }], { x: [5, undefined], y: [1, 3] });
    const c1 = run(a).weightPerturbation.criteria.find((c) => c.criterionId === 'c1')!;
    expect(c1.ifRaised).toEqual({
      at: 1, delta: 0, direction: 'up', shareOfTotalWeight: 0, shareOfOwnWeight: 0,
      cause: 'row-leaves-the-coverage-gate', alternativeId: 'x',
    });
    expect(c1.fragile).toBe(true);
    const past = weightedSum(withWeight(a, 'c1', 1.000001), { measure: 'score' });
    expect(past.rows.find((row) => row.alternativeId === 'x')!.status).toBe('not-scored');
  });

  it('gives a row the gate did not score no stability number anywhere', () => {
    // z is blank on the heavy criterion: coverage 1/4, below the 2/3 floor.
    const a = doc([{ m: ORD, w: 3 }, { m: ORD, w: 1 }], { x: [5, 5], y: [3, 3], z: [undefined, 4] });
    const r = run(a);
    expect(r.unscored).toEqual(['z']);
    expect(r.orderedPairs.every((p) => p.higher !== 'z' && p.lower !== 'z')).toBe(true);
    const mentionsZ = JSON.stringify(r.weightPerturbation).includes('"z"');
    expect(mentionsZ, 'an unscored row must carry no weight margin').toBe(false);
  });

  it('names a row leaving the coverage gate as the change, when that comes first', () => {
    const a = doc([{ m: ORD, w: 2 }, { m: ORD, w: 2 }, { m: ORD, w: 1 }], {
      x: [5, 5, undefined], y: [1, 1, 1],
    });
    const r = run(a);
    const c2 = r.weightPerturbation.criteria.find((c) => c.criterionId === 'c2')!;
    expect(c2.ifRaised?.cause).toBe('row-leaves-the-coverage-gate');
    expect(c2.ifRaised?.alternativeId).toBe('x');
    expect(c2.ifRaised?.at).toBeCloseTo(2, 9);
    // At that weight x's coverage is exactly the floor; past it, x is not scored.
    const past = weightedSum(withWeight(a, 'c2', c2.ifRaised!.at * 1.01), { measure: 'score' });
    expect(past.rows.find((row) => row.alternativeId === 'x')!.status).toBe('not-scored');
  });
});

describe('the alternative-set perturbation (#85, ADR-0015 sub-amendment)', () => {
  it('removes each alternative in turn and finds no reversal under declared-range normalisation', () => {
    const a = doc([{ m: ORD, w: 2 }, { m: COST, w: 1 }], { x: [5, 90], y: [4, 10], z: [2, 50] });
    const r = run(a);
    expect(r.alternativeSetPerturbation.removals).toHaveLength(3);
    for (const removal of r.alternativeSetPerturbation.removals) {
      expect(removal.changed, `removing ${removal.removed}`).toEqual([]);
      expect(removal.gained, `removing ${removal.removed}`).toEqual([]);
      expect(removal.stable).toBe(true);
    }
    expect(r.alternativeSetPerturbation.reversalFound).toBe(false);
    expect(r.finding).toMatch(/leaves the order of the others unchanged/);
  });

  it('is not vacuous: it compares the survivors\' pairs, which exist', () => {
    const r = run(doc([{ m: ORD, w: 1 }], { x: [5], y: [3], z: [1] }));
    expect(r.orderedPairs.length).toBe(3);
    const survivors = r.alternativeSetPerturbation.removals[0]!;
    expect(survivors.removed).toBe('x');
    // y > z survives x's removal and is checked.
    expect(r.orderedPairs.some((p) => p.higher === 'y' && p.lower === 'z')).toBe(true);
  });
});

describe('a stability finding, never a winner (#85 item 2)', () => {
  it('carries its own caption, and no field or sentence endorses an alternative', () => {
    const r = run(doc([{ m: ORD, w: 1 }, { m: COST, w: 1 }], { x: [5, 20], y: [3, 30] }));
    expect(r.caption).toMatch(/Stability of the reported order/);
    expect(r.caption).toMatch(/does not say which/);
    const keys: string[] = [];
    const strings: string[] = [];
    const walk = (o: unknown) => {
      if (typeof o === 'string') { strings.push(o); return; }
      if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { keys.push(k); walk(v); }
    };
    walk(r);
    // `unscored` and `coverage` are the gate's own words; what must not appear
    // is a field that picks one alternative out.
    expect(keys.filter((k) => /winner|best|\btop\b|recommend|choose|preferred/i.test(k))).toEqual([]);
    // Denials are allowed ("no number here is a recommendation"); endorsements are not.
    expect(strings.filter((s) => /\b(is|are)\s+(the\s+)?(best|winner|recommended|preferred)\b/i.test(s))).toEqual([]);
    expect(strings.filter((s) => /\bwe recommend\b|\byou should (pick|choose)\b/i.test(s))).toEqual([]);
    expect(r.assumptions.length).toBeGreaterThan(2);
  });
});

describe('runs only over an opted-into weighted aggregation (#85 item 3)', () => {
  it('reports the weighted sum\'s refusal and no stability numbers', () => {
    const a = doc([{ m: { level: 'ratio', preference: 'increasing' }, w: 1 }], { x: [3], y: [1] });
    const r = run(a);
    expect(r.refused?.reason).toBe('no-declared-range');
    expect(r.orderedPairs).toEqual([]);
    expect(r.weightPerturbation.criteria).toEqual([]);
    expect(r.alternativeSetPerturbation.removals).toEqual([]);
    expect(r.finding).toMatch(/No stability finding/);
  });

  it('reports nothing to be stable about when no criterion carries a weight', () => {
    const r = run(doc([{ m: ORD }], { x: [5], y: [1] }));
    expect(r.refused?.reason).toBe('no-weighted-criteria');
    expect(r.weightPerturbation.criteria).toEqual([]);
  });

  it('says so when the gate scored nothing separable, rather than reporting large margins', () => {
    const r = run(doc([{ m: ORD, w: 1 }], { x: [3], y: [3] }));
    expect(r.orderedPairs).toEqual([]);
    expect(r.weightPerturbation.smallest).toBeUndefined();
    expect(r.warnings.join(' ')).toMatch(/absent rather than large/);
  });
});

describe('the messy fixture, with weights declared over it', () => {
  const examples = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples');
  const weighted = () => {
    const a = Analysis.parse(JSON.parse(readFileSync(join(examples, 'relocation.json'), 'utf8')));
    // relocation.json declares no substitution weights (nothing in the repo does);
    // weight the criteria a weighted sum can actually place.
    const placeable = new Set(['rent', 'income-tax', 'winter-daylight', 'flight-hours', 'school-quality']);
    return {
      ...a,
      criteria: a.criteria.map((c) => (placeable.has(c.id) ? { ...c, weights: { substitution: 1 } } : c)),
    };
  };

  it('runs over blanks, structural absences and criterion-scoped codes without refusing', () => {
    const r = sensitivity(weighted(), { measure: 'score' });
    expect(r.refused).toBeUndefined();
    expect(r.weightPerturbation.criteria).toHaveLength(5);
    expect(r.alternativeSetPerturbation.reversalFound).toBe(false);
    // Every scored row is a real row of the fixture; unscored ones are named, not dropped.
    const ids = new Set(weighted().alternatives.map((x) => x.id));
    for (const p of r.orderedPairs) { expect(ids.has(p.higher)).toBe(true); expect(ids.has(p.lower)).toBe(true); }
    for (const u of r.unscored) expect(ids.has(u)).toBe(true);
  });

  it('every margin it reports is one the weighted sum agrees with', () => {
    const a = weighted();
    const r = sensitivity(a, { measure: 'score' });
    for (const c of r.weightPerturbation.criteria) {
      for (const change of [c.ifRaised, c.ifLowered]) {
        if (!change || change.cause !== 'pair-stops-being-ordered') continue;
        const { higher, lower } = change.pair!;
        const before = change.direction === 'up' ? change.at * 0.999 : change.at * 1.001 + 1e-9;
        const after = change.direction === 'up' ? change.at * 1.001 + 1e-9 : change.at * 0.999;
        expect(ordered(a, higher, lower, { id: c.criterionId, w: before }), `${c.criterionId} before`).toBe(true);
        expect(ordered(a, higher, lower, { id: c.criterionId, w: after }), `${c.criterionId} after`).toBe(false);
      }
    }
  });
});
