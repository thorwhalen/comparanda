/**
 * findNonDiscriminatingCriteria (#86) and the Pugh datum-relative tally (#83),
 * ADR-0015 sub-amendments (f) and (g).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Analysis } from '../src/core/schema/analysis.js';
import { findNonDiscriminatingCriteria } from '../src/core/analyses/non-discriminating.js';
import { pughTally } from '../src/core/analyses/pugh.js';
import { projectForReader } from '../src/core/schema/disclosure.js';

const examples = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const relocation = () => Analysis.parse(JSON.parse(readFileSync(join(examples, 'relocation.json'), 'utf8')));

type V = number | string | undefined | 'na';
const ORD = { level: 'ordinal', preference: 'increasing', range: { min: 1, max: 5 }, levels: [1, 2, 3, 4, 5] };

/** Rows of values per alternative, one column per criterion measurement given. */
function doc(measurements: Record<string, unknown>[], rows: Record<string, V[]>, extra: Record<string, unknown> = {}) {
  const criteria = measurements.map((m, j) => ({ id: `c${j}`, label: `C${j}`, defaultMeasurement: m }));
  return Analysis.parse({
    id: 'd', subject: { question: 'q' }, authors: [{ id: 'a', displayName: 'a', kind: 'human' }],
    alternatives: Object.keys(rows).map((id) => ({ id, label: id.toUpperCase() })),
    criteria,
    cells: Object.entries(rows).flatMap(([alt, vals]) => vals.flatMap((v, j) => (v === undefined ? [] : [{
      alternativeId: alt, criterionId: `c${j}`, measure: 'score',
      assertions: [{
        id: `${alt}${j}`, authorId: 'a', at: '2026-01-01T00:00:00Z', evidence: [], version: 1,
        ...(v === 'na' ? { missing: { code: 'not-applicable' } } : { value: v, justification: 'x' }),
      }],
    }]))),
    ...extra,
  });
}

describe('findNonDiscriminatingCriteria (#86)', () => {
  const statusOf = (a: Analysis, cid: string) =>
    findNonDiscriminatingCriteria(a, { measure: 'score' }).criteria.find((c) => c.criterionId === cid)!;

  it('uses the declared indifference, not an epsilon', () => {
    const tolerant = doc([{ ...ORD, thresholds: { indifference: 1 } }], { x: [3], y: [4], z: [3] });
    const strict = doc([ORD], { x: [3], y: [4], z: [3] });
    expect(statusOf(tolerant, 'c0')).toMatchObject({ status: 'non-discriminating', tolerance: 1, spread: 1 });
    expect(statusOf(strict, 'c0')).toMatchObject({ status: 'discriminating', tolerance: 0 });
    // Exact equality with no threshold declared.
    expect(statusOf(doc([ORD], { x: [3], y: [3] }), 'c0').status).toBe('non-discriminating');
  });

  it('never lets a blank make a column look uniform', () => {
    const a = doc([ORD], { x: [3], y: [3], z: [undefined] });
    const c = statusOf(a, 'c0');
    expect(c.status).toBe('undetermined');
    expect(c.blanks).toBe(1);
    expect(c.reason).toMatch(/1 blank/);
    expect(findNonDiscriminatingCriteria(a, { measure: 'score' }).proposed).toEqual([]);
  });

  it('decides a blank column when the declared range is inside the tolerance', () => {
    const a = doc([{ ...ORD, range: { min: 1, max: 2 }, levels: [1, 2], thresholds: { indifference: 1 } }], { x: [1], y: [2], z: [undefined] });
    expect(statusOf(a, 'c0').status).toBe('non-discriminating');
  });

  it('lets a structural absence leave the column, and counts it', () => {
    const a = doc([ORD], { x: [3], y: [3], z: ['na'] });
    expect(statusOf(a, 'c0')).toMatchObject({ status: 'non-discriminating', structural: 1, valued: 2 });
  });

  it('compares nominal values by identity', () => {
    const nom = { level: 'nominal', preference: 'none', levels: ['a', 'b'] };
    expect(statusOf(doc([nom], { x: ['a'], y: ['a'] }), 'c0').status).toBe('non-discriminating');
    expect(statusOf(doc([nom], { x: ['a'], y: ['b'] }), 'c0').status).toBe('discriminating');
  });

  it('proposes and never writes', () => {
    const a = doc([ORD, ORD], { x: [3, 1], y: [3, 5] });
    const before = structuredClone(a);
    const r = findNonDiscriminatingCriteria(a, { measure: 'score' });
    expect(r.proposed).toEqual(['c0']);
    expect(a).toEqual(before);
    expect(a.criteria.map((c) => c.id)).toEqual(['c0', 'c1']);
    expect(r.notes.join(' ')).toMatch(/nothing has been removed/);
  });

  it('runs over the messy fixture with a status and a reason for every criterion', () => {
    const a = relocation();
    const r = findNonDiscriminatingCriteria(a, { measure: 'score' });
    expect(r.criteria.map((c) => c.criterionId)).toEqual(a.criteria.filter((c) => !c.tombstoned).map((c) => c.id));
    for (const c of r.criteria) expect(c.reason.length, c.criterionId).toBeGreaterThan(5);
    expect(r.widenedByDisclosure).toBe(0);
  });
});

describe('pughTally (#83)', () => {
  it('returns four counts and nothing a caller could read as a net', () => {
    const a = doc([ORD, ORD, ORD, ORD], { d: [3, 3, 3, 3], x: [4, 2, 3, undefined] });
    const r = pughTally(a, { measure: 'score', datum: 'd' });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.counts).toEqual({ better: 1, same: 1, worse: 1, notComparable: 1 });
    expect(Object.keys(r.rows[0]!.counts).sort()).toEqual(['better', 'notComparable', 'same', 'worse']);
    // No net, total or score anywhere in the result, at any depth.
    const keys: string[] = [];
    const walk = (o: unknown) => {
      if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { keys.push(k); walk(v); }
    };
    walk(r);
    // Word-level, so `assumptions` (#87) does not read as containing "sum".
    expect(keys.filter((k) => /^(net|total|score|sum|rank)|(Net|Total|Score|Sum|Rank)/.test(k))).toEqual([]);
  });

  it('makes not-comparable a real fourth count, from missingness and from preference none', () => {
    const nom = { level: 'nominal', preference: 'none', levels: ['a', 'b'] };
    const ordered = { ...ORD, preference: 'ordered' };
    const a = doc([ORD, ORD, nom, ordered, { ...ORD, range: undefined }], { d: [3, 3, 'a', 3, 3], x: ['na', undefined, 'b', 4, undefined] });
    const reasons = pughTally(a, { measure: 'score', datum: 'd' }).rows[0]!.criteria.map((c) => [c.standing, c.reason]);
    expect(reasons).toEqual([
      ['not-comparable', 'structural'],
      ['not-comparable', 'blank'],
      ['not-comparable', 'no-preference-direction'],
      ['not-comparable', 'no-preference-direction'],
      ['not-comparable', 'blank'],
    ]);
  });

  it('treats a target criterion as not comparable in v1, as dominance does (ADR-0019 clause 7)', () => {
    const target = { level: 'interval', preference: 'target', range: { min: 0, max: 10, target: 5 } };
    const r = pughTally(doc([target], { d: [5], x: [9] }), { measure: 'score', datum: 'd' });
    expect(r.rows[0]!.criteria[0]).toEqual({ criterionId: 'c0', standing: 'not-comparable', reason: 'target-preference' });
  });

  it('decides a blank the declared range still decides', () => {
    // Datum at the top of the range: a blank can at best equal it, never beat it.
    const a = doc([{ ...ORD, thresholds: { indifference: 0 } }], { d: [5], x: [undefined] });
    expect(pughTally(a, { measure: 'score', datum: 'd' }).rows[0]!.criteria[0]!.standing).toBe('not-comparable');
    const b = doc([ORD], { d: [1], x: [undefined] });
    // Everything in [1,5] is at least the datum's 1; "better" is not certain, "worse" impossible.
    expect(pughTally(b, { measure: 'score', datum: 'd' }).rows[0]!.criteria[0]!.standing).toBe('not-comparable');
    const c = doc([{ ...ORD, range: { min: 4, max: 5 }, levels: [4, 5] }], { d: [3.5], x: [undefined] });
    expect(pughTally(c, { measure: 'score', datum: 'd' }).rows[0]!.criteria[0]!.standing).toBe('better');
  });

  it('decides worse, same and a datum-side blank when the range settles them (review finding)', () => {
    const narrow = { ...ORD, range: { min: 4, max: 5 }, levels: [4, 5] };
    const std = (rows: Record<string, (number | undefined)[]>, m: Record<string, unknown> = narrow) =>
      pughTally(doc([m], rows), { measure: 'score', datum: 'd' }).rows[0]!.criteria[0]!.standing;
    // x's blank lies in [4,5]; a datum at 6 beats all of it.
    expect(std({ d: [6], x: [undefined] })).toBe('worse');
    // Indifference wider than the range: any resolution is "same".
    expect(std({ d: [4.5], x: [undefined] }, { ...narrow, thresholds: { indifference: 1 } })).toBe('same');
    // The blank is on the datum's side: x at 3 is below everything the datum could be.
    expect(std({ d: [undefined], x: [3] })).toBe('worse');
    // Blanks on both sides over a range wider than the tolerance: undecided.
    expect(std({ d: [undefined], x: [undefined] })).toBe('not-comparable');
  });

  it('orients a decreasing criterion and applies the declared indifference as "same"', () => {
    const cost = { level: 'ratio', preference: 'decreasing', range: { min: 0, max: 100 }, thresholds: { indifference: 5 } };
    const r = pughTally(doc([cost, cost], { d: [50, 50], x: [40, 53] }), { measure: 'score', datum: 'd' });
    expect(r.rows[0]!.criteria.map((c) => c.standing)).toEqual(['better', 'same']);
  });

  it('carries the copy saying what the tally is not', () => {
    const r = pughTally(doc([ORD], { d: [3], x: [4] }), { measure: 'score', datum: 'd' });
    expect(r.legend).toMatch(/not a score/);
    expect(r.legend).toMatch(/not comparable across different datums/);
    expect(r.legend).toContain('D');
  });

  it('refuses a datum that is not an alternative', () => {
    expect(() => pughTally(doc([ORD], { d: [3] }), { measure: 'score', datum: 'nope' })).toThrow(/nope/);
  });

  it('runs over the messy fixture, one row per non-datum alternative, counts covering every criterion', () => {
    const a = relocation();
    const datum = a.alternatives[0]!.id;
    const r = pughTally(a, { measure: 'score', datum });
    const alts = a.alternatives.filter((x) => !x.tombstoned && x.id !== datum);
    expect(r.rows.map((x) => x.alternativeId)).toEqual(alts.map((x) => x.id));
    const nCrit = a.criteria.filter((c) => !c.tombstoned).length;
    for (const row of r.rows) {
      const { better, same, worse, notComparable } = row.counts;
      expect(better + same + worse + notComparable).toBe(nCrit);
      // The two nominal criteria in the fixture are never comparable.
      expect(row.criteria.filter((c) => c.reason === 'no-preference-direction').length).toBeGreaterThanOrEqual(2);
    }
  });

  it('reports cells a disclosure projection withheld, in both analyses', () => {
    const a = relocation();
    const labelled = a.cells.flatMap((c) => c.assertions).some((s) => s.disclosure?.label);
    expect(labelled).toBe(true);
    const { analysis } = projectForReader(a, (s) => !s.disclosure?.label);
    const datum = analysis.alternatives[0]!.id;
    expect(pughTally(analysis, { measure: 'score', datum }).widenedByDisclosure).toBeGreaterThan(0);
    expect(findNonDiscriminatingCriteria(analysis, { measure: 'score' }).widenedByDisclosure).toBeGreaterThan(0);
  });
});

describe('dominance, Pugh and completeness read a criterion-scoped code the same way (review finding)', () => {
  it('a structural code declared on the criterion leaves the comparison in all three', async () => {
    const { dominance } = await import('../src/core/analyses/dominance.js');
    const { completeness } = await import('../src/core/schema/analysis.js');
    const a = Analysis.parse({
      id: 's', subject: { question: 'q' }, authors: [{ id: 'a', displayName: 'a', kind: 'human' }],
      alternatives: [{ id: 'd', label: 'D' }, { id: 'x', label: 'X' }],
      criteria: [
        { id: 'c0', label: 'C0', defaultMeasurement: ORD },
        {
          id: 'c1', label: 'C1', defaultMeasurement: ORD,
          missingCodes: [{ id: 'no-such-office', broader: 'not-applicable', structural: true, means: 'x has no office there' }],
        },
      ],
      cells: [
        { alternativeId: 'd', criterionId: 'c0', measure: 'score', assertions: [{ id: 'd0', authorId: 'a', at: '2026-01-01T00:00:00Z', version: 1, evidence: [], value: 3, justification: 'j' }] },
        { alternativeId: 'x', criterionId: 'c0', measure: 'score', assertions: [{ id: 'x0', authorId: 'a', at: '2026-01-01T00:00:00Z', version: 1, evidence: [], value: 2, justification: 'j' }] },
        { alternativeId: 'd', criterionId: 'c1', measure: 'score', assertions: [{ id: 'd1', authorId: 'a', at: '2026-01-01T00:00:00Z', version: 1, evidence: [], value: 1, justification: 'j' }] },
        { alternativeId: 'x', criterionId: 'c1', measure: 'score', assertions: [{ id: 'x1', authorId: 'a', at: '2026-01-01T00:00:00Z', version: 1, evidence: [], missing: { code: 'no-such-office' } }] },
      ],
    });
    // Structural on c1, so d dominates x on c0 alone. Read as a contingent
    // blank instead, x's c1 could be 5 and the edge would not be necessary.
    expect(dominance(a, { measure: 'score' }).edges).toContainEqual({ dominator: 'd', dominated: 'x' });
    expect(completeness(a, { measure: 'score' }).structural).toBe(1);
    const c1 = pughTally(a, { measure: 'score', datum: 'd' }).rows[0]!.criteria.find((c) => c.criterionId === 'c1')!;
    expect(c1.standing).toBe('not-comparable');
  });
});
