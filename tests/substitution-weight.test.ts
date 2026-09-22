/**
 * A substitution weight without a declared range is a malformed document.
 *
 * ADR-0020: a substitution weight is a rate of exchange across a declared swing
 * (ADR-0018's `range`). Elicited or stored without one it is a bare statement of
 * importance, and a weighted sum computed from it is arbitrary -- silently, with
 * a plausible-looking ranking. The ADR makes this a boundary rule, not advice at
 * aggregation time, so `validateAnalysis` must refuse it (#50, #56).
 */
import { describe, it, expect } from 'vitest';
import { validateAnalysis } from '../src/core/schema/analysis.js';

const RULE = 'substitution-weight-needs-range';

const ORDINAL = {
  level: 'ordinal' as const, preference: 'increasing' as const,
  range: { min: 1, max: 5 }, levels: [1, 2, 3, 4, 5],
};
const NOMINAL = { level: 'nominal' as const, preference: 'none' as const, levels: ['a', 'b'] };

const doc = (criterion: Record<string, unknown>) => ({
  id: 'a1',
  schemaVersion: 1,
  subject: { question: 'which one?' },
  authors: [{ id: 'ana', displayName: 'Ana', kind: 'human' }],
  alternatives: [{ id: 'alt-1', label: 'A' }],
  criteria: [{ id: 'cost', label: 'Cost', ...criterion }],
  cells: [],
});

const ruleHits = (d: unknown) => validateAnalysis(d).problems.filter((p) => p.ruleId === RULE);

describe('substitution weight needs a declared range', () => {
  it('accepts a substitution weight on a ranged criterion', () => {
    const r = validateAnalysis(doc({ defaultMeasurement: ORDINAL, weights: { substitution: 0.4 } }));
    expect(r.problems.filter((p) => p.ruleId === RULE)).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('accepts a criterion with no weights at all, ranged or not', () => {
    // The rule is about the weight, not about the criterion: a nominal
    // criterion is perfectly valid until somebody tries to weigh it.
    expect(ruleHits(doc({ defaultMeasurement: NOMINAL }))).toEqual([]);
    expect(validateAnalysis(doc({ defaultMeasurement: NOMINAL })).ok).toBe(true);
  });

  it('accepts a voting weight on an unranged criterion', () => {
    // ADR-0020: voting power has no range dependency. Only `substitution` does.
    expect(ruleHits(doc({ defaultMeasurement: NOMINAL, weights: { voting: 2 } }))).toEqual([]);
  });

  it('rejects a substitution weight on a criterion with no range', () => {
    const r = validateAnalysis(doc({ defaultMeasurement: NOMINAL, weights: { substitution: 0.4 } }));
    expect(r.ok).toBe(false);
    const hits = r.problems.filter((p) => p.ruleId === RULE);
    expect(hits).toHaveLength(1);
    const p = hits[0]!;
    expect(p.severity).toBe('error');
    expect(p.path).toBe('criteria[0].weights.substitution');
    // The message names the reason, not just the rule.
    expect(p.message).toMatch(/range/);
    expect(p.message).toMatch(/ADR-0020/);
    expect(p.message).toContain('defaultMeasurement');
    expect(p.fix.length).toBeGreaterThan(20);
  });

  it('rejects a weight of zero too: the rule is about presence, not size', () => {
    // `if (weights.substitution)` would let 0 through; 0 is still a claim about
    // the exchange rate.
    expect(ruleHits(doc({ defaultMeasurement: NOMINAL, weights: { substitution: 0 } }))).toHaveLength(1);
  });

  it('names every unranged measurement when only some are ranged', () => {
    const hits = ruleHits(doc({
      measurements: { score: ORDINAL, kind: NOMINAL },
      weights: { substitution: 0.4 },
    }));
    expect(hits).toHaveLength(1);
    expect(hits[0]!.message).toContain('measurements.kind');
    expect(hits[0]!.message).not.toContain('measurements.score');
  });

  it('rejects a substitution weight on a criterion that declares no measurement', () => {
    const r = validateAnalysis(doc({ weights: { substitution: 0.4 } }));
    const hits = r.problems.filter((p) => p.ruleId === RULE);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.message).toMatch(/no measurement/);
    // Reported alongside, not instead of, the missing-measurement rule.
    expect(r.problems.some((p) => p.ruleId === 'criterion-has-a-measurement')).toBe(true);
  });

  it('cannot be silenced by turning completeness off', () => {
    const d = doc({ defaultMeasurement: NOMINAL, weights: { substitution: 0.4 } });
    expect(validateAnalysis(d, { includeCompleteness: false }).ok).toBe(false);
  });
});
