/**
 * "n cells cite contradicting evidence" (#65).
 *
 * The stance field exists so that contradicting evidence is countable rather
 * than folded into a citation total. These tests pin what counts: live
 * assertions only, live rows and columns only, one cell counted once however
 * many contradicting references it carries.
 */
import { describe, it, expect } from 'vitest';
import { Analysis, contradictedCells } from '../src/core/schema/analysis.js';

const ref = (id: string, stance: string) => ({
  id, target: `doc:${id}`, sourceType: 'primary', stance, derivedFrom: [],
  selectors: [{ type: 'TextQuoteSelector', exact: 'quoted' }],
});

const assertion = (id: string, evidence: unknown[], over: Record<string, unknown> = {}) => ({
  id, authorId: 'ana', at: '2026-08-22T00:00:00Z', value: 3, justification: 'because',
  evidence, ...over,
});

const cell = (alternativeId: string, criterionId: string, assertions: unknown[], measure = 'score') => ({
  alternativeId, criterionId, measure, assertions,
});

const build = (cells: unknown[], extra: Record<string, unknown> = {}) => Analysis.parse({
  id: 'a', subject: { question: 'q' },
  authors: [{ id: 'ana', displayName: 'Ana', kind: 'human' }],
  alternatives: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }],
  criteria: [
    { id: 'c1', label: 'C1', defaultMeasurement: { level: 'ordinal', preference: 'increasing', range: { min: 1, max: 5 } } },
    { id: 'c2', label: 'C2', defaultMeasurement: { level: 'ordinal', preference: 'increasing', range: { min: 1, max: 5 } } },
  ],
  cells,
  ...extra,
});

describe('contradictedCells', () => {
  it('reports zero, not undefined, when nothing contradicts', () => {
    const a = build([cell('x', 'c1', [assertion('s', [ref('e', 'supports')])])]);
    expect(contradictedCells(a)).toEqual({ count: 0, cells: [] });
  });

  it('counts a cell once, however many contradicting references it cites', () => {
    const a = build([
      cell('x', 'c1', [
        assertion('s1', [ref('e1', 'contradicts'), ref('e2', 'supports')]),
        assertion('s2', [ref('e3', 'contradicts')], { authorId: 'ana' }),
      ]),
      cell('y', 'c1', [assertion('s3', [ref('e4', 'qualifies'), ref('e5', 'context')])]),
    ]);
    const r = contradictedCells(a);
    expect(r.count).toBe(1);
    expect(r.cells[0]).toEqual({ alternativeId: 'x', criterionId: 'c1', measure: 'score', referenceIds: ['e1', 'e3'] });
  });

  it('ignores superseded assertions: they no longer speak for the cell', () => {
    const a = build([cell('x', 'c1', [
      assertion('old', [ref('e1', 'contradicts')], { supersededBy: 'new' }),
      assertion('new', [ref('e2', 'supports')]),
    ])]);
    expect(contradictedCells(a).count).toBe(0);
  });

  it('skips tombstoned alternatives and criteria', () => {
    const cells = [
      cell('x', 'c1', [assertion('s1', [ref('e1', 'contradicts')])]),
      cell('y', 'c2', [assertion('s2', [ref('e2', 'contradicts')])]),
    ];
    expect(contradictedCells(build(cells)).count).toBe(2);
    const a = build(cells, {
      alternatives: [{ id: 'x', label: 'X', tombstoned: true }, { id: 'y', label: 'Y' }],
      criteria: [
        { id: 'c1', label: 'C1', defaultMeasurement: { level: 'ordinal', preference: 'increasing', range: { min: 1, max: 5 } } },
        { id: 'c2', label: 'C2', tombstoned: true, defaultMeasurement: { level: 'ordinal', preference: 'increasing', range: { min: 1, max: 5 } } },
      ],
    });
    expect(contradictedCells(a).count).toBe(0);
  });

  it('counts a qualified absence that cites contradicting evidence', () => {
    // The contradiction is about the evidence, not about whether a value was
    // given: "not-evidenced, and here is the source that says otherwise" is
    // exactly the cell a reader needs to find.
    const a = build([cell('x', 'c1', [
      assertion('s', [ref('e', 'contradicts')], { value: undefined, missing: { code: 'indeterminate' } }),
    ])]);
    expect(contradictedCells(a).count).toBe(1);
  });

  it('narrows to one measure when asked', () => {
    const a = build([
      cell('x', 'c1', [assertion('s1', [ref('e1', 'contradicts')])], 'score'),
      cell('x', 'c1', [assertion('s2', [ref('e2', 'contradicts')])], 'confidence'),
    ]);
    expect(contradictedCells(a).count).toBe(2);
    expect(contradictedCells(a, { measure: 'confidence' }).cells.map((c) => c.measure)).toEqual(['confidence']);
  });
});
