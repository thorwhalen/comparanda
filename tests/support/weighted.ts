/**
 * An example analysis with substitution weights declared (ADR-0020), for the
 * views gated behind the weighted-aggregation opt-in (#98). The shipped examples
 * declare none, by design: aggregation is never a default (ADR-0015).
 *
 * The weights go on every criterion the weighted sum can place -- a direction
 * of preference, a declared range, numeric levels -- so the nominal criteria
 * stay out of the sum, as they would for an author.
 */
import type { Analysis } from '../../src/core/schema/analysis.js';
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
