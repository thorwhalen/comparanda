/**
 * `blanksWorthFilling` must actually discriminate between blanks.
 *
 * The first implementation assigned every entry the same score, so the sort did
 * nothing and the "ranking" was arbitrary — a function whose entire purpose is
 * ranking, silently not ranking. That is the kind of defect a test suite full of
 * "it returns an array" would never catch, so these tests assert the *ordering
 * property* rather than the shape.
 */
import { describe, it, expect } from 'vitest';
import { blanksWorthFilling, dominance } from '../src/core/analyses/dominance.js';
import type { Analysis } from '../src/core/schema/analysis.js';

function analysis(
  rows: { id: string; values: (number | undefined)[] }[],
  criteria: string[],
): Analysis {
  return {
    schemaVersion: 1,
    id: 'voi',
    subject: { question: 'which blank matters?' },
    measures: [{ name: 'score' }],
    defaultReduction: 'single',
    alternatives: rows.map((r) => ({ id: r.id, label: r.id, groupIds: [] })),
    criteria: criteria.map((c) => ({
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
      r.values.map((v, i) => {
        const assertion: Record<string, unknown> = {
          id: `${r.id}-${i}`, authorId: 'a', at: '2026-01-01T00:00:00Z',
          evidence: [], independence: 'independent', version: 1,
        };
        if (v === undefined) assertion.missing = { code: 'not-assessed' };
        else assertion.value = v;
        return { alternativeId: r.id, criterionId: criteria[i]!, measure: 'score', assertions: [assertion] };
      }),
    ),
    authors: [{ id: 'a', displayName: 'test', kind: 'human' }],
    procedures: [], rounds: [], threads: [], suggestions: [], missingCodes: [],
  } as unknown as Analysis;
}

describe('blanksWorthFilling', () => {
  it('does not return a flat ranking when blanks differ in consequence', () => {
    // `strong` is at the top of the range on every criterion.
    //
    // `contender` matches it on c2 and c3 and is blank on c1. That blank decides
    // two things: whether `strong` dominates it, and whether it dominates
    // `hopeless`.
    //
    // `hopeless` is blank on c1 as well, but it is behind on c2 and c3 and c1
    // cannot exceed `strong`'s 5 — so `strong` dominates it whichever way the
    // blank falls. Filling it settles only its comparison with `contender`.
    //
    // (An earlier version of this fixture gave `strong` a 3 on c1, which let
    // `hopeless` escape domination at c1=5 — so both blanks scored the same and
    // the test failed for a reason that had nothing to do with the ranking.)
    const a = analysis(
      [
        { id: 'strong', values: [5, 5, 5] },
        { id: 'contender', values: [undefined, 5, 5] },
        { id: 'hopeless', values: [undefined, 1, 1] },
      ],
      ['c1', 'c2', 'c3'],
    );

    const ranked = blanksWorthFilling(a, { measure: 'score' });
    const scores = new Set(ranked.map((r) => r.decidesPairs));
    expect(scores.size, 'every blank scored the same — the ranking is not ranking').toBeGreaterThan(1);

    const top = ranked[0]!;
    expect(top.alternativeId).toBe('contender');
    expect(top.criterionId).toBe('c1');
    expect(top.against).toContain('strong');
  });

  it('omits blanks that cannot change any verdict', () => {
    // Both alternatives are blank on c2, but they are identical everywhere else,
    // so neither dominates the other whatever c2 turns out to be.
    const a = analysis(
      [
        { id: 'x', values: [3, undefined] },
        { id: 'y', values: [3, undefined] },
      ],
      ['c1', 'c2'],
    );
    const ranked = blanksWorthFilling(a, { measure: 'score' });
    expect(ranked).toHaveLength(0);
  });

  it('is reproducible: same input, same order', () => {
    const a = analysis(
      [
        { id: 'a1', values: [undefined, 4, 2] },
        { id: 'a2', values: [3, undefined, 5] },
        { id: 'a3', values: [2, 2, undefined] },
      ],
      ['c1', 'c2', 'c3'],
    );
    const once = blanksWorthFilling(a, { measure: 'score' });
    const twice = blanksWorthFilling(a, { measure: 'score' });
    expect(JSON.stringify(once)).toBe(JSON.stringify(twice));
  });

  it('only names blanks, never cells that already carry a value', () => {
    const a = analysis(
      [
        { id: 'a1', values: [5, undefined] },
        { id: 'a2', values: [1, 1] },
      ],
      ['c1', 'c2'],
    );
    const ranked = blanksWorthFilling(a, { measure: 'score' });
    for (const r of ranked) {
      expect(`${r.alternativeId}/${r.criterionId}`).not.toBe('a1/c1');
      expect(`${r.alternativeId}/${r.criterionId}`).not.toBe('a2/c1');
      expect(`${r.alternativeId}/${r.criterionId}`).not.toBe('a2/c2');
    }
  });

  it('returns nothing when no criterion admits a dominance comparison', () => {
    const a = analysis([{ id: 'x', values: [undefined] }], ['c1']);
    a.criteria[0]!.measurements.score = {
      level: 'nominal', preference: 'none', levels: ['p', 'q'],
    } as never;
    expect(dominance(a, { measure: 'score' }).basis).toHaveLength(0);
    expect(blanksWorthFilling(a, { measure: 'score' })).toHaveLength(0);
  });
});
