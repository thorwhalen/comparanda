/**
 * Two open vocabularies, and the property that makes each one worth having.
 *
 * **Scales:** a criterion whose natural measure is money must work with no
 * change to `meanIsLegal`, `admitsDominance`, `atLeastAsGood` or
 * `validateMeasurement`. If it does not, the "scale seam" is an interface over
 * data the document already carries, and the seam is costing more than it buys.
 *
 * **Reductions:** an extension this build cannot run must produce **nothing**,
 * not its parent's number. That is where reductions deliberately depart from how
 * missingness degrades, and the test that pins it is the one below about a
 * trimmed mean.
 */
import { describe, it, expect } from 'vitest';
import {
  meanIsLegal, admitsDominance, atLeastAsGood, validateMeasurement,
  anchorProblems, canonicalAnchorJson,
  type Measurement, type AnchorSet,
} from '../src/core/schema/measurement.js';
import {
  reduce, resolveReduction, CORE_REDUCTIONS,
  type Cell, type Assertion, type ReductionDeclaration,
} from '../src/core/schema/values.js';
import type { Degradation } from '../src/core/schema/declarations.js';

const assertion = (id: string, value: number, at = '2026-08-22T00:00:00Z'): Assertion => ({
  id, authorId: 'a1', at, value, evidence: [], version: 1,
});

const cell = (values: number[], reduction?: string): Cell => ({
  alternativeId: 'alt', criterionId: 'crit', measure: 'score',
  assertions: values.map((v, i) => assertion(`s${i}`, v)),
  ...(reduction ? { reduction } : {}),
});

// ---------------------------------------------------------------- scales

describe('a money criterion needs no new code', () => {
  const money: Measurement = {
    level: 'ratio',
    preference: 'decreasing',
    range: { min: 0, max: 1_000_000, unit: 'USD' },
  };

  it('validates with zero problems', () => {
    expect(validateMeasurement(money)).toEqual([]);
  });

  it('admits a mean, unlike the 1-5 ordinal default', () => {
    expect(meanIsLegal(money.level)).toBe(true);
    expect(meanIsLegal('ordinal')).toBe(false);
  });

  it('orients correctly without anyone teaching it that cheaper is better', () => {
    expect(admitsDominance(money.preference)).toBe(true);
    expect(atLeastAsGood(money, 200, 900)).toBe(true);
    expect(atLeastAsGood(money, 900, 200)).toBe(false);
  });

  it('carries no scale name, and that is the correct absence', () => {
    // An absent `scale` means "Stevens, as declared by level/preference/range".
    // If the field defaulted to the ordinal preset, this measurement would be
    // silently stamped 1-5 and 4200 would become an invalid value.
    expect(money.scale).toBeUndefined();
    expect(validateMeasurement({ ...money, scale: 'ratio-currency' })).toEqual([]);
  });
});

describe('anchors are checked from the document alone', () => {
  const anchors = (levels: Record<string, string>, requires: string[]): AnchorSet => ({
    levels, contentHash: 'sha256:test', requires,
  });

  it('rejects a set that omits a level its own scale requires', () => {
    // No preset table is consulted here. The requirement travels inside the
    // document, so a build that has never heard of this scale still catches it.
    const problems = anchorProblems(
      anchors({ '1': 'no source states a commitment', '3': 'an intention is stated' }, ['1', '3', '5']),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]!.path).toBe('anchors.levels.5');
    expect(problems[0]!.message).toContain('scored against taste');
  });

  it('rejects an empty anchor more loudly than a missing one', () => {
    const problems = anchorProblems(anchors({ '1': '   ' }, ['1']));
    expect(problems[0]!.message).toContain('reads as satisfied');
  });

  it('accepts a set that satisfies what it declares, whatever the levels are', () => {
    // Three levels, not five. The scale said what it needed and it is met.
    expect(anchorProblems(anchors({ lo: 'a', hi: 'b' }, ['lo', 'hi']))).toEqual([]);
  });

  it('hashes over bytes both languages can agree on', () => {
    // Key order must not change the hash input, or two producers of the same
    // anchor set disagree about whether the text moved.
    expect(canonicalAnchorJson({ '3': 'c', '1': 'a' })).toBe(canonicalAnchorJson({ '1': 'a', '3': 'c' }));
    expect(canonicalAnchorJson({ '1': 'a' })).not.toContain(' ');
  });

  it('refuses anchors on a level that has none to describe', () => {
    const problems = validateMeasurement({
      level: 'ratio', preference: 'decreasing', range: { min: 0, max: 10 },
      anchors: anchors({ '1': 'x' }, ['1']),
    });
    expect(problems.some((p) => p.message.includes('ordinal'))).toBe(true);
  });
});

// ---------------------------------------------------------------- reductions

describe('reductions resolve like any other open vocabulary', () => {
  it('resolves the six core members as core', () => {
    for (const id of Object.keys(CORE_REDUCTIONS)) {
      expect(resolveReduction(id).source).toBe('core');
    }
  });

  it('degrades a declared extension, because v1 implements none', () => {
    const decls: ReductionDeclaration[] = [
      { id: 'trimmed-mean', broader: 'mean', means: 'Mean after dropping the extremes.', params: {} },
    ];
    const r = resolveReduction('trimmed-mean', decls);
    expect(r).toMatchObject({ known: false, source: 'degraded', broader: 'mean' });
  });
});

describe('a reduction this build cannot run shows nothing, not its parent', () => {
  const decls: ReductionDeclaration[] = [
    { id: 'trimmed-mean', broader: 'mean', means: 'Mean after dropping the extremes.', params: {} },
  ];

  it('refuses rather than computing the parent', () => {
    const r = reduce(cell([1, 2, 3, 100], 'trimmed-mean'), {
      defaultReduction: 'single', level: 'ratio', reductions: decls,
    });
    expect(r.value).toBeUndefined();
    expect(r.refused).toContain('cannot compute the reduction "trimmed-mean"');
    // The parent's answer is 26.5. A trimmed mean is 2.5. Showing 26.5 under the
    // author's label is the "plausible number instead of an honest blank" this
    // package exists to refuse -- so the refusal names it explicitly.
    expect(r.refused).toContain('different number');
    expect(r.value).not.toBe(26.5);
  });

  it('reports the degradation with the cell it happened in', () => {
    const degradations: Degradation[] = [];
    reduce(cell([1, 2], 'trimmed-mean'), {
      defaultReduction: 'single', level: 'ratio', reductions: decls, degradations,
    });
    expect(degradations).toEqual([
      {
        axis: 'reduction',
        id: 'trimmed-mean',
        broader: 'mean',
        at: 'cells.alt/crit.reduction',
        because: 'Mean after dropping the extremes.',
      },
    ]);
  });

  it('distinguishes an undeclared name from a declared-but-unimplemented one', () => {
    const r = reduce(cell([1, 2], 'invented'), { defaultReduction: 'single', level: 'ratio' });
    expect(r.refused).toContain('unknown reduction "invented"');
    expect(r.refused).not.toContain('different number');
  });
});

describe('the arithmetic rule is a fact about the reduction, not a case for mean', () => {
  it('still refuses a mean on ordinal', () => {
    const r = reduce(cell([2, 5], 'mean'), { defaultReduction: 'single', level: 'ordinal' });
    expect(r.value).toBeUndefined();
    expect(r.refused).toContain('no rater could have chosen');
  });

  it('allows it on ratio', () => {
    const r = reduce(cell([200, 400], 'mean'), { defaultReduction: 'single', level: 'ratio' });
    expect(r.value).toBe(300);
  });

  it('marks exactly one core reduction as able to invent a value', () => {
    // lower-median exists precisely so that the ordinal case has a reduction
    // that cannot. If a second core member ever becomes arithmetic, that is a
    // decision, and this assertion is where it gets noticed.
    const arithmetic = Object.entries(CORE_REDUCTIONS).filter(([, f]) => f.arithmetic).map(([k]) => k);
    expect(arithmetic).toEqual(['mean']);
  });

  it('lets lower-median run on ordinal, returning a level a rater chose', () => {
    const r = reduce(cell([2, 3, 4, 5], 'lower-median'), { defaultReduction: 'single', level: 'ordinal' });
    expect(r.value).toBe(3);
    expect([2, 3, 4, 5]).toContain(r.value);
  });
});
