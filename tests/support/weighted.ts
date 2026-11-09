/**
 * An example analysis with substitution weights declared (ADR-0020), for the
 * views gated behind the weighted-aggregation opt-in (#98). The shipped examples
 * declare none, by design: aggregation is never a default (ADR-0015).
 *
 * The weights go on every criterion the weighted sum can place -- a direction
 * of preference, a declared range, numeric levels -- so the nominal criteria
 * stay out of the sum, as they would for an author.
 */
import { Analysis } from '../../src/core/schema/analysis.js';
import { measurementFor } from '../../src/core/schema/structure.js';

/** The relocation example's weights: rent counts double. Invented, like the example. */
export const RELOCATION_WEIGHTS: Readonly<Record<string, number>> = Object.freeze({
  rent: 2, 'income-tax': 1, 'winter-daylight': 1, 'flight-hours': 1, 'school-quality': 1, 'eu-residency-path': 1,
});

/** `a` with `weights` as its criteria's substitution weights; a criterion not named keeps what it had. */
export function weighted(a: Analysis, weights: Readonly<Record<string, number>> = RELOCATION_WEIGHTS, measure = 'score'): Analysis {
  return {
    ...a,
    criteria: a.criteria.map((c) => {
      const w = weights[c.id];
      if (w === undefined) return c;
      if (!measurementFor(c, measure)?.range) throw new Error(`"${c.id}" declares no range, so the weighted sum would refuse it`);
      return { ...c, weights: { ...c.weights, substitution: w } };
    }),
  };
}

/**
 * Three benches on two weighted criteria, every cell a value, so every score is a point. Its first order change is a
 * pass: lower the weight on grip below 2/3 and pine passes oak. Steel is far below both. Invented (ADR-0033).
 */
export function reversal(): Analysis {
  const values: Record<string, [number, number]> = { oak: [90, 50], pine: [60, 30], steel: [20, 80] };
  return Analysis.parse({
    id: 'benches', subject: { question: 'Which bench for the park?' }, authors: [{ id: 'p', displayName: 'Parks team', kind: 'human' }],
    alternatives: Object.keys(values).map((id) => ({ id, label: id.charAt(0).toUpperCase() + id.slice(1) })),
    criteria: [
      { id: 'grip', label: 'Grip', defaultMeasurement: { level: 'ratio', preference: 'increasing', range: { min: 0, max: 100 } }, weights: { substitution: 1 } },
      { id: 'cost', label: 'Cost', defaultMeasurement: { level: 'ratio', preference: 'decreasing', range: { min: 0, max: 100 } }, weights: { substitution: 1 } },
    ],
    cells: Object.entries(values).flatMap(([alt, vs]) => ['grip', 'cost'].map((crit, j) => ({
      alternativeId: alt, criterionId: crit, measure: 'score',
      assertions: [{ id: `${alt}-${crit}`, authorId: 'p', at: '2026-01-01T00:00:00Z', version: 1, evidence: [], value: vs[j], justification: 'measured' }],
    }))),
  });
}
