/**
 * How stable is the order a weighted sum reports? (#85, ADR-0015 as amended
 * 2026-08-21.)
 *
 * Two perturbations, reported together, because either alone flatters the
 * aggregate:
 *
 * 1. **Weight perturbation.** ADR-0015: "a ranking that flips under a 5% weight
 *    change is not a ranking." For each weighted criterion this reports how far
 *    its substitution weight must move -- up and down -- before something in the
 *    reported order changes: a pair that is ordered today stops being ordered,
 *    or a row falls out of the coverage gate. It is solved **exactly**, not
 *    sampled: each row's aggregate is a linear-fractional function of one
 *    weight, so the boundary between two rows is the root of a quadratic.
 * 2. **Alternative-set perturbation.** Rank reversal under a changed alternative
 *    set is the standing critique of compensatory methods, and it is the check
 *    that keeps shipping one honest. Each alternative is removed in turn and the
 *    order of the survivors is recompared. (Removal covers addition: the set
 *    without X, plus X, is the set with X.)
 *
 * **This is a stability finding, never a recommendation.** The result carries
 * its own `caption`, so a view renders the sentence the analysis wrote rather
 * than one of its own; nothing here names a winner, a best or a top.
 *
 * **It runs only over an opted-into weighted aggregation.** It calls
 * `weightedSum` with the caller's own options and reports nothing of its own
 * when that refuses -- no margins, no pairs, just the refusal it was given.
 * A row the coverage gate did not score has no stability number anywhere.
 */
import type { Analysis } from '../schema/analysis.js';
import { measurementFor } from '../schema/structure.js';
import type { Measurement } from '../schema/measurement.js';
import { makeReadings } from './readings.js';
import {
  weightedSum, separability,
  type WeightedSumOptions, type WeightedSumRefusal, type WeightedSumResult, type WeightedSumRow,
} from './weighted-sum.js';
import type { AnalysisResult } from './registry.js';

/** ADR-0015's own yardstick: a ranking that flips under a 5% weight change is not a ranking. */
export const FIVE_PERCENT = 0.05;

/** Floating-point slack, in weight units and in score units. */
const EPS = 1e-9;

export interface SensitivityOptions extends WeightedSumOptions {
  /**
   * Treat a movement smaller than this share of the total weight as fragile.
   * Defaults to ADR-0015's 5%.
   */
  fragileBelow?: number;
}

/** One ordered pair of the reported order: `higher` sits above `lower`, and they are separable. */
export interface OrderedPair { higher: string; lower: string }

/** What a weight movement first changes about the reported order. */
export interface OrderChange {
  /** The weight this criterion would have to carry. */
  at: number;
  /** How far that is from its declared weight. */
  delta: number;
  direction: 'up' | 'down';
  /** `delta` as a share of the total weight in the sum. The number ADR-0015's 5% is read against. */
  shareOfTotalWeight: number;
  /** `delta` as a share of this criterion's own weight; absent when the weight is 0. */
  shareOfOwnWeight?: number;
  cause:
    /** Two rows that are ordered today stop being ordered, or swap. */
    | 'pair-stops-being-ordered'
    /** A scored row's coverage falls below the floor, so it leaves the order entirely. */
    | 'row-leaves-the-coverage-gate';
  /** The pair that stops being ordered, when that is the cause. */
  pair?: OrderedPair;
  /** The row that leaves the gate, when that is the cause. */
  alternativeId?: string;
}

export interface CriterionSensitivity {
  criterionId: string;
  /** The substitution weight as declared. */
  weight: number;
  /** The first change if this weight is raised; absent when raising it changes nothing. */
  ifRaised?: OrderChange;
  /** The first change if this weight is lowered (never below 0); absent when lowering changes nothing. */
  ifLowered?: OrderChange;
  /** The smaller of the two, when either exists. */
  nearest?: OrderChange;
  /** True when `nearest` is within `fragileBelow` of the total weight. */
  fragile: boolean;
}

/** What removing one alternative does to the order of the others. */
export interface RemovalEffect {
  removed: string;
  /** Pairs of the survivors that were ordered before and are not now, or are now reversed. */
  changed: OrderedPair[];
  /** Pairs of the survivors that were not ordered before and are now. */
  gained: OrderedPair[];
  stable: boolean;
}

export interface SensitivityResult extends AnalysisResult {
  method: 'sensitivity';
  /**
   * The sentence this result is to be shown under. A stability finding, never
   * an endorsement: carried here so a view cannot recaption it as one.
   */
  caption: string;
  /** Set when the weighted sum refused; everything else is then empty. */
  refused?: WeightedSumRefusal;
  /** The order this is the stability of: every pair the gate scored and separated. */
  orderedPairs: OrderedPair[];
  /** Alternatives the coverage gate did not score. They carry no stability number. */
  unscored: string[];
  weightPerturbation: {
    criteria: CriterionSensitivity[];
    /** The smallest movement of any one weight that changes the order. */
    smallest?: { criterionId: string } & OrderChange;
    /** True when that movement is smaller than `fragileBelow` of the total weight. */
    fragile: boolean;
    fragileBelow: number;
    totalWeight: number;
  };
  alternativeSetPerturbation: {
    removals: RemovalEffect[];
    /** True when removing some alternative changed the order of the others. */
    reversalFound: boolean;
  };
  /** One line stating what both perturbations found. Phrased as stability. */
  finding: string;
  warnings: string[];
}

/**
 * One alternative's contribution on one criterion: the interval its cell allows,
 * in criterion position units, or that the criterion does not apply to it.
 */
interface Contribution {
  applies: boolean;
  observed: boolean;
  lo: number;
  hi: number;
}

/** A row's aggregate as a function of one weight: `(constant + slope*t) / (base + carries*t)`. */
interface Linear { constant: number; slope: number; base: number; carries: 0 | 1 }

function evaluate(f: Linear, t: number): number {
  const d = f.base + f.carries * t;
  return d <= 0 ? Number.NaN : (f.constant + f.slope * t) / d;
}

/** Roots of `f(t) = g(t)`, i.e. of a quadratic, restricted to `t >= 0`. */
function crossings(f: Linear, g: Linear): number[] {
  // (C_f + s_f t)(B_g + c_g t) = (C_g + s_g t)(B_f + c_f t)
  const a = f.slope * g.carries - g.slope * f.carries;
  const b = f.constant * g.carries + f.slope * g.base - g.constant * f.carries - g.slope * f.base;
  const c = f.constant * g.base - g.constant * f.base;
  const roots: number[] = [];
  if (Math.abs(a) < EPS) {
    if (Math.abs(b) > EPS) roots.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const r = Math.sqrt(disc);
      roots.push((-b + r) / (2 * a), (-b - r) / (2 * a));
    }
  }
  return roots.filter((t) => Number.isFinite(t) && t >= -EPS).map((t) => Math.max(t, 0));
}

/** The nearest root strictly above / below `w`, with a little slack for the one we sit on. */
function nearest(roots: readonly number[], w: number): { up?: number; down?: number } {
  let up: number | undefined;
  let down: number | undefined;
  for (const t of roots) {
    if (t > w + EPS && (up === undefined || t < up)) up = t;
    if (t < w - EPS && (down === undefined || t > down)) down = t;
  }
  return { ...(up === undefined ? {} : { up }), ...(down === undefined ? {} : { down }) };
}

function changeOf(
  at: number, w: number, totalWeight: number, cause: OrderChange['cause'],
  detail: { pair?: OrderedPair; alternativeId?: string },
): OrderChange {
  const delta = Math.abs(at - w);
  return {
    at,
    delta,
    direction: at > w ? 'up' : 'down',
    shareOfTotalWeight: totalWeight > 0 ? delta / totalWeight : Number.POSITIVE_INFINITY,
    ...(w > 0 ? { shareOfOwnWeight: delta / w } : {}),
    cause,
    ...(detail.pair ? { pair: detail.pair } : {}),
    ...(detail.alternativeId === undefined ? {} : { alternativeId: detail.alternativeId }),
  };
}

const closer = (x: OrderChange | undefined, y: OrderChange | undefined): OrderChange | undefined => {
  if (!x) return y;
  if (!y) return x;
  return y.delta < x.delta ? y : x;
};

/** The pairs a result orders: both rows scored, and separable. */
function orderedPairsOf(rows: readonly WeightedSumRow[]): OrderedPair[] {
  const pairs: OrderedPair[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const x = rows[i]!;
      const y = rows[j]!;
      const s = separability(x, y);
      if (s === 'x-higher') pairs.push({ higher: x.alternativeId, lower: y.alternativeId });
      else if (s === 'y-higher') pairs.push({ higher: y.alternativeId, lower: x.alternativeId });
    }
  }
  return pairs;
}

const key = (p: OrderedPair) => `${p.higher}>${p.lower}`;

export function sensitivity(a: Analysis, opts: SensitivityOptions): SensitivityResult {
  const fragileBelow = opts.fragileBelow ?? FIVE_PERCENT;
  const base = weightedSum(a, opts);
  const assumptions: [string, ...string[]] = [
    ...base.assumptions,
    'Weight sensitivity moves one substitution weight at a time and solves exactly for the first '
      + 'movement that changes the reported order. One-at-a-time movement understates joint '
      + 'sensitivity: several weights moving together can flip an order that no single weight can.',
    'The alternative-set perturbation removes each alternative in turn and recompares the survivors. '
      + 'Under declared-range normalisation no other score can move, so a reversal here would mean '
      + 'the aggregate had started normalising against the data instead -- which is what this checks.',
  ];

  const caption =
    'Stability of the reported order under a change of weights and of the alternative set. '
    + 'This says how much the order depends on choices nobody measured; it does not say which '
    + 'alternative to choose, and no number here is a recommendation.';

  if (base.refused) {
    return {
      method: 'sensitivity', caption, refused: base.refused,
      orderedPairs: [], unscored: [],
      weightPerturbation: { criteria: [], fragile: false, fragileBelow, totalWeight: 0 },
      alternativeSetPerturbation: { removals: [], reversalFound: false },
      finding: `No stability finding: the weighted sum refused to run (${base.refused.reason}).`,
      assumptions, warnings: [...base.warnings], widenedByDisclosure: base.widenedByDisclosure,
    };
  }

  const scored = base.rows.filter((r) => r.status !== 'not-scored');
  const unscored = base.rows.filter((r) => r.status === 'not-scored').map((r) => r.alternativeId);
  const orderedPairs = orderedPairsOf(scored);
  const totalWeight = base.basis.reduce((s, b) => s + b.weight, 0);

  // The contribution matrix the perturbation is computed over: one interval per
  // (alternative, weighted criterion), read exactly as the weighted sum read it.
  const read = makeReadings(a, opts.measure);
  const measurements = new Map<string, Measurement>();
  for (const { criterionId } of base.basis) {
    const crit = a.criteria.find((c) => c.id === criterionId);
    const m = crit ? measurementFor(crit, opts.measure) : undefined;
    if (m) measurements.set(criterionId, m);
  }
  const contributions = new Map<string, Map<string, Contribution>>();
  for (const row of base.rows) {
    const byCriterion = new Map<string, Contribution>();
    for (const { criterionId } of base.basis) {
      const m = measurements.get(criterionId)!;
      const r = read(row.alternativeId, criterionId, m);
      if (r.kind === 'structural') {
        byCriterion.set(criterionId, { applies: false, observed: false, lo: 0, hi: 0 });
      } else if (r.kind === 'value' && r.numeric !== undefined) {
        const u = (r.numeric - m.range!.min) / (m.range!.max - m.range!.min);
        const p = m.preference === 'decreasing' ? 1 - u : u;
        byCriterion.set(criterionId, { applies: true, observed: true, lo: p, hi: p });
      } else {
        byCriterion.set(criterionId, { applies: true, observed: false, lo: 0, hi: 1 });
      }
    }
    contributions.set(row.alternativeId, byCriterion);
  }

  /** `lo` or `hi` of one row as a function of criterion `k`'s weight. */
  const asFunction = (altId: string, k: string, end: 'lo' | 'hi'): Linear => {
    const byCriterion = contributions.get(altId)!;
    let constant = 0;
    let basis = 0;
    for (const { criterionId, weight } of base.basis) {
      if (criterionId === k) continue;
      const c = byCriterion.get(criterionId)!;
      if (!c.applies) continue;
      basis += weight;
      constant += weight * c[end];
    }
    const own = byCriterion.get(k)!;
    return own.applies
      ? { constant, slope: own[end], base: basis, carries: 1 }
      : { constant, slope: 0, base: basis, carries: 0 };
  };

  /** A row's weight coverage when criterion `k` carries weight `t`; `undefined` when nothing applies. */
  const coverageAt = (altId: string, k: string, t: number): number | undefined => {
    const byCriterion = contributions.get(altId)!;
    let applicable = 0;
    let observed = 0;
    for (const { criterionId, weight } of base.basis) {
      const c = byCriterion.get(criterionId)!;
      if (!c.applies) continue;
      const w = criterionId === k ? t : weight;
      applicable += w;
      if (c.observed) observed += w;
    }
    return applicable > 0 ? observed / applicable : undefined;
  };

  /** Whether the gate still scores this row when `k` carries weight `t`. */
  const scoredAt = (altId: string, k: string, t: number): boolean => {
    const coverage = coverageAt(altId, k, t);
    return coverage !== undefined && coverage >= base.coverageFloor - EPS;
  };

  /**
   * The weights at which a row's coverage crosses the floor as `k`'s weight
   * moves. Only rows that take part in an ordered pair: a row nothing is
   * ordered against leaving the gate changes no order.
   */
  const gateCrossings = (altId: string, k: string): number[] => {
    const byCriterion = contributions.get(altId)!;
    const own = byCriterion.get(k)!;
    if (!own.applies) return [];
    let applicable = 0;
    let observed = 0;
    for (const { criterionId, weight } of base.basis) {
      if (criterionId === k) continue;
      const c = byCriterion.get(criterionId)!;
      if (!c.applies) continue;
      applicable += weight;
      if (c.observed) observed += weight;
    }
    // (observed + [own observed] t) = floor * (applicable + t)
    const slope = (own.observed ? 1 : 0) - base.coverageFloor;
    const constant = observed - base.coverageFloor * applicable;
    if (Math.abs(slope) < EPS) return [];
    const t = -constant / slope;
    return t >= -EPS ? [Math.max(t, 0)] : [];
  };

  const criteria: CriterionSensitivity[] = base.basis.map(({ criterionId, weight }) => {
    let up: OrderChange | undefined;
    let down: OrderChange | undefined;
    const consider = (roots: readonly number[], cause: OrderChange['cause'], detail: { pair?: OrderedPair; alternativeId?: string }) => {
      const { up: u, down: d } = nearest(roots, weight);
      if (u !== undefined) up = closer(up, changeOf(u, weight, totalWeight, cause, detail));
      if (d !== undefined) down = closer(down, changeOf(d, weight, totalWeight, cause, detail));
    };

    for (const pair of orderedPairs) {
      const f = asFunction(pair.higher, criterionId, 'lo');
      const g = asFunction(pair.lower, criterionId, 'hi');
      // Only the crossings that really end the ordering: at the root the two
      // ends meet, and just past it the pair is no longer separable. And only
      // where both rows are still scored -- past the gate there is no pair left
      // to reorder, and quoting a margin from there would be a fiction.
      const roots = crossings(f, g).filter((t) => {
        if (!scoredAt(pair.higher, criterionId, t) || !scoredAt(pair.lower, criterionId, t)) return false;
        const after = t + Math.max(t, 1) * 1e-6;
        const before = Math.max(t - Math.max(t, 1) * 1e-6, 0);
        const ordered = (x: number) => evaluate(f, x) > evaluate(g, x) + EPS;
        return ordered(before) !== ordered(after);
      });
      consider(roots, 'pair-stops-being-ordered', { pair });
    }
    const inAnOrderedPair = new Set(orderedPairs.flatMap((p) => [p.higher, p.lower]));
    for (const altId of inAnOrderedPair) {
      const roots = gateCrossings(altId, criterionId);
      consider(roots, 'row-leaves-the-coverage-gate', { alternativeId: altId });
      // A row sitting exactly on the floor leaves it under any movement in the
      // direction that lowers its coverage. `nearest` steps over a root it is
      // standing on, so name it here, at a distance of nothing.
      for (const t of roots) {
        if (Math.abs(t - weight) > EPS) continue;
        const step = Math.max(weight, 1) * 1e-6;
        const onTheEdge = (direction: 'up' | 'down'): OrderChange => ({
          at: weight, delta: 0, direction, shareOfTotalWeight: 0,
          ...(weight > 0 ? { shareOfOwnWeight: 0 } : {}),
          cause: 'row-leaves-the-coverage-gate', alternativeId: altId,
        });
        if (!scoredAt(altId, criterionId, weight + step)) up = closer(up, onTheEdge('up'));
        if (weight > 0 && !scoredAt(altId, criterionId, Math.max(weight - step, 0))) {
          down = closer(down, onTheEdge('down'));
        }
      }
    }

    const near = closer(up, down);
    return {
      criterionId, weight,
      ...(up ? { ifRaised: up } : {}),
      ...(down ? { ifLowered: down } : {}),
      ...(near ? { nearest: near } : {}),
      fragile: near !== undefined && totalWeight > 0 && near.delta < fragileBelow * totalWeight,
    };
  });

  let smallest: ({ criterionId: string } & OrderChange) | undefined;
  for (const c of criteria) {
    if (c.nearest && (smallest === undefined || c.nearest.delta < smallest.delta)) {
      smallest = { criterionId: c.criterionId, ...c.nearest };
    }
  }
  const fragile = smallest !== undefined && totalWeight > 0 && smallest.delta < fragileBelow * totalWeight;

  // Alternative-set perturbation: remove each in turn, recompare the survivors.
  const removals: RemovalEffect[] = [];
  const allIds = base.rows.map((r) => r.alternativeId);
  for (const removed of allIds) {
    const survivors = allIds.filter((id) => id !== removed);
    const after = weightedSum(a, { ...opts, alternativeIds: survivors });
    const afterPairs = new Set(orderedPairsOf(after.rows.filter((r) => r.status !== 'not-scored')).map(key));
    const beforePairs = orderedPairs.filter((p) => p.higher !== removed && p.lower !== removed);
    const changed = beforePairs.filter((p) => !afterPairs.has(key(p)));
    const beforeKeys = new Set(beforePairs.map(key));
    const gained = [...afterPairs].filter((k) => !beforeKeys.has(k)).map((k) => {
      const [higher, lower] = k.split('>');
      return { higher: higher!, lower: lower! };
    });
    removals.push({ removed, changed, gained, stable: changed.length === 0 && gained.length === 0 });
  }
  const reversalFound = removals.some((r) => !r.stable);

  const warnings = [...base.warnings];
  if (orderedPairs.length === 0) {
    warnings.push(
      'The gate scored no separable pair, so there is no order for a weight movement to change. '
      + 'The weight margins below are absent rather than large.',
    );
  }

  const weightFinding = orderedPairs.length === 0
    ? 'no pair is ordered, so no weight movement can change the order'
    : smallest === undefined
      ? 'no movement of any single weight changes the order'
      : `the order first changes when "${smallest.criterionId}" moves ${smallest.direction} by `
        + `${round(smallest.delta)} (${percent(smallest.shareOfTotalWeight)} of the total weight)`
        + `${fragile ? `, which is inside the ${percent(fragileBelow)} ADR-0015 calls fragile` : ''}`;
  const setFinding = reversalFound
    ? 'removing an alternative reorders the others -- the ranking depends on who else is in the set'
    : 'removing any one alternative leaves the order of the others unchanged';

  return {
    method: 'sensitivity',
    caption,
    orderedPairs,
    unscored,
    weightPerturbation: {
      criteria,
      ...(smallest ? { smallest } : {}),
      fragile,
      fragileBelow,
      totalWeight,
    },
    alternativeSetPerturbation: { removals, reversalFound },
    finding: `Weights: ${weightFinding}. Alternative set: ${setFinding}.`,
    assumptions,
    warnings,
    widenedByDisclosure: base.widenedByDisclosure,
  };
}

function round(x: number): string {
  return String(Math.round(x * 1e6) / 1e6);
}

function percent(x: number): string {
  return Number.isFinite(x) ? `${Math.round(x * 1000) / 10}%` : 'an unbounded share';
}
