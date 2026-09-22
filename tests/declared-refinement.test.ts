/**
 * "Could not discriminate" is a declared refinement of `indeterminate`, not a
 * new core code (#67, ADR-0022 as amended 2026-09-22, ADR-0030).
 *
 * The companion repo's pairwise escalation rule needs a code for "we compared
 * these two directly and could not tell them apart on this criterion". It is a
 * different finding from "we looked and could not determine a level", and the
 * extension mechanism carries it without a schema change: declared with
 * `broader: "indeterminate"`, it inherits the flags #67 asks for and lands in
 * the right completeness bucket, with no consumer knowing its id.
 */
import { describe, it, expect } from 'vitest';
import {
  Analysis, completeness, validateAnalysis, vocabularyOf,
} from '../src/core/schema/analysis.js';
import { CORE_MISSING_CODES } from '../src/core/schema/missingness.js';

const CODE = 'insufficient-evidence-to-discriminate';
const DECLARATION = {
  id: CODE,
  broader: 'indeterminate',
  means: 'Compared directly with another alternative on this criterion; the evidence did not separate them.',
};

const ORDINAL = { level: 'ordinal', preference: 'increasing', range: { min: 1, max: 5 }, levels: [1, 2, 3, 4, 5] };

const doc = (codes: string[]) => ({
  id: 'd', subject: { question: 'which one?' },
  authors: [{ id: 'agent', displayName: 'agent run', kind: 'agent' }],
  alternatives: codes.map((_, i) => ({ id: `a${i}`, label: `A${i}` })),
  criteria: [{ id: 'c', label: 'C', defaultMeasurement: ORDINAL }],
  missingCodes: [DECLARATION],
  cells: codes.map((code, i) => ({
    alternativeId: `a${i}`, criterionId: 'c', measure: 'score',
    assertions: [{ id: `s${i}`, authorId: 'agent', at: '2026-09-22T00:00:00Z', version: 1, evidence: [], missing: { code } }],
  })),
});

describe('insufficient-evidence-to-discriminate, as a declared refinement', () => {
  it('is not a core code, and does not need to be', () => {
    expect(Object.keys(CORE_MISSING_CODES)).not.toContain(CODE);
    const r = validateAnalysis(doc([CODE]));
    expect(r.problems.filter((p) => p.severity === 'error')).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('inherits the flags #67 asks for from its broader parent', () => {
    const a = Analysis.parse(doc([CODE]));
    const resolved = vocabularyOf(a).resolve(CODE, 'c');
    expect(resolved.facts).toMatchObject({ structural: false, terminal: true, informative: true });
    expect(resolved.source).not.toBe('undeclared');
  });

  it('counts in the same completeness bucket as its parent', () => {
    const child = completeness(Analysis.parse(doc([CODE])), { measure: 'score' });
    const parent = completeness(Analysis.parse(doc(['indeterminate'])), { measure: 'score' });
    for (const k of ['settledAbsent', 'informativeAbsent', 'outstanding', 'structural', 'silenceRate', 'examinedRate'] as const) {
      expect(child[k], k).toBe(parent[k]);
    }
    expect(child.settledAbsent).toBe(1);
    expect(child.informativeAbsent).toBe(1);
  });

  it('is outstanding work, not settled, if a document uses it without declaring it', () => {
    // The safe direction: an unreadable blank is over-reported as work left.
    const undeclared = { ...doc([CODE]), missingCodes: [] };
    const c = completeness(Analysis.parse(undeclared), { measure: 'score' });
    expect(c.outstanding).toBe(1);
    expect(validateAnalysis(undeclared).ok).toBe(false);
  });
});
