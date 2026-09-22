/**
 * Agreement: Krippendorff's alpha per criterion, over alternatives as units
 * (ADR-0022, #82).
 *
 * Four rules from the ADR shape everything here:
 *
 * 1. **Per criterion, never per cell, never per matrix.** Alpha "evaluates
 *    reliability one variable at a time"; over the two to five assertions of one
 *    cell there is nothing to chance-correct. `agreement()` returns one entry per
 *    criterion and has no field, option or code path that combines them.
 * 2. **Always with an interval** -- a jackknife over units by default. At twenty
 *    alternatives the interval *is* the story.
 * 3. **Labelled by the weakest independence rung present**, after collapsing
 *    personas of one principal. Only a set whose every contributing assertion is
 *    `independent` is labelled `agreement`; anything else is `consistency`
 *    (agent self-consistency, test-retest) and says why. A labelling rule, not a
 *    ban -- the number is still produced.
 * 4. **Missingness by flags, never by literal code.** A structural absence
 *    removes the value from the computation entirely. Every other absence is
 *    absent from the value domain; the *terminal* ones (a looked-and-found
 *    answer, not outstanding work) are additionally counted and reported
 *    separately, grouped by the core code they are or refine.
 *
 * The bands (0.800 / 0.667, Krippendorff's own) are reported with their source
 * and **act on nothing**: no threshold here gates, suppresses or warns.
 *
 * The kernel is `krippendorffAlpha`, which takes plain units and a metric. The
 * ordinal difference function is the one implementations get wrong: it is not
 * `(c - k)^2` but a distance in *observed marginal mass* between the two ranks,
 * so it depends on the data and is recomputed for every jackknife replicate.
 */
import type { Analysis } from '../schema/analysis.js';
import { cellIndex, cellKey, vocabularyOf } from '../schema/analysis.js';
import { makeInapplicability } from '../schema/groups.js';
import { measurementFor } from '../schema/structure.js';
import { CORE_MISSING_CODES } from '../schema/missingness.js';
import { Independence, effectiveIndependence } from '../schema/provenance.js';
import { isWidenedByDisclosure, type Assertion, type ScalarValue } from '../schema/values.js';
import type { LevelOfMeasurement, Measurement } from '../schema/measurement.js';

/** The difference function, chosen by the criterion's level of measurement. */
export type AlphaMetric = 'nominal' | 'ordinal' | 'interval' | 'ratio';

/**
 * Krippendorff's alpha over units of pairable values.
 *
 * `units[u]` holds the values the observers gave unit `u` (missing values are
 * simply not there). Values are category labels for `nominal`, **ranks**
 * (any increasing numbers; only their order is used) for `ordinal`, and
 * numbers for `interval` / `ratio`. Units with fewer than two values are not
 * pairable and drop out, as in Krippendorff (2011).
 *
 * Returns `undefined` when alpha is undefined: fewer than two pairable values,
 * or no expected disagreement (every pairable value identical).
 */
export function krippendorffAlpha(
  units: readonly (readonly (number | string)[])[],
  metric: AlphaMetric,
): number | undefined {
  const pairable = units.filter((u) => u.length >= 2);
  // Coincidence matrix over the distinct values, indexed by key.
  const keys: (number | string)[] = [];
  const indexOf = new Map<number | string, number>();
  for (const u of pairable) for (const v of u) if (!indexOf.has(v)) { indexOf.set(v, keys.length); keys.push(v); }
  if (metric !== 'nominal') {
    keys.sort((x, y) => (x as number) - (y as number));
    keys.forEach((k, i) => indexOf.set(k, i));
  }
  const K = keys.length;
  const o: number[][] = Array.from({ length: K }, () => new Array<number>(K).fill(0));
  for (const u of pairable) {
    const m = u.length;
    for (let i = 0; i < m; i += 1) {
      for (let j = 0; j < m; j += 1) {
        if (i === j) continue;
        o[indexOf.get(u[i]!)!]![indexOf.get(u[j]!)!]! += 1 / (m - 1);
      }
    }
  }
  const nc = o.map((row) => row.reduce((s, x) => s + x, 0));
  const n = nc.reduce((s, x) => s + x, 0);
  if (n < 2) return undefined;

  const delta2 = (c: number, k: number): number => {
    if (c === k) return 0;
    switch (metric) {
      case 'nominal':
        return 1;
      case 'ordinal': {
        const [lo, hi] = c < k ? [c, k] : [k, c];
        let mass = 0;
        for (let g = lo; g <= hi; g += 1) mass += nc[g]!;
        return (mass - (nc[c]! + nc[k]!) / 2) ** 2;
      }
      case 'interval':
        return ((keys[c] as number) - (keys[k] as number)) ** 2;
      case 'ratio': {
        const x = keys[c] as number, y = keys[k] as number;
        return x + y === 0 ? 0 : ((x - y) / (x + y)) ** 2;
      }
    }
  };

  let observed = 0;
  let expected = 0;
  for (let c = 0; c < K; c += 1) {
    for (let k = 0; k < K; k += 1) {
      const d = delta2(c, k);
      observed += o[c]![k]! * d;
      expected += nc[c]! * nc[k]! * d;
    }
  }
  if (expected === 0) return undefined;
  return 1 - ((n - 1) * observed) / expected;
}

/**
 * Jackknife interval over units: leave each pairable unit out, form
 * pseudo-values, and take `alpha +/- z * SE` (ADR-0022: jackknife by default,
 * per Hughes 2021). The upper end is capped at 1, which alpha cannot exceed by
 * definition; nothing else is trimmed, because a wide interval must look wide.
 *
 * `undefined` when there are fewer than three pairable units or a replicate is
 * undefined, with the reason returned beside it.
 */
export function jackknifeInterval(
  units: readonly (readonly (number | string)[])[],
  metric: AlphaMetric,
  { z = 1.959963984540054 }: { z?: number } = {},
): { interval?: [number, number]; standardError?: number; reason?: string } {
  const pairable = units.filter((u) => u.length >= 2);
  const full = krippendorffAlpha(pairable, metric);
  const n = pairable.length;
  if (full === undefined) return { reason: 'alpha is undefined over these data, so there is no interval.' };
  if (n < 3) return { reason: `only ${n} pairable unit(s); a jackknife needs at least 3.` };
  const pseudo: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const loo = krippendorffAlpha(pairable.filter((_, j) => j !== i), metric);
    if (loo === undefined) {
      return { reason: 'alpha is undefined with one unit left out, so the jackknife cannot be formed.' };
    }
    pseudo.push(n * full - (n - 1) * loo);
  }
  const mean = pseudo.reduce((s, x) => s + x, 0) / n;
  const variance = pseudo.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1);
  const standardError = Math.sqrt(variance / n);
  return { interval: [full - z * standardError, Math.min(1, full + z * standardError)], standardError };
}

/** Which difference function a level of measurement takes. */
export function metricFor(level: LevelOfMeasurement): AlphaMetric {
  return level;
}

/** Krippendorff's conventional bands. Reported with their source; they act on nothing. */
export interface AgreementBand {
  /** Where alpha falls against the edges, in words that make no recommendation. */
  position: 'at-or-above-upper' | 'between' | 'below-lower';
  edges: { lower: number; upper: number };
  source: string;
}

export const KRIPPENDORFF_BANDS = Object.freeze({
  lower: 0.667,
  upper: 0.8,
  source: 'Krippendorff, Content Analysis, 2nd ed. (2004), pp. 241-243. The bands certify a coding ' +
    'instrument; here disagreement is a finding, so they gate nothing (ADR-0022).',
});

export interface CriterionAgreement {
  criterionId: string;
  metric: AlphaMetric;
  /** Point estimate. `undefined` when alpha is undefined, with `reason`. */
  alpha?: number | undefined;
  interval?: [number, number] | undefined;
  standardError?: number | undefined;
  /** Why `alpha` or `interval` is missing, when either is. */
  reason?: string | undefined;
  band?: AgreementBand | undefined;
  /**
   * `agreement` only when every contributing assertion is `independent` after
   * collapsing personas; otherwise `consistency` -- self-consistency or
   * test-retest reliability, never agreement between raters (ADR-0022).
   */
  labelledAs: 'agreement' | 'consistency';
  /** The weakest independence rung present, which the label is read from. */
  weakestIndependence: string;
  /** Units (alternatives) with at least two pairable values. */
  pairableUnits: number;
  /** Pairable values across those units. */
  pairableValues: number;
  /** Alternatives left out because the criterion is structurally absent for them. */
  structuralExcluded: number;
  /**
   * Terminal absences -- answers, not outstanding work -- absent from the value
   * domain and counted here, keyed by the core code each is or refines.
   */
  absentCounted: Record<string, number>;
  /** Non-terminal absences (nobody has looked yet, deferred), absent and counted. */
  outstanding: number;
}

export interface AgreementResult {
  measure: string;
  /** One entry per criterion. There is deliberately no matrix-wide figure. */
  criteria: CriterionAgreement[];
  /** Criteria with no ordered or nominal measurement for `measure`, and why. */
  skipped: { criterionId: string; reason: string }[];
  /** In-scope cells a disclosure projection widened for this reader (ADR-0021). */
  widenedByDisclosure: number;
  notes: string[];
}

export interface AgreementOptions {
  measure: string;
  alternativeIds?: readonly string[];
  criterionIds?: readonly string[];
  /** The z of the jackknife interval. Default 1.96 (95%). */
  z?: number;
  /** Band edges; configuration with a default, never a literal in the algorithm. */
  bands?: { lower: number; upper: number };
}

/** The core code a missingness code is, or refines through its `broader` chain. */
function coreAncestor(code: string, declared: readonly { id: string; broader: string }[]): string | undefined {
  let at = code;
  for (let depth = 0; depth < 16; depth += 1) {
    if (Object.prototype.hasOwnProperty.call(CORE_MISSING_CODES, at)) return at;
    const d = declared.find((x) => x.id === at);
    if (!d) return undefined;
    at = d.broader;
  }
  return undefined;
}

/** Order-preserving rank of a value on an ordinal measurement. */
function rankOf(v: ScalarValue, m: Measurement): number | undefined {
  if (m.levels && m.levels.length > 0) {
    const i = m.levels.findIndex((l) => l === v);
    return i >= 0 ? i : undefined;
  }
  return typeof v === 'number' ? v : undefined;
}

/**
 * Krippendorff's alpha for every criterion in scope, with its interval, band,
 * label and missingness accounting.
 */
export function agreement(a: Analysis, opts: AgreementOptions): AgreementResult {
  const { measure } = opts;
  const bands = opts.bands ?? { lower: KRIPPENDORFF_BANDS.lower, upper: KRIPPENDORFF_BANDS.upper };
  const alts = opts.alternativeIds ?? a.alternatives.filter((x) => !x.tombstoned).map((x) => x.id);
  const crits = opts.criterionIds ?? a.criteria.filter((x) => !x.tombstoned).map((x) => x.id);
  const index = cellIndex(a);
  const inapplicable = makeInapplicability(a);
  const vocabulary = vocabularyOf(a);
  const out: CriterionAgreement[] = [];
  const skipped: { criterionId: string; reason: string }[] = [];
  let widenedByDisclosure = 0;

  for (const critId of crits) {
    const crit = a.criteria.find((c) => c.id === critId);
    const m = crit ? measurementFor(crit, measure) : undefined;
    if (!m) { skipped.push({ criterionId: critId, reason: `no measurement for "${measure}"` }); continue; }
    const metric = metricFor(m.level);
    const declared = vocabulary.declarationsFor(critId);
    const units: (number | string)[][] = [];
    // The weakest independence rung of each unit's contributing assertions,
    // after collapsing personas *within the unit*: one rater coding many
    // alternatives is the design, not a repeat.
    const unitRungs: string[] = [];
    const absentCounted: Record<string, number> = {};
    let structuralExcluded = 0;
    let outstanding = 0;
    let unscaled = 0;

    for (const altId of alts) {
      if (inapplicable(altId, critId)) { structuralExcluded += 1; continue; }
      const cell = index.get(cellKey(altId, critId, measure));
      if (!cell) { outstanding += 1; continue; }
      if (isWidenedByDisclosure(cell)) widenedByDisclosure += 1;
      // Live observations only. A consensus assertion is an agreed value, not
      // one more observation, so it never enters an agreement statistic.
      const live = cell.assertions.filter((s) => !s.supersededBy && s.independence !== 'consensus');
      const facts = live.map((s) => (s.missing ? vocabulary.resolve(s.missing.code, critId).facts : undefined));
      if (facts.some((f) => f?.structural)) { structuralExcluded += 1; continue; }
      const values: (number | string)[] = [];
      const contributing: Assertion[] = [];
      live.forEach((s, i) => {
        if (s.value !== undefined) {
          const v = metric === 'nominal' ? String(s.value)
            : metric === 'ordinal' ? rankOf(s.value, m)
              : typeof s.value === 'number' ? s.value : undefined;
          if (v === undefined) { unscaled += 1; return; }
          values.push(v);
          contributing.push(s);
        } else if (s.missing) {
          const f = facts[i];
          if (f?.terminal) {
            const root = coreAncestor(s.missing.code, declared) ?? s.missing.code;
            absentCounted[root] = (absentCounted[root] ?? 0) + 1;
          } else {
            outstanding += 1;
          }
        }
      });
      units.push(values);
      if (values.length >= 2) unitRungs.push(effectiveIndependence(contributing, a.authors));
    }

    const pairable = units.filter((u) => u.length >= 2);
    const ladder: readonly string[] = Independence.options;
    const weakest = unitRungs.length === 0 || unitRungs.includes('unknown') ? 'unknown'
      : unitRungs.reduce((w, r) => (ladder.indexOf(r) < ladder.indexOf(w) ? r : w));
    const labelledAs = weakest === 'independent' ? 'agreement' : 'consistency';
    const alpha = krippendorffAlpha(units, metric);
    const jk = jackknifeInterval(units, metric, opts.z !== undefined ? { z: opts.z } : {});
    const reasons: string[] = [];
    if (alpha === undefined) {
      reasons.push(pairable.length === 0
        ? 'no alternative has two or more values for this criterion, so nothing is pairable.'
        : 'every pairable value is identical, so there is no expected disagreement to correct against.');
    } else if (jk.reason) {
      reasons.push(`no interval: ${jk.reason}`);
    }
    if (labelledAs === 'consistency' && unitRungs.length > 0) {
      reasons.push(weakest === 'unknown'
        ? 'labelled consistency: some contributing assertion records no independence, and unknown is not independent.'
        : `labelled consistency: the weakest independence rung present is "${weakest}", so this measures ` +
          'self-consistency or test-retest reliability, not agreement between raters.');
    }
    if (unscaled > 0) reasons.push(`${unscaled} value(s) not on the declared scale were left out.`);

    out.push({
      criterionId: critId,
      metric,
      alpha,
      interval: jk.interval,
      standardError: jk.standardError,
      reason: reasons.length > 0 ? reasons.join(' ') : undefined,
      band: alpha === undefined ? undefined : {
        position: alpha >= bands.upper ? 'at-or-above-upper' : alpha >= bands.lower ? 'between' : 'below-lower',
        edges: { lower: bands.lower, upper: bands.upper },
        source: KRIPPENDORFF_BANDS.source,
      },
      labelledAs,
      weakestIndependence: weakest,
      pairableUnits: pairable.length,
      pairableValues: pairable.reduce((s, u) => s + u.length, 0),
      structuralExcluded,
      absentCounted,
      outstanding,
    });
  }

  const notes = [
    'Alpha is per criterion over alternatives as units; there is no agreement figure for the whole ' +
      'matrix, because criteria differ in scale, raters and missing data (ADR-0022).',
  ];
  if (widenedByDisclosure > 0) {
    notes.push(`computed with ${widenedByDisclosure} cell${widenedByDisclosure === 1 ? '' : 's'} withheld from you.`);
  }
  return { measure, criteria: out, skipped, widenedByDisclosure, notes };
}

/**
 * The shape of one cell's ratings -- what ADR-0022 reports **instead of** a
 * per-cell coefficient, which over two to five assertions has nothing to
 * chance-correct against.
 *
 * Ordinal-legal only (ADR-0003): counts, extremes and modes, never a mean.
 * `levels` is the declared ordered level list; values off it are ignored.
 * `polarised` means two or more occupied levels separated by at least `gap`
 * empty levels with no single dominant mode; `gap` is configuration with a
 * default, never a literal in the rule.
 */
export interface CellShape {
  n: number;
  /** Count per declared level, in level order. */
  multiset: { level: ScalarValue; count: number }[];
  min?: ScalarValue | undefined;
  max?: ScalarValue | undefined;
  /** Distance between min and max in ordinal steps. */
  span: number;
  modes: ScalarValue[];
  polarised: boolean;
}

export function cellShape(
  values: readonly ScalarValue[],
  levels: readonly ScalarValue[],
  { gap = 1 }: { gap?: number } = {},
): CellShape {
  const counts = levels.map((level) => ({ level, count: values.filter((v) => v === level).length }));
  const occupied = counts.map((c, i) => (c.count > 0 ? i : -1)).filter((i) => i >= 0);
  const n = occupied.reduce((s, i) => s + counts[i]!.count, 0);
  const top = Math.max(0, ...counts.map((c) => c.count));
  const modes = n === 0 ? [] : counts.filter((c) => c.count === top).map((c) => c.level);
  const lo = occupied[0];
  const hi = occupied[occupied.length - 1];
  let widestGap = 0;
  for (let i = 1; i < occupied.length; i += 1) widestGap = Math.max(widestGap, occupied[i]! - occupied[i - 1]! - 1);
  return {
    n,
    multiset: counts,
    min: lo === undefined ? undefined : levels[lo],
    max: hi === undefined ? undefined : levels[hi],
    span: lo === undefined || hi === undefined ? 0 : hi - lo,
    modes,
    polarised: occupied.length >= 2 && widestGap >= gap && modes.length !== 1,
  };
}
