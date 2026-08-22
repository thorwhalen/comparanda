/**
 * Pareto dominance over incomplete, mixed-level data.
 *
 * Dominance is the strongest defensible reduction available: it says which
 * alternatives can be set aside without any weighting at all, and it requires no
 * value judgements. That makes it worth getting exactly right.
 *
 * **The rule we do not use, and why.** The natural implementation when cells are
 * missing is to compare only on the criteria where both alternatives have a
 * value. It is also the published definition in the incomplete-data skyline
 * literature, which is why it keeps getting re-proposed. It is not a partial
 * order: it is non-transitive, admits cycles, and can report that *every*
 * alternative is dominated, emptying the front. ("Drop a criterion when one side
 * is `not-applicable`" is the same rule wearing a different hat.)
 *
 * **What we do instead.** Every cell becomes an interval:
 *
 *   - an observed value `v` gives `[v, v]`;
 *   - a *contingently* missing value gives the criterion's declared range -- we
 *     do not know it, but we know what it could be;
 *   - a *structurally* missing value (`not-applicable`) leaves the comparison
 *     entirely, for both alternatives, because the criterion does not apply.
 *
 * Necessary dominance then compares interval bounds, and is a strict partial
 * order. Possible dominance is a filter only and is deliberately not transitive
 * -- it is reported as "cannot yet be ruled out", never used to build a front.
 *
 * The gap between the two is itself the useful output: it is the cost of the
 * missing data, measured in alternatives you cannot yet set aside.
 */
import type { Analysis } from '../schema/analysis.js';
import { isInapplicable, reducedValue, makeCellReader } from '../schema/analysis.js';
import { measurementFor } from '../schema/structure.js';
import { admitsDominance, isOrdered, type Measurement } from '../schema/measurement.js';
import { resolveMissingCode } from '../schema/missingness.js';

export interface Interval { lo: number; hi: number }

/** Why a criterion was left out of the comparison. Always reported. */
export interface ExcludedCriterion {
  criterionId: string;
  reason: 'nominal' | 'no-preference-direction' | 'no-declared-range' | 'non-numeric';
}

export interface DominanceOptions {
  measure: string;
  /**
   * Treat a difference at or below the criterion's indifference threshold as no
   * difference. Without this, strict dominance "is rare" and the analysis
   * usually reports that nothing is dominated -- which reads as a broken feature
   * rather than a finding.
   */
  usePracticalTolerance?: boolean;
  alternativeIds?: readonly string[];
  criterionIds?: readonly string[];
}

export interface DominanceResult {
  /** Not dominated even in the optimistic reading. Robustly surviving. */
  nonDominated: string[];
  /** Necessarily dominated: worse on every criterion however the blanks resolve. */
  dominated: string[];
  /**
   * Neither necessarily dominated nor robustly non-dominated. Their status
   * depends on how the blanks resolve, which is exactly what to go and find out.
   */
  provisional: string[];
  /** `a` necessarily dominates each of `dominates`. */
  edges: { dominator: string; dominated: string }[];
  /**
   * The criteria the comparison actually used. Fixed across the whole scope, not
   * chosen per pair -- a per-pair basis is the non-transitive rule again.
   */
  basis: string[];
  excluded: ExcludedCriterion[];
  /**
   * How many alternatives would leave `provisional` if every blank resolved.
   * The cost of the missing data, in the unit that matters.
   */
  uncertaintyCost: number;
  /** Only ever non-empty under `usePracticalTolerance`, which is not transitive. */
  cycles: string[][];
  notes: string[];
}

/** The interval a cell contributes, or `undefined` if it leaves the comparison. */
function intervalFor(
  a: Analysis, altId: string, critId: string, m: Measurement, measure: string,
): Interval | undefined | 'excluded' {
  if (isInapplicable(a, altId, critId)) return 'excluded';

  const r = reducedValue(a, altId, critId, measure);
  const range = m.range;
  if (!range) return undefined;

  if (r?.value !== undefined) {
    if (typeof r.value !== 'number') return undefined;
    return { lo: r.value, hi: r.value };
  }

  if (r?.missing) {
    const { facts } = resolveMissingCode(r.missing.code, a.missingCodes);
    // Structurally absent: the criterion does not apply here, so it leaves the
    // comparison for this pair rather than widening to the full range.
    //
    // An unresolvable code has no facts and therefore is NOT excluded: it widens
    // to the criterion's range like any other contingent absence. That is the
    // cautious direction -- an unknown code treated as structural would silently
    // remove a cell from every comparison it appears in.
    if (facts?.structural) return 'excluded';
  }

  // Contingently absent, or never asserted: it could be anything in range.
  return { lo: range.min, hi: range.max };
}

/** Distance from the target, as an interval, for `target` preference. */
function toTargetDistance(iv: Interval, target: number): Interval {
  const lo = iv.lo <= target && target <= iv.hi ? 0 : Math.min(Math.abs(iv.lo - target), Math.abs(iv.hi - target));
  const hi = Math.max(Math.abs(iv.lo - target), Math.abs(iv.hi - target));
  return { lo, hi };
}

/**
 * Orient an interval so that **larger is always better**, so the comparison
 * below has one form instead of three.
 */
function orient(iv: Interval, m: Measurement): Interval | undefined {
  switch (m.preference) {
    case 'increasing':
      return iv;
    case 'decreasing':
      return { lo: -iv.hi, hi: -iv.lo };
    case 'target': {
      const t = m.range?.target;
      if (t === undefined) return undefined;
      const d = toTargetDistance(iv, t);
      return { lo: -d.hi, hi: -d.lo };
    }
    default:
      return undefined;
  }
}

/**
 * Compute the dominance relation.
 *
 * The algorithm is the naive O(n^2 * m) pairwise scan, and that is a deliberate
 * choice rather than an oversight: these matrices are tens to low hundreds of
 * alternatives (ADR-0002), the scan is exact and obviously correct, and the
 * divide-and-conquer skyline algorithms that beat it only pay at sizes this tool
 * explicitly does not target.
 */
export function dominance(a: Analysis, opts: DominanceOptions): DominanceResult {
  const notes: string[] = [];
  const excluded: ExcludedCriterion[] = [];

  const altIds = (opts.alternativeIds ?? a.alternatives.filter((x) => !x.tombstoned).map((x) => x.id)).slice();
  const candidateCrits = opts.criterionIds ?? a.criteria.filter((x) => !x.tombstoned).map((x) => x.id);

  // Fix the basis once, across the whole scope. A basis chosen per pair is the
  // non-transitive common-dimensions rule, however it is dressed up.
  const basis: string[] = [];
  const measurements = new Map<string, Measurement>();
  for (const cid of candidateCrits) {
    const crit = a.criteria.find((c) => c.id === cid);
    const m = crit ? measurementFor(crit, opts.measure) : undefined;
    if (!m) { excluded.push({ criterionId: cid, reason: 'no-declared-range' }); continue; }
    if (!isOrdered(m.level)) { excluded.push({ criterionId: cid, reason: 'nominal' }); continue; }
    if (!admitsDominance(m.preference)) { excluded.push({ criterionId: cid, reason: 'no-preference-direction' }); continue; }
    if (!m.range) { excluded.push({ criterionId: cid, reason: 'no-declared-range' }); continue; }
    basis.push(cid);
    measurements.set(cid, m);
  }

  if (excluded.length > 0) {
    notes.push(
      `${excluded.length} criteria are excluded from the comparison by construction; ` +
      'a dominance result that does not say which is not interpretable.',
    );
  }
  if (basis.length === 0) {
    notes.push('no criterion admits a dominance comparison, so nothing can be dominated.');
    return {
      nonDominated: altIds, dominated: [], provisional: [], edges: [],
      basis, excluded, uncertaintyCost: 0, cycles: [], notes,
    };
  }

  // Materialise the oriented intervals once.
  type Row = Map<string, Interval | 'excluded'>;
  const rows = new Map<string, Row>();
  for (const altId of altIds) {
    const row: Row = new Map();
    for (const cid of basis) {
      const m = measurements.get(cid)!;
      const raw = intervalFor(a, altId, cid, m, opts.measure);
      if (raw === 'excluded') { row.set(cid, 'excluded'); continue; }
      if (raw === undefined) { row.set(cid, 'excluded'); continue; }
      const o = orient(raw, m);
      row.set(cid, o ?? 'excluded');
    }
    rows.set(altId, row);
  }

  const tolerance = (cid: string): number => {
    if (!opts.usePracticalTolerance) return 0;
    return measurements.get(cid)?.thresholds?.indifference ?? 0;
  };

  /** Does `x` necessarily dominate `y`? */
  function necessarilyDominates(x: string, y: string): boolean {
    const rx = rows.get(x)!, ry = rows.get(y)!;
    let strictSomewhere = false;
    let comparedAny = false;
    for (const cid of basis) {
      const ix = rx.get(cid), iy = ry.get(cid);
      // A criterion excluded for either side leaves the comparison for this pair.
      if (ix === 'excluded' || iy === 'excluded' || !ix || !iy) continue;
      comparedAny = true;
      const q = tolerance(cid);
      // At least as good however the blanks resolve: x's worst >= y's best.
      if (ix.lo < iy.hi - q) return false;
      if (ix.lo > iy.hi + q) strictSomewhere = true;
    }
    return comparedAny && strictSomewhere;
  }

  /** Could `x` dominate `y` under some resolution of the blanks? */
  function possiblyDominates(x: string, y: string): boolean {
    const rx = rows.get(x)!, ry = rows.get(y)!;
    let comparedAny = false;
    for (const cid of basis) {
      const ix = rx.get(cid), iy = ry.get(cid);
      if (ix === 'excluded' || iy === 'excluded' || !ix || !iy) continue;
      comparedAny = true;
      // x's best must reach y's worst, or it cannot win here under any resolution.
      if (ix.hi < iy.lo) return false;
    }
    return comparedAny;
  }

  const edges: { dominator: string; dominated: string }[] = [];
  const necessarilyDominated = new Set<string>();
  const possiblyDominated = new Set<string>();

  for (const x of altIds) {
    for (const y of altIds) {
      if (x === y) continue;
      if (necessarilyDominates(x, y)) {
        edges.push({ dominator: x, dominated: y });
        necessarilyDominated.add(y);
      } else if (possiblyDominates(x, y)) {
        possiblyDominated.add(y);
      }
    }
  }

  const dominated = altIds.filter((id) => necessarilyDominated.has(id));
  const provisional = altIds.filter((id) => !necessarilyDominated.has(id) && possiblyDominated.has(id));
  const nonDominated = altIds.filter((id) => !necessarilyDominated.has(id) && !possiblyDominated.has(id));

  // Practical tolerance breaks transitivity by construction -- a chain of
  // within-tolerance steps can traverse a real difference. Detect and report
  // rather than pretending it is a partial order.
  const cycles: string[][] = [];
  if (opts.usePracticalTolerance) {
    const adj = new Map<string, string[]>();
    for (const e of edges) adj.set(e.dominator, [...(adj.get(e.dominator) ?? []), e.dominated]);
    const seen = new Set<string>();
    const stack: string[] = [];
    const onStack = new Set<string>();
    const walk = (n: string): void => {
      seen.add(n); stack.push(n); onStack.add(n);
      for (const next of adj.get(n) ?? []) {
        if (onStack.has(next)) {
          cycles.push([...stack.slice(stack.indexOf(next)), next]);
        } else if (!seen.has(next)) walk(next);
      }
      stack.pop(); onStack.delete(n);
    };
    for (const id of altIds) if (!seen.has(id)) walk(id);
    if (cycles.length > 0) {
      notes.push(
        `${cycles.length} dominance cycle(s) under the practical tolerance. ` +
        'Indifference thresholds are not transitive: a chain of within-tolerance steps can ' +
        'cross a real difference. Treat this result as a heuristic screen, not an ordering.',
      );
    }
  }

  if (dominated.length === 0 && !opts.usePracticalTolerance) {
    notes.push(
      'nothing is necessarily dominated. Strict dominance is genuinely rare, especially with ' +
      'blanks in the matrix; try the practical tolerance, or fill the blanks the provisional ' +
      'set depends on.',
    );
  }

  return {
    nonDominated, dominated, provisional, edges, basis, excluded,
    uncertaintyCost: provisional.length, cycles, notes,
  };
}

export interface BlankWorthFilling {
  alternativeId: string;
  criterionId: string;
  /**
   * How many pairwise comparisons involving this alternative would be **settled**
   * by learning this one cell -- that is, comparisons whose verdict differs
   * between the cell resolving to its worst possible value and to its best.
   */
  decidesPairs: number;
  /** The comparisons in question, so a caller can show what is at stake. */
  against: string[];
}

/**
 * Which blanks, if filled, would actually decide something.
 *
 * The honest version of "value of information". For each blank cell it pins the
 * cell to the bottom of its declared range and then to the top, recomputes the
 * pairwise dominance verdicts involving that alternative, and counts the pairs
 * whose verdict *changes*. A cell that gives the same answer whichever way it
 * resolves is worth nothing to fill, however uncertain it looks.
 *
 * It is still a proxy, not a decision-theoretic VOI: it counts decided pairs
 * rather than weighing what the decision is worth, and it assumes the extremes
 * bracket the outcome, which holds because dominance here is monotone in each
 * cell. But it discriminates, which is the whole job -- "fill these three cells
 * next" is a far more useful answer than "the matrix is incomplete".
 *
 * Cost is O(blanks x alternatives x criteria), which at the sizes this tool
 * targets is nothing.
 */
export function blanksWorthFilling(a: Analysis, opts: DominanceOptions): BlankWorthFilling[] {
  const result = dominance(a, opts);
  if (result.basis.length === 0) return [];

  const altIds = opts.alternativeIds ?? a.alternatives.filter((x) => !x.tombstoned).map((x) => x.id);
  const reader = makeCellReader(a, opts.measure);

  // Rebuild the oriented intervals once, exactly as `dominance` does.
  type Row = Map<string, Interval | 'excluded'>;
  const rows = new Map<string, Row>();
  const measurements = new Map<string, Measurement>();
  for (const cid of result.basis) {
    const m = reader.measurementOf(cid);
    if (m) measurements.set(cid, m);
  }
  for (const altId of altIds) {
    const row: Row = new Map();
    for (const cid of result.basis) {
      const m = measurements.get(cid)!;
      const raw = intervalFor(a, altId, cid, m, opts.measure);
      row.set(cid, raw === 'excluded' || raw === undefined ? 'excluded' : (orient(raw, m) ?? 'excluded'));
    }
    rows.set(altId, row);
  }

  const tolerance = (cid: string): number =>
    opts.usePracticalTolerance ? (measurements.get(cid)?.thresholds?.indifference ?? 0) : 0;

  const dominates = (rx: Row, ry: Row): boolean => {
    let strict = false;
    let compared = false;
    for (const cid of result.basis) {
      const ix = rx.get(cid), iy = ry.get(cid);
      if (ix === 'excluded' || iy === 'excluded' || !ix || !iy) continue;
      compared = true;
      const q = tolerance(cid);
      if (ix.lo < iy.hi - q) return false;
      if (ix.lo > iy.hi + q) strict = true;
    }
    return compared && strict;
  };

  /** The verdict pair for (x, y), as a comparable token. */
  const verdict = (rx: Row, ry: Row): string =>
    `${dominates(rx, ry) ? 1 : 0}${dominates(ry, rx) ? 1 : 0}`;

  const out: BlankWorthFilling[] = [];

  for (const altId of altIds) {
    const row = rows.get(altId)!;
    for (const cid of result.basis) {
      if (reader.read(altId, cid)?.value !== undefined) continue;
      if (isInapplicable(a, altId, cid)) continue;
      const current = row.get(cid);
      if (current === 'excluded' || !current) continue;

      // Pin to each end of the (already oriented) interval and see what moves.
      const atWorst: Row = new Map(row);
      atWorst.set(cid, { lo: current.lo, hi: current.lo });
      const atBest: Row = new Map(row);
      atBest.set(cid, { lo: current.hi, hi: current.hi });

      const against: string[] = [];
      for (const otherId of altIds) {
        if (otherId === altId) continue;
        const other = rows.get(otherId)!;
        if (verdict(atWorst, other) !== verdict(atBest, other)) against.push(otherId);
      }

      if (against.length > 0) {
        out.push({ alternativeId: altId, criterionId: cid, decidesPairs: against.length, against });
      }
    }
  }

  // Ties broken by id so the ordering is reproducible -- a ranking whose order
  // depends on Map iteration would differ between runs on the same data.
  return out.sort(
    (x, y) =>
      y.decidesPairs - x.decidesPairs ||
      x.alternativeId.localeCompare(y.alternativeId) ||
      x.criterionId.localeCompare(y.criterionId),
  );
}
