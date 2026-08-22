/**
 * Criterion-scoped vocabularies, the structural constraint, and the two
 * degradation directions.
 *
 * The three properties worth pinning:
 *
 *   1. A criterion's overlay wins for that criterion **and nowhere else**. Get
 *      this wrong in the safe-looking direction -- pass the analysis-level list
 *      everywhere -- and an overlay code silently reads as undeclared, which
 *      counts a deliberate, defined blank as outstanding work.
 *   2. `structural: true` may only refine `not-applicable`. Structural absence
 *      leaves every denominator and every comparison, so a code claiming it
 *      while refining `withheld` would quietly remove cells somebody chose not
 *      to show.
 *   3. **A scale degrades; a reduction refuses.** Both are extension points on
 *      one document and they behave oppositely on purpose, so the difference is
 *      asserted rather than left to be inferred from two modules.
 */
import { describe, it, expect } from 'vitest';
import {
  Analysis, validateAnalysis, vocabularyOf, completeness, scaleDegradations,
} from '../src/core/schema/analysis.js';
import { resolveScale } from '../src/core/schema/measurement.js';

const AUTHOR = { id: 'ana', displayName: 'Ana', kind: 'human' as const };

const ORDINAL = {
  level: 'ordinal' as const, preference: 'increasing' as const,
  range: { min: 1, max: 5 }, levels: [1, 2, 3, 4, 5],
};

const NO_FILING = {
  id: 'no-public-filing',
  broader: 'not-evidenced' as const,
  means: 'No public filing exists for this.',
};

const doc = (over: Record<string, unknown> = {}) => ({
  id: 'a1', schemaVersion: 1, subject: { question: 'q' },
  authors: [AUTHOR],
  alternatives: [{ id: 'alt-1', label: 'A' }],
  criteria: [
    { id: 'governance', label: 'Governance', defaultMeasurement: ORDINAL, missingCodes: [NO_FILING] },
    { id: 'latency', label: 'Latency', defaultMeasurement: ORDINAL },
  ],
  cells: [],
  ...over,
});

const blankCell = (criterionId: string, code: string) => ({
  alternativeId: 'alt-1', criterionId, measure: 'score',
  assertions: [{
    id: `s-${criterionId}`, authorId: 'ana', at: '2026-08-22T00:00:00Z',
    missing: { code }, evidence: [], version: 1,
  }],
});

describe('a criterion overlay is in force for that criterion only', () => {
  const a = Analysis.parse(doc());
  const vocab = vocabularyOf(a);

  it('resolves an overlay code on its own criterion', () => {
    const r = vocab.resolve('no-public-filing', 'governance');
    expect(r.known).toBe(true);
    expect(r.facts?.informative).toBe(true);
    expect(vocab.means('no-public-filing', 'governance')).toBe(NO_FILING.means);
  });

  it('does not resolve it on another criterion', () => {
    // The narrowing is the feature. If every column carried every other
    // column's vocabulary, the overlay would buy nothing.
    expect(vocab.resolve('no-public-filing', 'latency').source).toBe('undeclared');
  });

  it('does not resolve it at analysis scope', () => {
    expect(vocab.resolve('no-public-filing').source).toBe('undeclared');
  });

  it('still resolves core codes everywhere', () => {
    for (const criterionId of ['governance', 'latency', undefined]) {
      expect(vocab.resolve('withheld', criterionId).source).toBe('core');
    }
  });
});

describe('validation and completeness honour the overlay', () => {
  const a = Analysis.parse(doc({ cells: [blankCell('governance', 'no-public-filing')] }));

  it('accepts an overlay code used on its own criterion', () => {
    const r = validateAnalysis(a);
    expect(r.problems.filter((p) => p.ruleId === 'blank-is-defined')).toHaveLength(0);
    expect(r.ok).toBe(true);
  });

  it('rejects the same code used on a criterion that does not declare it', () => {
    const wrong = Analysis.parse(doc({ cells: [blankCell('latency', 'no-public-filing')] }));
    const r = validateAnalysis(wrong);
    expect(r.ok).toBe(false);
    expect(r.problems.some((p) => p.ruleId === 'blank-is-defined')).toBe(true);
  });

  it('counts an overlay code as settled, not as outstanding', () => {
    // The failure this guards: resolving with the analysis-level list only
    // makes the code undeclared, which the tally counts as outstanding -- a
    // deliberate, defined blank reported as work nobody has done.
    const c = completeness(a, { measure: 'score', criterionIds: ['governance'] });
    expect(c.outstanding).toBe(0);
    expect(c.settledAbsent).toBe(1);
    expect(c.informativeAbsent).toBe(1);
  });
});

describe('structural may only refine not-applicable', () => {
  it('rejects a structural code refining something else', () => {
    const bad = doc({
      missingCodes: [{ id: 'out-of-scope', broader: 'withheld', means: 'x', structural: true }],
    });
    const r = validateAnalysis(bad);
    expect(r.ok).toBe(false);
    const p = r.problems.find((x) => x.ruleId === 'structural-refines-not-applicable');
    expect(p).toBeDefined();
    expect(p!.message).toContain('leaves every denominator');
    expect(p!.fix).toContain('not-applicable');
  });

  it('accepts a structural code refining not-applicable', () => {
    const ok = doc({
      missingCodes: [{
        id: 'not-in-this-market', broader: 'not-applicable', means: 'x', structural: true,
      }],
    });
    expect(validateAnalysis(ok).ok).toBe(true);
  });

  it('accepts a non-structural code refining anything', () => {
    expect(validateAnalysis(doc({ missingCodes: [NO_FILING] })).ok).toBe(true);
  });

  it('applies to criterion overlays too', () => {
    const bad = doc({
      criteria: [{
        id: 'governance', label: 'G', defaultMeasurement: ORDINAL,
        missingCodes: [{ id: 'x', broader: 'deferred', means: 'y', structural: true }],
      }],
    });
    expect(validateAnalysis(bad).problems.some(
      (p) => p.ruleId === 'structural-refines-not-applicable',
    )).toBe(true);
  });
});

describe('a scale degrades where a reduction refuses', () => {
  it('resolves the core family and any declared scale', () => {
    expect(resolveScale('stevens').source).toBe('core');
    expect(resolveScale('bounded-ratio-usd', [
      { id: 'bounded-ratio-usd', broader: 'stevens', means: 'US dollars, 0 to 1M.', params: {} },
    ]).source).toBe('declared');
  });

  it('degrades an undeclared scale name and names where it was used', () => {
    const a = Analysis.parse(doc({
      criteria: [{
        id: 'cost', label: 'Cost',
        defaultMeasurement: { ...ORDINAL, scale: 'bt-latent' },
      }],
    }));
    const ds = scaleDegradations(a);
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ axis: 'scale', id: 'bt-latent' });
    expect(ds[0]!.at).toBe('criteria[0].defaultMeasurement.scale');
  });

  it('reports nothing for a declared scale', () => {
    const a = Analysis.parse(doc({
      scales: [{ id: 'bounded-ratio-usd', broader: 'stevens', means: 'US dollars.' }],
      criteria: [{
        id: 'cost', label: 'Cost',
        defaultMeasurement: { ...ORDINAL, scale: 'bounded-ratio-usd' },
      }],
    }));
    expect(scaleDegradations(a)).toEqual([]);
  });

  it('lets an unknown scale keep validating, because behaviour is on the measurement', () => {
    // The asymmetry, stated as an assertion: an unknown scale costs the name
    // and not the behaviour, so the document is still valid. An unknown
    // reduction costs a number, so it is refused instead.
    const a = Analysis.parse(doc({
      criteria: [{
        id: 'cost', label: 'Cost',
        defaultMeasurement: { ...ORDINAL, scale: 'bt-latent' },
      }],
    }));
    expect(validateAnalysis(a).ok).toBe(true);
    expect(scaleDegradations(a)).toHaveLength(1);
  });
});
