/**
 * The relocation example with three independent raters on school quality (a five-level ordinal), their ratings spread
 * from unanimity to a split, for the encodings read over the disagreement index (`consensus-suppressed`, #258): it
 * hatches at more than one density in one column, which the examples alone do not (#369). Invented, like the example
 * it extends (ADR-0033).
 */
import { Analysis, reducedValue } from '../../src/core/schema/analysis.js';
import relocationJson from '../../examples/relocation.json';

/** Each alternative's ratings (by ana, ben, cleo, in that order) of school quality. */
const RATINGS: Record<string, readonly number[]> = {
  lisbon: [4, 4, 4],
  berlin: [4, 4, 3],
  montreal: [2, 4, 5],
  // Two raters at opposite ends: an index of exactly 1, the root layer with no rounding margin to lose.
  taipei: [1, 5],
  seoul: [1, 3, 5],
};
const RATERS = ['ana', 'ben', 'cleo'] as const;

export function relocationWithRaterSpread(): Analysis {
  const json = structuredClone(relocationJson) as Record<string, any>;
  for (const cell of json['cells']) {
    const ratings = cell.criterionId === 'school-quality' ? RATINGS[cell.alternativeId] : undefined;
    if (!ratings) continue;
    // The example's own `reduction: "mode"` would leave a three-way split with no value, and so no hatch.
    delete cell.reduction;
    cell.assertions = ratings.map((value, i) => ({
      id: `${cell.alternativeId}-school-${RATERS[i]}`, authorId: RATERS[i], at: '2026-08-22T09:00:00Z', value,
      justification: 'visited and compared the schools', evidence: [], version: 1, independence: 'independent',
    }));
  }
  const analysis = Analysis.parse(json);
  // Every rated cell reduces to a value, or its hatch is silently not drawn.
  for (const alt of Object.keys(RATINGS)) {
    if (reducedValue(analysis, alt, 'school-quality', 'score')?.value === undefined) throw new Error(`rater-spread: ${alt} has no reduced value`);
  }
  return analysis;
}
