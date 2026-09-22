/**
 * The datum-relative tally (Pugh): four counts against a chosen datum, never a
 * net (#83, ADR-0015 sub-amendment g).
 *
 * Against the datum, every other alternative gets, per criterion, one of
 * **better**, **same**, **worse** or **not comparable**. Better-than is a ranking
 * comparison, legal on ordinal data. `plus - minus` is not: it is a compensatory
 * aggregate over ordinal comparisons in disguise, and the documented misreading
 * of Pugh's method. So:
 *
 * - **There is no net, total or score anywhere in the result.** The counts are
 *   a profile, not a scalar; a caller who wants a number must do the arithmetic
 *   deliberately, and the legend says why they should not.
 * - **`notComparable` is a real fourth count.** Pugh's own `S` was overloaded
 *   between "the merit is similar" and "the difference cannot be determined
 *   yet"; separating them is ADR-0009's rule applied to a derived count. It is
 *   driven by missingness (a blank that leaves the difference open, a structural
 *   absence, a non-numeric value), and by criteria with no direction of
 *   preference (`none`, `ordered`, a nominal level) or a `target` preference,
 *   which is excluded from strict comparison in v1 exactly as in dominance
 *   (ADR-0019 clause 7).
 *
 * `same` uses the criterion's declared `indifference` (0 when none is declared).
 * A contingent blank widens to the declared range, as in dominance; a comparison
 * the widened interval still decides is decided, otherwise it is not comparable.
 */
import type { Analysis } from '../schema/analysis.js';
import { measurementFor } from '../schema/structure.js';
import { isOrdered, type Measurement } from '../schema/measurement.js';
import { indifferenceOf, makeReadings, widenedCells, type Reading } from './readings.js';

export interface PughOptions {
  measure: string;
  /** The alternative every other one is compared against. */
  datum: string;
  alternativeIds?: readonly string[];
  criterionIds?: readonly string[];
}

export type PughStanding = 'better' | 'same' | 'worse' | 'not-comparable';

export type NotComparableReason =
  | 'blank' | 'structural' | 'non-numeric'
  | 'no-preference-direction' | 'target-preference' | 'no-measurement';

export interface PughComparison {
  criterionId: string;
  standing: PughStanding;
  /** Present when `standing` is `not-comparable`. */
  reason?: NotComparableReason;
}

/**
 * Four counts. Deliberately no fifth field: no net, no total, no score.
 */
export interface PughCounts {
  better: number;
  same: number;
  worse: number;
  notComparable: number;
}

export interface PughRow {
  alternativeId: string;
  counts: PughCounts;
  criteria: PughComparison[];
}

export interface PughResult {
  datum: string;
  rows: PughRow[];
  /** What the tally is not. Render it with the counts (ADR-0015 g). */
  legend: string;
  /** Cells in scope whose content was withheld from this reader (ADR-0021). */
  widenedByDisclosure: number;
  notes: string[];
}

type Bounds = { lo: number; hi: number };

/** A reading as bounds oriented so larger is better, or why it cannot be compared. */
function boundsOf(r: Reading, m: Measurement): Bounds | NotComparableReason {
  if (r.kind === 'structural') return 'structural';
  let b: Bounds;
  if (r.kind === 'blank') {
    if (!r.range) return 'blank';
    b = r.range;
  } else {
    if (r.numeric === undefined) return 'non-numeric';
    b = { lo: r.numeric, hi: r.numeric };
  }
  return m.preference === 'decreasing' ? { lo: -b.hi, hi: -b.lo } : b;
}

/** Why a criterion cannot be compared at all, before looking at any cell. */
function criterionRefusal(m: Measurement | undefined): NotComparableReason | undefined {
  if (!m) return 'no-measurement';
  if (m.preference === 'target') return 'target-preference';
  if (!isOrdered(m.level) || (m.preference !== 'increasing' && m.preference !== 'decreasing')) {
    return 'no-preference-direction';
  }
  return undefined;
}

export function pughTally(a: Analysis, opts: PughOptions): PughResult {
  const altIds = (opts.alternativeIds ?? a.alternatives.filter((x) => !x.tombstoned).map((x) => x.id)).slice();
  const critIds = (opts.criterionIds ?? a.criteria.filter((x) => !x.tombstoned).map((x) => x.id)).slice();
  if (!a.alternatives.some((x) => x.id === opts.datum)) {
    throw new Error(`the datum "${opts.datum}" is not an alternative in this analysis`);
  }
  const read = makeReadings(a, opts.measure);
  const measurements = new Map(critIds.map((cid) => {
    const crit = a.criteria.find((c) => c.id === cid);
    return [cid, crit ? measurementFor(crit, opts.measure) : undefined] as const;
  }));

  const rows: PughRow[] = [];
  for (const alt of altIds) {
    if (alt === opts.datum) continue;
    const criteria: PughComparison[] = [];
    for (const cid of critIds) {
      const m = measurements.get(cid);
      const refused = criterionRefusal(m);
      if (refused) { criteria.push({ criterionId: cid, standing: 'not-comparable', reason: refused }); continue; }
      const x = boundsOf(read(alt, cid, m!), m!);
      const d = boundsOf(read(opts.datum, cid, m!), m!);
      if (typeof x === 'string' || typeof d === 'string') {
        // The datum's side decides the reason only when the alternative's is fine.
        criteria.push({ criterionId: cid, standing: 'not-comparable', reason: typeof x === 'string' ? x : d as NotComparableReason });
        continue;
      }
      const q = indifferenceOf(m!);
      const standing: PughStanding =
        x.lo > d.hi + q ? 'better'
          : x.hi < d.lo - q ? 'worse'
            : x.lo >= d.hi - q && d.lo >= x.hi - q ? 'same'
              : 'not-comparable';
      criteria.push(standing === 'not-comparable'
        ? { criterionId: cid, standing, reason: 'blank' }
        : { criterionId: cid, standing });
    }
    const count = (s: PughStanding) => criteria.filter((c) => c.standing === s).length;
    rows.push({
      alternativeId: alt,
      counts: { better: count('better'), same: count('same'), worse: count('worse'), notComparable: count('not-comparable') },
      criteria,
    });
  }

  const datumLabel = a.alternatives.find((x) => x.id === opts.datum)?.label ?? opts.datum;
  const legend = `counts of better/same/worse against ${datumLabel}; not a score, and not comparable ` +
    'across different datums. "Not comparable" is not "same": it means the difference cannot be ' +
    'determined, or the criterion has no direction to compare along.';
  const notes: string[] = [];
  const widenedByDisclosure = widenedCells(a, altIds, critIds, opts.measure);
  if (widenedByDisclosure > 0) {
    notes.push(`${widenedByDisclosure} cell(s) in scope are withheld from you and were read as blanks.`);
  }
  return { datum: opts.datum, rows, legend, widenedByDisclosure, notes };
}
