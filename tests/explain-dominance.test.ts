/**
 * `explainDominance` and the basis in words (#78, ADR-0019).
 *
 * The explanation is for display only, and it is only worth showing if it can
 * never disagree with the relation it explains. So the load-bearing test here is
 * agreement: over generated matrices -- blanks, structural absences, decreasing
 * preferences, practical tolerance on and off -- every pair's explanation must
 * say exactly what `dominance()` says about that pair. (The generator also
 * declares a `target` criterion; since #43 it is excluded from the basis, as
 * ADR-0019 clause 7 requires, so it exercises the exclusion path only.)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { dominance, explainDominance } from '../src/core/analyses/dominance.js';
import { Analysis } from '../src/core/schema/analysis.js';

/** Deterministic PRNG, so a failure is reproducible from the seed alone. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const MEASUREMENTS = [
  { level: 'ordinal', preference: 'increasing', range: { min: 1, max: 5 }, levels: [1, 2, 3, 4, 5] },
  { level: 'ratio', preference: 'decreasing', range: { min: 0, max: 100 }, thresholds: { indifference: 10 } },
  { level: 'interval', preference: 'target', range: { min: 0, max: 10, target: 6 }, thresholds: { indifference: 1 } },
  { level: 'ordinal', preference: 'increasing', range: { min: 1, max: 3 }, levels: [1, 2, 3] },
];

function randomAnalysis(rand: () => number, nAlts: number) {
  const alternatives = Array.from({ length: nAlts }, (_, i) => ({ id: `a${i}`, label: `A${i}` }));
  const criteria = MEASUREMENTS.map((m, j) => ({ id: `c${j}`, label: `C${j}`, measurements: { score: m } }));
  const cells = alternatives.flatMap((alt) => criteria.map((c, j) => {
    const m = MEASUREMENTS[j]!;
    const r = rand();
    const assertion: Record<string, unknown> = {
      id: `${alt.id}-${c.id}`, authorId: 'a', at: '2026-01-01T00:00:00Z', evidence: [], version: 1,
    };
    if (r < 0.25) assertion.missing = { code: 'not-assessed' };
    else if (r < 0.32) assertion.missing = { code: 'not-applicable' };
    else {
      assertion.value = m.range.min + Math.floor(rand() * (m.range.max - m.range.min + 1));
      assertion.justification = 'generated';
    }
    return { alternativeId: alt.id, criterionId: c.id, measure: 'score', assertions: [assertion] };
  }));
  return Analysis.parse({
    id: 'gen', subject: { question: 'agreement' }, measures: [{ name: 'score' }],
    authors: [{ id: 'a', displayName: 'gen', kind: 'derived' }],
    alternatives, criteria, cells,
  });
}

function expectAgreement(a: Analysis, usePracticalTolerance: boolean) {
  const opts = { measure: 'score', usePracticalTolerance };
  const d = dominance(a, opts);
  const edges = new Set(d.edges.map((e) => `${e.dominator}>${e.dominated}`));
  const ids = a.alternatives.map((x) => x.id);
  const possiblyDominated = new Set<string>();
  for (const x of ids) {
    for (const y of ids) {
      if (x === y) continue;
      const e = explainDominance(a, x, y, opts);
      expect(e.necessarilyDominates, `${x}>${y}: ${e.summary}`).toBe(edges.has(`${x}>${y}`));
      if (e.possiblyDominates) possiblyDominated.add(y);
      // Independently of the shared code path: recompute both verdicts from the
      // intervals the explanation reports, straight from ADR-0019 clause 2
      // (with the practical tolerance q applied symmetrically).
      const compared = e.criteria.filter((c) => c.standing !== 'excluded');
      const nec = compared.length > 0 &&
        compared.every((c) => c.x!.lo >= c.y!.hi - c.tolerance) &&
        compared.some((c) => c.x!.lo > c.y!.hi + c.tolerance);
      const pos = compared.every((c) => c.x!.hi >= c.y!.lo - c.tolerance) &&
        compared.some((c) => c.x!.hi > c.y!.lo + c.tolerance);
      expect(e.necessarilyDominates, `${x}>${y} necessary, from intervals`).toBe(nec);
      expect(e.possiblyDominates, `${x}>${y} possible, from intervals`).toBe(nec || pos);
      expect(e.basis).toEqual(d.basis);
      expect(e.basisDescription).toBe(d.basisDescription);
    }
  }
  // The tiers follow from the pairwise verdicts the explanation reports.
  for (const id of ids) {
    const tier = d.dominated.includes(id) ? 'dominated'
      : d.provisional.includes(id) ? 'provisional' : 'nonDominated';
    const expected = d.edges.some((e) => e.dominated === id) ? 'dominated'
      : possiblyDominated.has(id) ? 'provisional' : 'nonDominated';
    expect(tier, id).toBe(expected);
  }
  return d;
}

describe('explainDominance agrees with dominance()', () => {
  it('on every pair of generated matrices, with and without the practical tolerance', () => {
    const rand = rng(20260922);
    let edgesSeen = 0;
    for (let t = 0; t < 60; t += 1) {
      const a = randomAnalysis(rand, 6);
      edgesSeen += expectAgreement(a, false).edges.length;
      edgesSeen += expectAgreement(a, true).edges.length;
    }
    // Not vacuous: the generator produces real dominance edges to agree about.
    expect(edgesSeen).toBeGreaterThan(20);
  });

  it('on every pair of the messy fixture', () => {
    const examples = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples');
    const a = Analysis.parse(JSON.parse(readFileSync(join(examples, 'relocation.json'), 'utf8')));
    expectAgreement(a, false);
    expectAgreement(a, true);
  });
});

describe('what an explanation says', () => {
  const doc = (rows: Record<string, (number | 'na' | undefined)[]>, extra: Record<string, unknown> = {}) => {
    const criteria = [
      { id: 'q', label: 'Quality', defaultMeasurement: MEASUREMENTS[0] },
      { id: 'p', label: 'Price', defaultMeasurement: MEASUREMENTS[1] },
    ];
    return Analysis.parse({
      id: 'd', subject: { question: 'q' }, authors: [{ id: 'a', displayName: 'a', kind: 'human' }],
      alternatives: Object.keys(rows).map((id) => ({ id, label: id })),
      criteria,
      cells: Object.entries(rows).flatMap(([alt, vals]) => vals.map((v, j) => ({
        alternativeId: alt, criterionId: criteria[j]!.id, measure: 'score',
        assertions: [{
          id: `${alt}${j}`, authorId: 'a', at: '2026-01-01T00:00:00Z', evidence: [], version: 1,
          ...(v === undefined ? { missing: { code: 'not-assessed' } }
            : v === 'na' ? { missing: { code: 'not-applicable' } }
            : { value: v, justification: 'x' }),
        }],
      }))),
      ...extra,
    });
  };

  it('names the criteria that decide a necessary dominance', () => {
    const e = explainDominance(doc({ x: [5, 20], y: [3, 20] }), 'x', 'y', { measure: 'score' });
    expect(e.necessarilyDominates).toBe(true);
    expect(e.criteria.map((c) => [c.criterionId, c.standing])).toEqual([['q', 'better'], ['p', 'indifferent']]);
    expect(e.summary).toMatch(/necessarily dominates/);
    expect(e.summary).toContain('q');
  });

  it('does not call two identical, fully scored alternatives provisional (review finding)', () => {
    // ADR-0019: possible dominance needs "strict somewhere". Without it each of
    // two identical rows "possibly dominated" the other, with no blank to resolve,
    // and the summary ended "depending on how the blanks resolve on ."
    const a = doc({ x: [3, 20], y: [3, 20] });
    const e = explainDominance(a, 'x', 'y', { measure: 'score' });
    expect(e.possiblyDominates).toBe(false);
    expect(e.summary).not.toMatch(/on \.$/);
    const d = dominance(a, { measure: 'score' });
    expect(d.provisional).toEqual([]);
    expect(d.nonDominated.sort()).toEqual(['x', 'y']);
  });

  it('applies the tolerance to possible dominance as it does to necessary', () => {
    // x=5.5 vs y=5 on a tolerance of 1 is indifference both ways; y cannot then
    // be judged unable to reach x, which the untolerant check used to say.
    const a = doc({ x: [4, 20], y: [3, 20] });
    const e = explainDominance(a, 'y', 'x', { measure: 'score', usePracticalTolerance: true });
    const q = e.criteria.find((c) => c.criterionId === 'q')!;
    expect(q.xCanReach).toBe(q.x!.hi >= q.y!.lo - q.tolerance);
  });

  it('orients a decreasing criterion: a lower price is better', () => {
    const e = explainDominance(doc({ x: [3, 10], y: [3, 90] }), 'x', 'y', { measure: 'score' });
    expect(e.criteria.find((c) => c.criterionId === 'p')!.standing).toBe('better');
    expect(e.necessarilyDominates).toBe(true);
  });

  it('says which criterion rules dominance out', () => {
    const e = explainDominance(doc({ x: [5, 90], y: [3, 10] }), 'x', 'y', { measure: 'score' });
    expect(e.necessarilyDominates).toBe(false);
    expect(e.criteria.find((c) => c.criterionId === 'p')!.standing).toBe('worse');
    expect(e.summary).toMatch(/worse on p/);
  });

  it('names the blank a possible dominance depends on', () => {
    const e = explainDominance(doc({ x: [5, undefined], y: [3, 50] }), 'x', 'y', { measure: 'score' });
    expect(e.necessarilyDominates).toBe(false);
    expect(e.possiblyDominates).toBe(true);
    expect(e.criteria.find((c) => c.criterionId === 'p')!.standing).toBe('undetermined');
    expect(e.summary).toMatch(/might dominate.*p/);
  });

  it('reports a structurally absent cell as excluded, and on which side', () => {
    const e = explainDominance(doc({ x: [5, 'na'], y: [3, 50] }), 'x', 'y', { measure: 'score' });
    const p = e.criteria.find((c) => c.criterionId === 'p')!;
    expect(p.standing).toBe('excluded');
    expect(p.exclusion).toEqual({ side: 'x', reason: 'structural' });
    // The structural cell leaves the pair's comparison; q alone decides it.
    expect(e.necessarilyDominates).toBe(true);
  });

  it('applies the indifference tolerance only when asked', () => {
    const a = doc({ x: [3, 45], y: [3, 50] });
    expect(explainDominance(a, 'x', 'y', { measure: 'score' }).criteria[1]!.standing).toBe('better');
    const tol = explainDominance(a, 'x', 'y', { measure: 'score', usePracticalTolerance: true });
    expect(tol.criteria[1]!.standing).toBe('indifferent');
    expect(tol.criteria[1]!.tolerance).toBe(10);
  });

  it('refuses an alternative outside the scope rather than explaining a different relation', () => {
    const a = doc({ x: [5, 20], y: [3, 20] });
    expect(() => explainDominance(a, 'x', 'ghost', { measure: 'score' })).toThrow(/not an alternative in scope/);
    expect(() => explainDominance(a, 'x', 'y', { measure: 'score', alternativeIds: ['x'] })).toThrow(/scope/);
  });
});

describe('the basis in words', () => {
  const build = (criteria: unknown[], alternatives: number, extra: Record<string, unknown> = {}) => Analysis.parse({
    id: 'b', subject: { question: 'q' },
    alternatives: Array.from({ length: alternatives }, (_, i) => ({ id: `a${i}`, label: `A${i}` })),
    criteria, ...extra,
  });
  const ranked = (id: string) => ({ id, label: id, defaultMeasurement: MEASUREMENTS[0] });
  const nominal = (id: string) => ({
    id, label: id, defaultMeasurement: { level: 'nominal', preference: 'none', levels: ['a', 'b'] },
  });
  const unranged = (id: string) => ({
    id, label: id, defaultMeasurement: { level: 'ratio', preference: 'increasing' },
  });

  it('counts the basis, the alternatives and the exclusions, with their reasons', () => {
    const a = build([ranked('r1'), ranked('r2'), nominal('n1'), nominal('n2'), unranged('u1')], 12);
    expect(dominance(a, { measure: 'score' }).basisDescription).toBe(
      'computed over the 2 criteria that admit a dominance comparison, across 12 alternatives; ' +
      '3 criteria excluded: 2 nominal, 1 with no declared range.',
    );
  });

  it('uses the singular for one', () => {
    const a = build([ranked('r1'), nominal('n1')], 1);
    expect(dominance(a, { measure: 'score' }).basisDescription).toBe(
      'computed over the 1 criterion that admits a dominance comparison, across 1 alternative; ' +
      '1 criterion excluded: 1 nominal.',
    );
  });

  it('says so when nothing can be compared', () => {
    const a = build([nominal('n1')], 3);
    expect(dominance(a, { measure: 'score' }).basisDescription).toMatch(/^no criterion admits a dominance comparison, across 3 alternatives/);
  });

  it('uses the analysis\'s display aliases', () => {
    const a = build([ranked('r1'), ranked('r2')], 4, {
      aliases: { alternative: 'option', alternatives: 'options', criterion: 'factor', criteria: 'factors' },
    });
    expect(dominance(a, { measure: 'score' }).basisDescription).toBe(
      'computed over the 2 factors that admit a dominance comparison, across 4 options.',
    );
  });

  it('counts structurally absent cells, which leave their pairs\' comparisons', () => {
    const a = build([ranked('r1')], 2, {
      authors: [{ id: 'a', displayName: 'a', kind: 'human' }],
      cells: [{
        alternativeId: 'a0', criterionId: 'r1', measure: 'score',
        assertions: [{ id: 's', authorId: 'a', at: '2026-01-01T00:00:00Z', evidence: [], version: 1,
          missing: { code: 'not-applicable' } }],
      }],
    });
    expect(dominance(a, { measure: 'score' }).basisDescription).toMatch(
      /; 1 cell not applicable, which leaves the comparison for the pairs it is in\.$/,
    );
  });
});
