/**
 * `supersededBy` must name the assertion that replaced it, in the same cell,
 * and a chain of replacements must end (#165).
 *
 * Unchecked, a reference to nothing or a cycle leaves a cell with no live
 * assertion: it counts as outstanding although it holds assessments, and the
 * independence rule -- which needs two live assertions -- never fires on it.
 */
import { describe, it, expect } from 'vitest';

import { validateAnalysis } from '../src/core/schema/analysis.js';

const ORDINAL = { level: 'ordinal', preference: 'increasing', range: { min: 1, max: 5 }, levels: [1, 2, 3, 4, 5] };

const doc = (assertions: Record<string, unknown>[]) => ({
  id: 'a', subject: { question: 'q' }, authors: [{ id: 'ana', displayName: 'Ana', kind: 'human' }],
  alternatives: [{ id: 'x', label: 'X' }],
  criteria: [{ id: 'c', label: 'C', defaultMeasurement: ORDINAL }],
  cells: [{
    alternativeId: 'x', criterionId: 'c', measure: 'score',
    assertions: assertions.map((s) => ({ authorId: 'ana', at: '2026-08-22T00:00:00Z', value: 3, justification: 'j', ...s })),
  }],
});

const rules = (assertions: Record<string, unknown>[]) =>
  validateAnalysis(doc(assertions), { includeCompleteness: false }).problems.map((p) => p.ruleId);

describe('supersededBy resolves inside its cell', () => {
  it('accepts a chain that ends in a live assertion', () => {
    expect(rules([{ id: 's1', supersededBy: 's2' }, { id: 's2', supersededBy: 's3' }, { id: 's3' }])).toEqual([]);
  });

  it('refuses a reference to nothing, and to itself', () => {
    expect(rules([{ id: 's1', supersededBy: 'ghost' }, { id: 's2' }])).toEqual(['supersession-resolves']);
    expect(rules([{ id: 's1', supersededBy: 's1' }])).toEqual(['supersession-resolves']);
  });

  it('refuses the two-assertion case from the review: no independence, one superseded by a ghost', () => {
    const r = validateAnalysis(doc([{ id: 's1', supersededBy: 'ghost' }, { id: 's2' }]));
    expect(r.ok).toBe(false);
  });

  it('refuses a cycle, naming every assertion on it', () => {
    const r = validateAnalysis(doc([{ id: 's1', supersededBy: 's2' }, { id: 's2', supersededBy: 's1' }]));
    expect(r.ok).toBe(false);
    const cyc = r.problems.filter((p) => p.ruleId === 'supersession-acyclic');
    expect(cyc.map((p) => p.path)).toEqual(['cells[0].assertions[0].supersededBy', 'cells[0].assertions[1].supersededBy']);
  });

  it('reports a tail leading into a cycle once per assertion on the cycle, not on the tail', () => {
    const r = rules([{ id: 't', supersededBy: 's1' }, { id: 's1', supersededBy: 's2' }, { id: 's2', supersededBy: 's1' }]);
    expect(r).toEqual(['supersession-acyclic', 'supersession-acyclic']);
  });

  it('refuses a duplicate assertion id in a cell, which makes any reference to it ambiguous', () => {
    expect(rules([{ id: 's1' }, { id: 's1', independence: 'independent' }])).toContain('unique-ids');
  });
});

describe('a value the measurement does not admit', () => {
  it('is refused, unless it was scored against an earlier definition of the criterion', () => {
    expect(rules([{ id: 's1', value: 99 }])).toEqual(['value-admitted']);
    expect(rules([{ id: 's1', value: 'zz' }])).toEqual(['value-admitted']);
    const old = doc([{ id: 's1', value: 9, criteriaVersion: '1' }]);
    const versioned = {
      ...old, criteriaVersion: '2',
      criteria: [{ ...old.criteria[0]!, definedInVersion: '2' }],
    };
    expect(validateAnalysis(versioned, { includeCompleteness: false }).ok).toBe(true);
    const current = { ...versioned, cells: [{ ...old.cells[0]!, assertions: [{ ...old.cells[0]!.assertions[0]!, criteriaVersion: '2' }] }] };
    expect(validateAnalysis(current, { includeCompleteness: false }).problems.map((p) => p.ruleId)).toEqual(['value-admitted']);
  });
});
