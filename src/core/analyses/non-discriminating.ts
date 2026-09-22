/**
 * Criteria that are doing no work: every alternative in scope lands in the same
 * place (#86, ADR-0015 sub-amendment f).
 *
 * A non-discriminating criterion is a finding about the criteria set -- a prompt
 * to sharpen it or drop it. This analysis **proposes and never writes**: it
 * returns ids and reasons, and removing a criterion stays a decision somebody
 * makes and records.
 *
 * Two rules keep it honest:
 *
 * - **The tolerance is the criterion's declared `indifference`**, per
 *   (criterion, measure). With none declared it is 0: exact equality, never a
 *   hardcoded epsilon.
 * - **A blank never makes a column look uniform.** A contingent blank could be
 *   anything in the declared range, so a column whose known values agree but
 *   which still has blanks is `undetermined`, with the count -- unless the
 *   declared range itself is narrower than the tolerance, in which case no
 *   resolution of the blanks could discriminate. Structural absences leave the
 *   column (the criterion does not apply there) and are counted.
 */
import type { Analysis } from '../schema/analysis.js';
import { measurementFor } from '../schema/structure.js';
import { isOrdered } from '../schema/measurement.js';
import { indifferenceOf, makeReadings, widenedCells } from './readings.js';
import type { AnalysisResult } from './registry.js';

/** What every result of this analysis rests on, carried with it (#87, ADR-0015). */
export const NON_DISCRIMINATING_ASSUMPTIONS: readonly string[] = Object.freeze([
  "A criterion does no work when every compared alternative lies within its declared indifference threshold (exact equality when none is declared).",
  "A blank could be anything in the declared range, so a column with blanks is undetermined unless the range itself is narrower than the threshold.",
  "This proposes; it never removes a criterion.",
]);

export interface NonDiscriminatingOptions {
  measure: string;
  alternativeIds?: readonly string[];
  criterionIds?: readonly string[];
}

export type DiscriminationStatus =
  /** Every compared alternative is within the tolerance: the column does no work. */
  | 'non-discriminating'
  /** The known values already differ beyond the tolerance. */
  | 'discriminating'
  /** Uniform so far, but blanks could still separate the alternatives. */
  | 'undetermined'
  /** Fewer than two alternatives take part, so there is nothing to discriminate between. */
  | 'too-few-compared'
  /** No measurement is declared for this (criterion, measure). */
  | 'no-measurement';

export interface CriterionDiscrimination {
  criterionId: string;
  status: DiscriminationStatus;
  /** The tolerance used: the declared `indifference`, or 0. */
  tolerance: number;
  /** Alternatives with an observed value. */
  valued: number;
  /** Contingent blanks among the alternatives in scope. */
  blanks: number;
  /** Alternatives for which the criterion does not apply, and which left the column. */
  structural: number;
  /** Max minus min of the numeric values observed, when there are any. */
  spread?: number;
  reason: string;
}

export interface NonDiscriminatingResult extends AnalysisResult {
  /** Criteria proposed as doing no work. A proposal: nothing has been removed. */
  proposed: string[];
  criteria: CriterionDiscrimination[];
  /** Cells in scope whose content was withheld from this reader (ADR-0021). */
  widenedByDisclosure: number;
  notes: string[];
}

export function findNonDiscriminatingCriteria(a: Analysis, opts: NonDiscriminatingOptions): NonDiscriminatingResult {
  const altIds = (opts.alternativeIds ?? a.alternatives.filter((x) => !x.tombstoned).map((x) => x.id)).slice();
  const critIds = (opts.criterionIds ?? a.criteria.filter((x) => !x.tombstoned).map((x) => x.id)).slice();
  const read = makeReadings(a, opts.measure);
  const criteria: CriterionDiscrimination[] = [];

  for (const cid of critIds) {
    const crit = a.criteria.find((c) => c.id === cid);
    const m = crit ? measurementFor(crit, opts.measure) : undefined;
    if (!m) {
      criteria.push({
        criterionId: cid, status: 'no-measurement', tolerance: 0, valued: 0, blanks: 0, structural: 0,
        reason: `no measurement is declared for "${opts.measure}", so nothing can be compared`,
      });
      continue;
    }
    // A tolerance only means something along an order. On a nominal level the
    // only indifference is identity.
    const tolerance = isOrdered(m.level) ? indifferenceOf(m) : 0;
    const values: (string | number | boolean)[] = [];
    const numbers: number[] = [];
    let blanks = 0;
    let structural = 0;
    let blankRange: { lo: number; hi: number } | undefined;
    let unboundedBlank = false;
    for (const alt of altIds) {
      const r = read(alt, cid, m);
      if (r.kind === 'structural') structural += 1;
      else if (r.kind === 'blank') {
        blanks += 1;
        if (r.range) blankRange = r.range; else unboundedBlank = true;
      } else {
        values.push(r.value);
        if (r.numeric !== undefined) numbers.push(r.numeric);
      }
    }

    const allNumeric = numbers.length === values.length;
    const spread = numbers.length > 0 ? Math.max(...numbers) - Math.min(...numbers) : undefined;
    const knownUniform = allNumeric
      ? (spread ?? 0) <= tolerance
      : new Set(values.map((v) => JSON.stringify(v))).size <= 1;
    const base = { criterionId: cid, tolerance, valued: values.length, blanks, structural, ...(spread !== undefined ? { spread } : {}) };
    const tol = tolerance === 0 ? 'identical' : `within the declared indifference of ${tolerance}`;

    if (values.length + blanks < 2) {
      criteria.push({ ...base, status: 'too-few-compared', reason: `only ${values.length + blanks} alternative(s) take part` });
    } else if (!knownUniform) {
      criteria.push({
        ...base, status: 'discriminating',
        reason: allNumeric ? `observed values differ by ${spread}, beyond ${tolerance}` : 'observed values differ',
      });
    } else if (blanks === 0) {
      criteria.push({ ...base, status: 'non-discriminating', reason: `all ${values.length} observed values are ${tol}` });
    } else {
      // Blanks could still separate the column -- unless the whole declared
      // range fits inside the tolerance, so no resolution of them could.
      const rangeCannotDiscriminate = !unboundedBlank && blankRange !== undefined && allNumeric &&
        Math.max(blankRange.hi, ...numbers) - Math.min(blankRange.lo, ...numbers) <= tolerance;
      criteria.push(rangeCannotDiscriminate
        ? {
          ...base, status: 'non-discriminating',
          reason: `observed values are ${tol}, and the declared range is too narrow for the ${blanks} blank(s) to differ`,
        }
        : {
          ...base, status: 'undetermined',
          reason: `undetermined because of ${blanks} blank(s): the ${values.length} observed value(s) are ${tol}, ` +
            'but a blank could be anywhere in the declared range',
        });
    }
  }

  const proposed = criteria.filter((c) => c.status === 'non-discriminating').map((c) => c.criterionId);
  const notes: string[] = [];
  if (proposed.length > 0) {
    notes.push(
      `${proposed.length} criteri${proposed.length === 1 ? 'on does' : 'a do'} not separate the alternatives in scope. ` +
      'A proposal to sharpen or drop, not a change: nothing has been removed.',
    );
  }
  const undetermined = criteria.filter((c) => c.status === 'undetermined').length;
  if (undetermined > 0) {
    notes.push(`${undetermined} criteri${undetermined === 1 ? 'on looks' : 'a look'} uniform only because of blanks; fill them before deciding.`);
  }
  const widenedByDisclosure = widenedCells(a, altIds, critIds, opts.measure);
  if (widenedByDisclosure > 0) {
    notes.push(`${widenedByDisclosure} cell(s) in scope are withheld from you and were read as blanks.`);
  }
  return { assumptions: NON_DISCRIMINATING_ASSUMPTIONS, proposed, criteria, widenedByDisclosure, notes };
}
