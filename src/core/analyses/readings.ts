/**
 * How one cell reads for an analysis that compares values: a point, a widened
 * interval, or a reason it cannot take part.
 *
 * Shared by `findNonDiscriminatingCriteria` and `pughTally` so the two agree
 * about what a blank means, and, placed on a criterion's range (`makePlacements`), by
 * the weighted sum, its sensitivity and `rankShare`. The rules are dominance's (ADR-0019): a contingent
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
import { measurementFor } from '../schema/structure.js';
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

/** Cells in `alts x crits` for `measure` that a disclosure projection left without a value (ADR-0021). */
export function widenedCells(
  a: Analysis, altIds: readonly string[], critIds: readonly string[], measure: string,
): number {
  if (!a.cells.some(isWidenedByDisclosure)) return 0;
  const index = cellIndex(a);
  let n = 0;
  for (const alt of altIds) {
    for (const crit of critIds) {
      const c = index.get(cellKey(alt, crit, measure));
      // Only where the withholding left the cell without a value: a value core
      // can still prove (an owner's consensus, a `latest`) was not read as a blank.
      if (c && isWidenedByDisclosure(c) && reducedValue(a, alt, crit, measure)?.value === undefined) n += 1;
    }
  }
  return n;
}

/** A value's position in its declared range, oriented so 1 is best: what the weighted sum, its sensitivity and `rankShare` all sum. */
function positionInRange(v: number, m: Measurement): number {
  const { min, max } = m.range!;
  const u = (v - min) / (max - min);
  return m.preference === 'decreasing' ? 1 - u : u;
}

/** One cell as a weighted aggregation reads it: a position in [0, 1], a blank (anywhere in it), or not applicable. */
export type Placed = { kind: 'position'; at: number } | { kind: 'blank' } | { kind: 'structural' };

/**
 * A prepared reader over one analysis and one measure that places each cell for a weighted aggregation, so the three
 * (`weightedSum`, `sensitivity`, `rankShare`) read a cell one way. The criterion's measurement must declare a range
 * and a preference direction: the weighted sum refuses a weighted criterion that does not.
 */
export function makePlacements(a: Analysis, measure: string): (altId: string, critId: string, m?: Measurement) => Placed {
  const read = makeReadings(a, measure);
  const declared = new Map<string, Measurement | undefined>();
  /** The criterion's measurement for this measure, found once per criterion (#373), unless the caller already holds it. */
  const measurementOf = (critId: string): Measurement => {
    if (!declared.has(critId)) declared.set(critId, measurementFor(a.criteria.find((c) => c.id === critId)!, measure));
    const m = declared.get(critId);
    if (!m) throw new Error(`makePlacements: criterion "${critId}" declares no measurement for "${measure}"`);
    return m;
  };
  return (altId, critId, given) => {
    const m = given ?? measurementOf(critId);
    const r = read(altId, critId, m);
    if (r.kind === 'structural') return { kind: 'structural' };
    // A value this criterion cannot place (a string level) reads as a blank: anywhere in the declared range.
    return r.kind === 'value' && r.numeric !== undefined ? { kind: 'position', at: positionInRange(r.numeric, m) } : { kind: 'blank' };
  };
}
