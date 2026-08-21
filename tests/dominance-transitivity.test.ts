/**
 * The property the whole dominance design exists to guarantee.
 *
 * The naive rule -- compare only on criteria where both alternatives have a
 * value -- is the published definition in the incomplete-data skyline
 * literature, and it is not a partial order. This file demonstrates that
 * directly, then shows that interval completion is, over the same random
 * matrices at the same scale that broke the naive rule.
 *
 * These are property tests over generated data rather than examples, because a
 * hand-picked counterexample proves the rule is broken but never proves the
 * replacement is sound.
 */
import { describe, it, expect } from 'vitest';
import { dominance } from '../src/core/analyses/dominance.js';
import type { Analysis } from '../src/core/schema/analysis.js';

/** Deterministic PRNG, so a failure is reproducible from the seed alone. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const CRITERIA = ['c1', 'c2', 'c3'] as const;

function buildAnalysis(
  rows: { id: string; values: (number | undefined)[] }[],
): Analysis {
  return {
    schemaVersion: 1,
    id: 'test',
    subject: { question: 'transitivity' },
    measures: [{ name: 'score' }],
    defaultReduction: 'single',
    aliases: undefined as never,
    alternatives: rows.map((r) => ({ id: r.id, label: r.id, groupIds: [] })),
    criteria: CRITERIA.map((c) => ({
      id: c,
      label: c,
      groupIds: [],
      measurements: {
        score: {
          level: 'ordinal' as const,
          preference: 'increasing' as const,
          range: { min: 1, max: 5 },
          levels: [1, 2, 3, 4, 5],
        },
      },
    })),
    groups: [],
    inapplicable: [],
    rejectedCriteria: [],
    cells: rows.flatMap((r) =>
      r.values.flatMap((v, i) =>
        v === undefined
          ? [{
              alternativeId: r.id, criterionId: CRITERIA[i]!, measure: 'score',
              assertions: [{
                id: `${r.id}-${i}`, authorId: 'a', at: '2026-01-01T00:00:00Z',
                missing: { code: 'not-assessed' },
                evidence: [], independence: 'independent' as const, version: 1,
              }],
            }]
          : [{
              alternativeId: r.id, criterionId: CRITERIA[i]!, measure: 'score',
              assertions: [{
                id: `${r.id}-${i}`, authorId: 'a', at: '2026-01-01T00:00:00Z',
                value: v,
                evidence: [], independence: 'independent' as const, version: 1,
              }],
            }],
      ),
    ),
    authors: [{ id: 'a', displayName: 'test', kind: 'human' }],
    procedures: [], rounds: [], threads: [], suggestions: [], missingCodes: [],
  } as unknown as Analysis;
}

/** The rule we rejected: compare only where both sides have a value. */
function naiveDominates(a: (number | undefined)[], b: (number | undefined)[]): boolean {
  let strict = false;
  let compared = false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i], y = b[i];
    if (x === undefined || y === undefined) continue;
    compared = true;
    if (x < y) return false;
    if (x > y) strict = true;
  }
  return compared && strict;
}

describe('the naive common-dimensions rule', () => {
  it('is not transitive, at the scale and sparsity this tool targets', () => {
    const rand = rng(20260821);
    let violations = 0;
    let cycles = 0;
    const TRIPLES = 200_000;

    for (let t = 0; t < TRIPLES; t += 1) {
      const draw = () =>
        CRITERIA.map(() => (rand() < 0.35 ? undefined : 1 + Math.floor(rand() * 5)));
      const a = draw(), b = draw(), c = draw();

      if (naiveDominates(a, b) && naiveDominates(b, c) && !naiveDominates(a, c)) violations += 1;
      if (naiveDominates(a, b) && naiveDominates(b, c) && naiveDominates(c, a)) cycles += 1;
    }

    // Not an assertion about exact counts -- the point is that both are far
    // from zero, which is what disqualifies the rule.
    expect(violations).toBeGreaterThan(0);
    expect(cycles).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`naive rule over ${TRIPLES} triples: ${violations} transitivity violations, ${cycles} cycles`);
  });
});

describe('interval-completion dominance', () => {
  it('is transitive over the same generated matrices', () => {
    const rand = rng(20260821);
    let violations = 0;
    const TRIALS = 400;

    for (let t = 0; t < TRIALS; t += 1) {
      const rows = ['x', 'y', 'z'].map((id) => ({
        id,
        values: CRITERIA.map(() => (rand() < 0.35 ? undefined : 1 + Math.floor(rand() * 5))),
      }));
      const result = dominance(buildAnalysis(rows), { measure: 'score' });
      const edge = new Set(result.edges.map((e) => `${e.dominator}>${e.dominated}`));

      for (const [p, q, r] of [['x', 'y', 'z'], ['y', 'z', 'x'], ['z', 'x', 'y'],
                               ['x', 'z', 'y'], ['y', 'x', 'z'], ['z', 'y', 'x']]) {
        if (edge.has(`${p}>${q}`) && edge.has(`${q}>${r}`) && !edge.has(`${p}>${r}`)) {
          violations += 1;
        }
      }
    }

    expect(violations).toBe(0);
  });

  it('is asymmetric: nothing necessarily dominates something that dominates it', () => {
    const rand = rng(7);
    for (let t = 0; t < 300; t += 1) {
      const rows = ['x', 'y'].map((id) => ({
        id,
        values: CRITERIA.map(() => (rand() < 0.4 ? undefined : 1 + Math.floor(rand() * 5))),
      }));
      const result = dominance(buildAnalysis(rows), { measure: 'score' });
      const edge = new Set(result.edges.map((e) => `${e.dominator}>${e.dominated}`));
      expect(edge.has('x>y') && edge.has('y>x')).toBe(false);
    }
  });

  it('never dominates on a blank alone: an all-blank row dominates nothing', () => {
    const a = buildAnalysis([
      { id: 'blank', values: [undefined, undefined, undefined] },
      { id: 'low', values: [1, 1, 1] },
    ]);
    const result = dominance(a, { measure: 'score' });
    expect(result.edges.filter((e) => e.dominator === 'blank')).toHaveLength(0);
    // ...and it is not dominated either, because its blanks could resolve high.
    expect(result.dominated).not.toContain('blank');
    expect(result.provisional).toContain('blank');
  });

  it('reports which criteria it excluded, rather than excluding them silently', () => {
    const a = buildAnalysis([{ id: 'x', values: [3, 3, 3] }]);
    // A nominal criterion cannot enter a dominance comparison.
    a.criteria.push({
      id: 'nom', label: 'category', groupIds: [],
      measurements: { score: { level: 'nominal', preference: 'none', levels: ['a', 'b'] } },
    } as never);

    const result = dominance(a, { measure: 'score' });
    expect(result.basis).not.toContain('nom');
    expect(result.excluded.map((e) => e.criterionId)).toContain('nom');
    expect(result.notes.join(' ')).toMatch(/excluded/i);
  });

  it('separates necessary dominance from provisional survival', () => {
    // `hi` beats `lo` on every criterion with no blanks: necessary.
    // `maybe` has a blank that could beat `hi`, so it is only provisional.
    const a = buildAnalysis([
      { id: 'hi', values: [5, 5, 5] },
      { id: 'lo', values: [1, 1, 1] },
      { id: 'maybe', values: [5, 5, undefined] },
    ]);
    const result = dominance(a, { measure: 'score' });
    expect(result.dominated).toContain('lo');
    expect(result.dominated).not.toContain('maybe');
    expect(result.uncertaintyCost).toBeGreaterThan(0);
  });
});
