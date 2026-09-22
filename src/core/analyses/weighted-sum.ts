/**
 * Opt-in weighted sum, behind a weight-coverage gate (#84, ADR-0015 as amended
 * 2026-08-21, ADR-0018, ADR-0020).
 *
 * The only aggregate this package ships, and it is never a default. What makes
 * it defensible is what it refuses:
 *
 * - **Weighted sum only.** TOPSIS, AHP, PROMETHEE and ELECTRE III are rejected
 *   (ADR-0015); there is no method switch.
 * - **Normalised against declared ranges, never observed extrema.** Normalising
 *   against the extremes in the data makes every score depend on which other
 *   alternatives are present: add one and the others move. A criterion's
 *   position is `(v - min) / (max - min)` of its **declared** `range`, flipped for
 *   `decreasing`.
 * - **Refuses over a weighted criterion it cannot normalise**, with the criterion
 *   and the reason: no declared range, no direction of preference (`none`,
 *   `ordered`, a nominal level), a `target` preference (excluded from strict
 *   comparison in v1 exactly as in dominance, ADR-0019 clause 7, #142), or a
 *   negative weight. Silently dropping a weighted criterion would change the
 *   aggregate the author asked for.
 * - **Weights are `weights.substitution`** (ADR-0020): a rate of exchange across
 *   the declared swing. A criterion with no substitution weight is not in the
 *   sum and is listed as excluded. `weights.voting` is never read.
 * - **The coverage gate.** Weight coverage for an alternative is the weight on
 *   criteria where it has an observed value, over the weight on criteria that
 *   apply to it. At 1.0 it gets a point aggregate; from the floor (2/3 by
 *   default, provisional) up to 1.0 an **interval** over every completion of its
 *   blanks, and no point value anywhere; below the floor, nothing -- and it stays
 *   in the result, labelled "not scored -- insufficient coverage", because
 *   dropping it is case deletion through the back door.
 * - **Two labels that cannot be switched off**, because they are true of the
 *   numbers whether or not a reader wants to hear it: a warning whenever an
 *   ordinal criterion is summed (arithmetic on ordinal levels is a modelling
 *   choice, not a measurement), and, whenever weights are renormalised over
 *   criteria that do not apply to an alternative, the statement that this **is
 *   mean imputation**. There is no option that suppresses either.
 *
 * Missingness is read through the vocabulary's flags (ADR-0009, #44): a
 * structural absence leaves the sum for that alternative (its weight is
 * renormalised away, and labelled); every other absence is a contingent blank
 * that widens to the declared range.
 */
import type { Analysis } from '../schema/analysis.js';
import { measurementFor } from '../schema/structure.js';
import { isOrdered, type Measurement } from '../schema/measurement.js';
import { makeReadings, widenedCells } from './readings.js';
import type { AnalysisResult } from './registry.js';

/** The working default of the coverage floor (ADR-0015). Provisional; see `coverageFloor`. */
export const DEFAULT_COVERAGE_FLOOR = 2 / 3;

export interface WeightedSumOptions {
  measure: string;
  alternativeIds?: readonly string[];
  criterionIds?: readonly string[];
  /**
   * Weight coverage below which no aggregate is offered. Defaults to 2/3, which
   * ADR-0015 calls provisional: its sources are count-based screens on a far
   * larger index. The simulation in #84 over the example datasets is the
   * evidence for or against it at our size.
   */
  coverageFloor?: number;
}

export type WeightedSumExclusionReason = 'no-substitution-weight';

export type WeightedSumRefusalReason =
  | 'no-declared-range' | 'no-preference-direction' | 'target-preference' | 'negative-weight' | 'no-weighted-criteria'
  | 'no-measurement' | 'non-numeric-levels';

export interface WeightedSumRefusal {
  /** The criterion that stopped the analysis, when one did. */
  criterionId?: string;
  reason: WeightedSumRefusalReason;
  message: string;
}

export type WeightedSumRow =
  | {
    alternativeId: string;
    status: 'point';
    /** In [0, 1] of the declared ranges. */
    value: number;
    coverage: number;
    renormalised?: Renormalisation;
  }
  | {
    alternativeId: string;
    status: 'interval';
    /** Lowest and highest aggregate over every completion of the blanks. No point value. */
    interval: [number, number];
    coverage: number;
    /** Criteria whose cell is a blank and widened to its declared range. */
    blankCriteria: string[];
    renormalised?: Renormalisation;
  }
  | {
    alternativeId: string;
    status: 'not-scored';
    /** Always "not scored -- insufficient coverage" or "not scored -- no weighted criterion applies". */
    label: string;
    coverage: number;
  };

/** Weights renormalised over the criteria that apply. Mean imputation, and labelled as such. */
export interface Renormalisation {
  /** Weighted criteria that do not apply to this alternative (structural absence). */
  criteria: string[];
  label: string;
}

export interface WeightedSumResult extends AnalysisResult {
  method: 'weighted-sum';
  /** Set when the analysis refused to run. `rows` is then empty. */
  refused?: WeightedSumRefusal;
  /** Weighted criteria, in order; their weights as declared. */
  basis: { criterionId: string; weight: number }[];
  excluded: { criterionId: string; reason: WeightedSumExclusionReason }[];
  coverageFloor: number;
  rows: WeightedSumRow[];
  /** The method and what it assumes, for display at the point of use. Never empty. */
  assumptions: readonly [string, ...string[]];
  /** Warnings that are true of the numbers; not suppressible. */
  warnings: string[];
  widenedByDisclosure: number;
}

const IMPUTATION_LABEL =
  'Weights were renormalised over the criteria that apply to this alternative. That is mean ' +
  'imputation: each missing criterion is silently scored at this alternative\'s own average.';

const ORDINAL_WARNING =
  'Ordinal criteria are in this sum. Their levels are positions, not quantities; treating the gap ' +
  'between 1 and 2 as equal to the gap between 4 and 5 is a modelling choice this aggregate makes ' +
  'for you. Prefer dominance or the datum tally where the ordinal criteria decide the question.';

/** Floating-point slack for the coverage comparison; far below any meaningful weight. */
const COVERAGE_TOLERANCE = 1e-9;

function refusalOf(m: Measurement | undefined, weight: number, cid: string): WeightedSumRefusal | undefined {
  if (weight < 0) {
    return { criterionId: cid, reason: 'negative-weight', message: `criterion "${cid}" has a negative substitution weight (${weight}); a rate of exchange cannot be negative.` };
  }
  if (m?.preference === 'target') {
    return {
      criterionId: cid, reason: 'target-preference',
      message: `criterion "${cid}" has a target preference, which needs a distance metric to aggregate; ` +
        'excluded from strict comparison in v1 (ADR-0019 clause 7). Remove its substitution weight, or declare a direction.',
    };
  }
  if (!m || !isOrdered(m.level) || (m.preference !== 'increasing' && m.preference !== 'decreasing')) {
    return {
      criterionId: cid, reason: 'no-preference-direction',
      message: `criterion "${cid}" has no direction of preference, so its values cannot be placed on a better-worse scale to sum.`,
    };
  }
  if (!m.range || !(m.range.max > m.range.min)) {
    return {
      criterionId: cid, reason: 'no-declared-range',
      message: `criterion "${cid}" has no declared range. A weighted sum normalises against declared ranges, ` +
        'never observed extremes -- those move every score when an alternative is added (ADR-0015, ADR-0018, ADR-0020).',
    };
  }
  if (m.levels && m.levels.some((l) => typeof l !== 'number')) {
    // Otherwise every value reads as a blank and the row is silently labelled
    // "insufficient coverage" with its data present. (Review finding.)
    return {
      criterionId: cid, reason: 'non-numeric-levels',
      message: `criterion "${cid}" has non-numeric levels, which have no position in a numeric range to weight.`,
    };
  }
  return undefined;
}

/** A value's position in its declared range, oriented so 1 is best. */
function position(v: number, m: Measurement): number {
  const { min, max } = m.range!;
  const u = (v - min) / (max - min);
  return m.preference === 'decreasing' ? 1 - u : u;
}

export function weightedSum(a: Analysis, opts: WeightedSumOptions): WeightedSumResult {
  const coverageFloor = opts.coverageFloor ?? DEFAULT_COVERAGE_FLOOR;
  const altIds = (opts.alternativeIds ?? a.alternatives.filter((x) => !x.tombstoned).map((x) => x.id)).slice();
  const critIds = (opts.criterionIds ?? a.criteria.filter((x) => !x.tombstoned).map((x) => x.id)).slice();

  const basis: { criterionId: string; weight: number; m: Measurement }[] = [];
  const excluded: WeightedSumResult['excluded'] = [];
  let refused: WeightedSumRefusal | undefined;
  for (const cid of critIds) {
    const crit = a.criteria.find((c) => c.id === cid);
    const weight = crit?.weights?.substitution;
    if (weight === undefined) { excluded.push({ criterionId: cid, reason: 'no-substitution-weight' }); continue; }
    const m = crit ? measurementFor(crit, opts.measure) : undefined;
    // A weighted criterion the method cannot place stops the analysis rather
    // than being dropped: dropping it changes the sum the author asked for.
    if (!m) {
      refused = { criterionId: cid, reason: 'no-measurement', message: `criterion "${cid}" carries a substitution weight but declares no measurement for "${opts.measure}".` };
      break;
    }
    const r = refusalOf(m, weight, cid);
    if (r) { refused = r; break; }
    basis.push({ criterionId: cid, weight, m });
  }
  if (!refused && basis.every((b) => b.weight === 0)) {
    refused = {
      reason: 'no-weighted-criteria',
      message: 'no criterion in scope carries a positive substitution weight, so there is nothing to sum.',
    };
  }

  const assumptions: [string, ...string[]] = [
    'Weighted sum of each criterion\'s position within its declared range (0 = worst end, 1 = best end), ' +
      'weighted by substitution weights. Compensatory: a gain on one criterion buys off a loss on another ' +
      'at the declared rate.',
    'Normalised against declared ranges, not observed extremes, so adding or removing an alternative ' +
      'never moves another\'s score.',
    `Coverage gate: a point value only at full weight coverage; an interval over every completion of the ` +
      `blanks from ${formatFloor(coverageFloor)} up; nothing below. ` +
      (opts.coverageFloor === undefined
        ? 'The floor of 2/3 is a provisional default (ADR-0015).'
        : 'The floor was set by the caller.'),
  ];
  const widenedByDisclosure = widenedCells(a, altIds, basis.map((b) => b.criterionId), opts.measure);

  const publicBasis = basis.map(({ criterionId, weight }) => ({ criterionId, weight }));
  if (refused) {
    return {
      method: 'weighted-sum', refused, basis: publicBasis, excluded, coverageFloor, rows: [],
      assumptions, warnings: [], widenedByDisclosure,
    };
  }

  const warnings: string[] = [];
  if (basis.some((b) => b.m.level === 'ordinal')) warnings.push(ORDINAL_WARNING);

  const read = makeReadings(a, opts.measure);
  const rows: WeightedSumRow[] = [];
  let anyRenormalised = false;
  for (const alt of altIds) {
    let applicable = 0;
    let observed = 0;
    let lo = 0;
    let hi = 0;
    const blankCriteria: string[] = [];
    const notApplicable: string[] = [];
    for (const { criterionId, weight, m } of basis) {
      const r = read(alt, criterionId, m);
      if (r.kind === 'structural') { notApplicable.push(criterionId); continue; }
      applicable += weight;
      if (r.kind === 'value' && r.numeric !== undefined) {
        const p = position(r.numeric, m);
        observed += weight;
        lo += weight * p;
        hi += weight * p;
      } else {
        // A contingent blank, or a value this criterion cannot place (a string
        // level): anything in the declared range, so [0, 1] of it.
        blankCriteria.push(criterionId);
        hi += weight;
      }
    }
    if (applicable === 0) {
      rows.push({ alternativeId: alt, status: 'not-scored', label: 'not scored -- no weighted criterion applies', coverage: 0 });
      continue;
    }
    const coverage = observed / applicable;
    const renormalised = notApplicable.length > 0 ? { criteria: notApplicable, label: IMPUTATION_LABEL } : undefined;
    // A small tolerance, so a row sitting exactly on the floor is not lost to
    // floating-point (0.225 + 0.15 + 0.3 of 0.675 reads 0.6666666666666665).
    if (coverage < coverageFloor - COVERAGE_TOLERANCE) {
      rows.push({ alternativeId: alt, status: 'not-scored', label: 'not scored -- insufficient coverage', coverage });
      continue;
    }
    if (renormalised) anyRenormalised = true;
    if (blankCriteria.length === 0) {
      rows.push({ alternativeId: alt, status: 'point', value: lo / applicable, coverage, ...(renormalised ? { renormalised } : {}) });
    } else {
      rows.push({
        alternativeId: alt, status: 'interval', interval: [lo / applicable, hi / applicable], coverage, blankCriteria,
        ...(renormalised ? { renormalised } : {}),
      });
    }
  }
  if (anyRenormalised) warnings.push(IMPUTATION_LABEL);
  if (widenedByDisclosure > 0) {
    warnings.push(`${widenedByDisclosure} cell(s) in scope are withheld from you and were read as blanks.`);
  }

  return {
    method: 'weighted-sum', basis: publicBasis, excluded, coverageFloor, rows, assumptions, warnings, widenedByDisclosure,
  };
}

function formatFloor(f: number): string {
  return Math.abs(f - 2 / 3) < 1e-12 ? '2/3' : String(f);
}

/**
 * Whether two scored rows can be ordered. Two intervals (or an interval and a
 * point) are separable only when they do not overlap; otherwise the answer is
 * "not separable on the available data", never a tie-break (ADR-0015).
 */
export function separability(x: WeightedSumRow, y: WeightedSumRow): 'x-higher' | 'y-higher' | 'not-separable' {
  const bounds = (r: WeightedSumRow): [number, number] | undefined =>
    r.status === 'point' ? [r.value, r.value] : r.status === 'interval' ? r.interval : undefined;
  const bx = bounds(x);
  const by = bounds(y);
  if (!bx || !by) return 'not-separable';
  if (bx[0] > by[1]) return 'x-higher';
  if (by[0] > bx[1]) return 'y-higher';
  return 'not-separable';
}
