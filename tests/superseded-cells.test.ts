/**
 * "n cells were scored against a superseded criterion definition" (#62).
 *
 * A criterion that changed meaning after a score was given leaves that score
 * answering a question the document no longer asks. These tests pin what
 * counts as superseded, and that the two cases this cannot decide -- versions
 * with no ordering, assertions with no version -- are reported, not guessed.
 */
import { describe, it, expect } from 'vitest';
import { Analysis, supersededCells, compareCriteriaVersions } from '../src/core/schema/analysis.js';

const assertion = (id: string, over: Record<string, unknown> = {}) => ({
  id, authorId: 'ana', at: '2026-08-22T00:00:00Z', value: 3, justification: 'because', ...over,
});
const cell = (alternativeId: string, criterionId: string, assertions: unknown[], measure = 'score') => ({
  alternativeId, criterionId, measure, assertions,
});
const ORDINAL = { level: 'ordinal', preference: 'increasing', range: { min: 1, max: 5 } };
const build = (cells: unknown[], criteria?: unknown[], extra: Record<string, unknown> = {}) => Analysis.parse({
  id: 'a', subject: { question: 'q' }, criteriaVersion: '3',
  authors: [{ id: 'ana', displayName: 'Ana', kind: 'human' }],
  alternatives: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }],
  criteria: criteria ?? [
    { id: 'moved', label: 'Moved', defaultMeasurement: ORDINAL, definedInVersion: '2' },
    { id: 'stable', label: 'Stable', defaultMeasurement: ORDINAL },
  ],
  cells,
  ...extra,
});

describe('compareCriteriaVersions', () => {
  it('orders dotted integers segment by segment, not as text', () => {
    expect(compareCriteriaVersions('2', '10')).toBe(-1);
    expect(compareCriteriaVersions('1.10', '1.9')).toBe(1);
    expect(compareCriteriaVersions('v2', '2.0')).toBe(0);
  });

  it('refuses to order what it cannot, rather than sorting alphabetically', () => {
    expect(compareCriteriaVersions('draft', 'final')).toBeUndefined();
    expect(compareCriteriaVersions('2026-08-01', '3')).toBeUndefined();
    expect(compareCriteriaVersions('draft', 'draft')).toBe(0);
  });
});

describe('supersededCells', () => {
  it('reports zero, not undefined, when nothing is superseded', () => {
    expect(supersededCells(build([]))).toEqual({ count: 0, cells: [], undetermined: [], unversioned: 0 });
  });

  it('counts a score given before its criterion last changed meaning', () => {
    const a = build([
      cell('x', 'moved', [assertion('old', { criteriaVersion: '1' })]),
      cell('y', 'moved', [assertion('new', { criteriaVersion: '2' })]),
    ]);
    const r = supersededCells(a);
    expect(r.count).toBe(1);
    expect(r.cells).toEqual([{
      alternativeId: 'x', criterionId: 'moved', measure: 'score', definedInVersion: '2',
      assertions: [{ id: 'old', criteriaVersion: '1' }],
    }]);
  });

  it('treats a later set version as current when this criterion did not move', () => {
    // The set is at 3; the criterion changed at 2. A score at 3 is current.
    const a = build([cell('x', 'moved', [assertion('s', { criteriaVersion: '3' })])]);
    expect(supersededCells(a).count).toBe(0);
  });

  it('never supersedes on a criterion that records no change of meaning', () => {
    const a = build([cell('x', 'stable', [assertion('s', { criteriaVersion: '1' })])]);
    expect(supersededCells(a).count).toBe(0);
  });

  it('counts a cell once, however many of its assertions are superseded', () => {
    const a = build([cell('x', 'moved', [
      assertion('s1', { criteriaVersion: '1' }),
      assertion('s2', { criteriaVersion: '1.5', authorId: 'ana' }),
    ])]);
    const r = supersededCells(a);
    expect(r.count).toBe(1);
    expect(r.cells[0]!.assertions.map((s) => s.id)).toEqual(['s1', 's2']);
  });

  it('reports unorderable versions as undetermined, not as superseded', () => {
    const criteria = [{ id: 'moved', label: 'M', defaultMeasurement: ORDINAL, definedInVersion: 'final' }];
    const a = build([cell('x', 'moved', [assertion('s', { criteriaVersion: 'draft' })])], criteria);
    const r = supersededCells(a);
    expect(r.count).toBe(0);
    expect(r.undetermined).toHaveLength(1);
    expect(r.undetermined[0]!.assertions).toEqual([{ id: 's', criteriaVersion: 'draft' }]);
  });

  it('counts unversioned assertions on a versioned criterion, separately', () => {
    const a = build([
      cell('x', 'moved', [assertion('s')]),
      cell('y', 'stable', [assertion('t')]),
    ]);
    const r = supersededCells(a);
    expect(r.count).toBe(0);
    expect(r.unversioned).toBe(1);
  });

  it('ignores superseded assertions and tombstoned rows and columns', () => {
    const a = build(
      [
        cell('x', 'moved', [
          assertion('old', { criteriaVersion: '1', supersededBy: 'new' }),
          assertion('new', { criteriaVersion: '2' }),
        ]),
        cell('y', 'moved', [assertion('gone', { criteriaVersion: '1' })]),
      ],
      undefined,
      { alternatives: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y', tombstoned: true }] },
    );
    expect(supersededCells(a).count).toBe(0);

    const tombstonedCriterion = build(
      [cell('x', 'moved', [assertion('s', { criteriaVersion: '1' })])],
      [{ id: 'moved', label: 'M', defaultMeasurement: ORDINAL, definedInVersion: '2', tombstoned: true }],
    );
    expect(supersededCells(tombstonedCriterion).count).toBe(0);
  });

  it('narrows to one measure when asked', () => {
    const a = build([
      cell('x', 'moved', [assertion('s', { criteriaVersion: '1' })], 'score'),
      cell('x', 'moved', [assertion('c', { criteriaVersion: '1' })], 'confidence'),
    ]);
    expect(supersededCells(a).count).toBe(2);
    expect(supersededCells(a, { measure: 'confidence' }).count).toBe(1);
  });
});
