/**
 * How one cell reads for an analysis that compares values: a point, a widened
 * interval, or a reason it cannot take part.
 *
 * Shared by `findNonDiscriminatingCriteria` and `pughTally` so the two agree
 * about what a blank means. The rules are dominance's (ADR-0019): a contingent
 * blank widens to the criterion's declared range, a structural absence (a
 * structural missingness code, or a declared inapplicable group pair) leaves the
 * comparison. Missingness is read through the vocabulary's flags, never by
 * comparing a literal code (ADR-0009, #44), so a deployment's own structural
 * code is honoured without this module knowing it exists.
 */
import type { Analysis } from '../schema/analysis.js';
import { reducedValue, vocabularyOf, cellIndex, cellKey } from '../schema/analysis.js';
import { makeInapplicability } from '../schema/groups.js';
import type { Measurement } from '../schema/measurement.js';
import { isWidenedByDisclosure, type ScalarValue } from '../schema/values.js';

export type Reading =
  /** An observed value. `numeric` carries it as a number when it is one. */
  | { kind: 'value'; value: ScalarValue; numeric?: number }
  /** A contingent blank: it could be anything in the declared range, if there is one. */
  | { kind: 'blank'; range?: { lo: number; hi: number } }
  /** The criterion does not apply here; the cell leaves the comparison. */
  | { kind: 'structural' };

/** A prepared reader over one analysis and one measure. */
export function makeReadings(a: Analysis, measure: string): (altId: string, critId: string, m: Measurement) => Reading {
  const inapplicable = makeInapplicability(a);
  const vocabulary = vocabularyOf(a);
  return (altId, critId, m) => {
    if (inapplicable(altId, critId)) return { kind: 'structural' };
    const r = reducedValue(a, altId, critId, measure);
    if (r?.value !== undefined) {
      return typeof r.value === 'number'
        ? { kind: 'value', value: r.value, numeric: r.value }
        : { kind: 'value', value: r.value };
    }
    if (r?.missing && vocabulary.resolve(r.missing.code, critId).facts?.structural) {
      return { kind: 'structural' };
    }
    // Contingently absent, refused, unresolvable or never asserted: unknown,
    // within the declared range if one is declared. The cautious direction --
    // an unreadable code must never silently leave the comparison.
    return m.range ? { kind: 'blank', range: { lo: m.range.min, hi: m.range.max } } : { kind: 'blank' };
  };
}

/** Cells in `alts x crits` for `measure` whose content a disclosure projection withheld (ADR-0021). */
export function widenedCells(
  a: Analysis, altIds: readonly string[], critIds: readonly string[], measure: string,
): number {
  if (!a.cells.some(isWidenedByDisclosure)) return 0;
  const index = cellIndex(a);
  let n = 0;
  for (const alt of altIds) {
    for (const crit of critIds) {
      const c = index.get(cellKey(alt, crit, measure));
      if (c && isWidenedByDisclosure(c)) n += 1;
    }
  }
  return n;
}

/** The criterion's declared indifference threshold; 0 (exact) when none is declared. */
export function indifferenceOf(m: Measurement): number {
  return m.thresholds?.indifference ?? 0;
}
