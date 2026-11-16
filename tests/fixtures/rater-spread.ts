/**
 * The relocation example with three independent raters on school quality (a five-level ordinal), their ratings spread
 * from unanimity to a split, for the encodings read over the disagreement index (`consensus-suppressed`, #258): it
 * hatches at more than one density in one column, which the examples alone do not (#369). Invented, like the example
 * it extends (ADR-0033).
 */
import { Analysis } from '../../src/core/schema/analysis.js';
import relocationJson from '../../examples/relocation.json';

/** Each alternative's three ratings (ana, ben, cleo) of school quality. */
const RATINGS: Record<string, readonly [number, number, number]> = {
  lisbon: [4, 4, 4],
  berlin: [4, 4, 3],
  montreal: [2, 4, 5],
  taipei: [1, 5, 1],
  seoul: [1, 3, 5],
};
const RATERS = ['ana', 'ben', 'cleo'] as const;

export function relocationWithRaterSpread(): Analysis {
  const json = structuredClone(relocationJson) as Record<string, any>;
  for (const cell of json['cells']) {
    const ratings = cell.criterionId === 'school-quality' ? RATINGS[cell.alternativeId] : undefined;
    if (!ratings) continue;
    cell.assertions = ratings.map((value, i) => ({
      id: `${cell.alternativeId}-school-${RATERS[i]}`, authorId: RATERS[i], at: '2026-08-22T09:00:00Z', value,
      justification: 'visited and compared the schools', evidence: [], version: 1, independence: 'independent',
    }));
  }
  return Analysis.parse(json);
}
