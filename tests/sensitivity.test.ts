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

/** The whole reported order at a weighting: which rows are scored, and which pairs are ordered. */
const reportedOrder = (a: Analysis, at?: { id: string; w: number }): string => {
  const r = weightedSum(at ? withWeight(a, at.id, at.w) : a, { measure: 'score' });
  const scored = r.rows.filter((row) => row.status !== 'not-scored');
  const pairs: string[] = [];
  for (const x of scored) {
    for (const y of scored) {
      if (x.alternativeId === y.alternativeId) continue;
      if (separability(x, y) === 'x-higher') pairs.push(`${x.alternativeId}>${y.alternativeId}`);
    }
  }
  return JSON.stringify([scored.map((row) => row.alternativeId).sort(), pairs.sort()]);
};

/**
 * Every margin the analysis reports is the *nearest* boundary: the order is
 * unchanged everywhere strictly between the declared weight and `at`, and
 * changed just past it. This is what makes a margin a margin rather than some
 * weight at which something eventually happens.
 */
const expectNearestBoundary = (a: Analysis, r: ReturnType<typeof sensitivity>) => {
  const here = (id: string) => reportedOrder(a, { id, w: r.weightPerturbation.criteria.find((c) => c.criterionId === id)!.weight });
  for (const c of r.weightPerturbation.criteria) {
    for (const change of [c.ifRaised, c.ifLowered]) {
      if (!change) continue;
      const step = Math.max(Math.abs(change.at), c.weight, 1) * 1e-6;
      const past = change.direction === 'up' ? change.at + step : Math.max(change.at - step, 0);
      expect(reportedOrder(a, { id: c.criterionId, w: past }), `${c.criterionId} ${change.direction}: the order must differ past ${change.at}`)
        .not.toBe(here(c.criterionId));
      // ...and nothing happens on the way there.
      for (let i = 1; i <= 24; i += 1) {
        const between = c.weight + (change.at - c.weight) * (i / 25);
        expect(reportedOrder(a, { id: c.criterionId, w: between }), `${c.criterionId} ${change.direction}: the order changed at ${between}, before the reported ${change.at}`)
          .toBe(here(c.criterionId));
      }
    }
  }
};

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

  it('gives a row the gate did not score no place in the order, and no aggregate', () => {
    // z is blank on the heavy criterion: coverage 1/4, below the 2/3 floor.
    const a = doc([{ m: ORD, w: 3 }, { m: ORD, w: 1 }], { x: [5, 5], y: [3, 3], z: [undefined, 4] });
    const r = run(a);
    expect(r.unscored).toEqual(['z']);
    expect(r.orderedPairs.every((p) => p.higher !== 'z' && p.lower !== 'z')).toBe(true);
    // z may be named as the row that would *enter* the gate -- that is a fact
    // about the order, not a stability number for a row nobody scored -- but it
    // is never given a position in it.
    for (const c of r.weightPerturbation.criteria) {
      for (const change of [c.ifRaised, c.ifLowered]) {
        if (!change) continue;
        if (change.alternativeId === 'z') expect(change.cause).toBe('row-enters-the-coverage-gate');
        expect(change.pair?.higher).not.toBe('z');
        expect(change.pair?.lower).not.toBe('z');
      }
    }
  });

  it('finds the weight at which an unscored row joins the order (review finding)', () => {
    // Lowering the heavy criterion's weight raises z's coverage past the floor:
    // 1/(1+t) >= 2/3 at t <= 0.5, and the order gains x>z and z>y.
    const a = doc([{ m: ORD, w: 3 }, { m: ORD, w: 1 }], { x: [5, 5], y: [3, 3], z: [undefined, 4] });
    const r = run(a);
    const c0 = r.weightPerturbation.criteria.find((c) => c.criterionId === 'c0')!;
    expect(c0.ifLowered?.cause).toBe('row-enters-the-coverage-gate');
    expect(c0.ifLowered?.alternativeId).toBe('z');
    expect(c0.ifLowered?.at).toBeCloseTo(0.5, 9);
    const after = weightedSum(withWeight(a, 'c0', 0.49), { measure: 'score' });
    expect(after.rows.find((row) => row.alternativeId === 'z')!.status).not.toBe('not-scored');
    expectNearestBoundary(a, r);
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

describe('every kind of order change counts, and only real ones (review findings)', () => {
  it('reports a pair that becomes ordered, not only one that stops being', () => {
    // z is blank on c1, so its aggregate is an interval that overlaps y's point.
    // Lowering c1's weight narrows the interval until z > y appears -- a change
    // a scan watching only the pairs already ordered would never see.
    const a = doc([{ m: ORD, w: 8 }, { m: ORD, w: 5 }, { m: ORD, w: 4 }], {
      x: [5, 5, 5], y: [3, 3, 3], z: [4, undefined, 3],
    });
    const r = run(a);
    const causes = r.weightPerturbation.criteria.flatMap((c) => [c.ifRaised?.cause, c.ifLowered?.cause]);
    expect(causes).toContain('pair-becomes-ordered');
    expectNearestBoundary(a, r);
  });

  it('does not report a gate margin for a row that never leaves the gate', () => {
    // z's coverage is (2 + t) / (3 + t) on c2, never below 2/3: no weight of c2
    // takes z out, and a root of the gate equation there is not an event.
    const a = doc([{ m: ORD, w: 2 }, { m: COST, w: 1 }, { m: ORD, w: 1 }], {
      x: [5, 90, 'na'], y: [4, 10, 3], z: [2, undefined, 4],
    });
    const r = run(a);
    const c2 = r.weightPerturbation.criteria.find((c) => c.criterionId === 'c2')!;
    for (const change of [c2.ifRaised, c2.ifLowered]) {
      if (change?.cause === 'row-leaves-the-coverage-gate') expect(change.alternativeId).not.toBe('z');
    }
    expectNearestBoundary(a, r);
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

  it('says what a margin means when the gate separated nothing', () => {
    const a = doc([{ m: ORD, w: 1 }], { x: [3], y: [3] });
    const r = run(a);
    expect(r.orderedPairs).toEqual([]);
    expect(r.warnings.join(' ')).toMatch(/not the weight at which one would break/);
    // Whatever it reports here is a gate event, not a pair that breaks: there
    // is no pair to break.
    for (const c of r.weightPerturbation.criteria) {
      for (const change of [c.ifRaised, c.ifLowered]) {
        if (change) expect(change.cause).not.toBe('pair-stops-being-ordered');
      }
    }
    expectNearestBoundary(a, r);
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

  it('every margin it reports is the nearest boundary the weighted sum agrees with', () => {
    // Whatever the cause -- a pair breaking, a pair appearing, a row entering or
    // leaving the gate -- the whole reported order must be unchanged all the way
    // to the margin and changed just past it.
    const a = weighted();
    expectNearestBoundary(a, sensitivity(a, { measure: 'score' }));
  });

  it('catches an order change that only a gained pair reveals', () => {
    // The fixture's margins used to be read off the pairs already ordered, which
    // overstated them several-fold: on these weights the first thing that happens
    // to several criteria is a new pair appearing, not an old one breaking.
    const r = sensitivity(weighted(), { measure: 'score' });
    const changes = r.weightPerturbation.criteria.flatMap((c) => [c.ifRaised, c.ifLowered]).filter(Boolean);
    expect(changes.some((change) => change!.cause === 'pair-becomes-ordered')).toBe(true);
    // And every criterion has a margin in at least one direction: with five
    // weights on this matrix, none of them is inert.
    for (const c of r.weightPerturbation.criteria) {
      expect(c.nearest, `${c.criterionId} reports no margin at all`).toBeDefined();
    }
  });
});
