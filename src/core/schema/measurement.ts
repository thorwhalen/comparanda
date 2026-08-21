/**
 * Levels of measurement, direction of preference, ranges and thresholds.
 *
 * This module is what lets the tooling *refuse* an illegal operation rather than
 * merely regret it. Two facts hang off every (criterion, measure) pair:
 *
 *   - its **level of measurement** (Stevens), which decides what arithmetic is
 *     legal -- most importantly that a 1-5 rating is ordinal and averaging it is
 *     a category error, not a rounding concern (ADR-0003);
 *   - its **direction of preference**, without which dominance ("performs at
 *     least as well as") and screening ("falls below") are not definable at all
 *     (ADR-0018).
 *
 * The second was missing from the original domain model. We adopted the word
 * "criterion", which in the MCDA tradition means an attribute *plus* a direction
 * of preference, while modelling a bare attribute -- so ADR-0015's two flagship
 * analyses were undefined. See `docs/research/findings-terminology.md`.
 */
import * as z from 'zod/mini';

/**
 * Stevens's levels. The order matters: each level admits every operation the
 * ones above it admit, plus its own.
 *
 * - `nominal`   equality, grouping, counting. A boolean is a two-level nominal.
 * - `ordinal`   the above, plus ranking, median, min/max. **Not** the mean.
 * - `interval`  the above, plus differences and means. No true zero.
 * - `ratio`     the above, plus ratios. A cost, a count, a duration.
 */
export const LevelOfMeasurement = z.enum(['nominal', 'ordinal', 'interval', 'ratio']);
export type LevelOfMeasurement = z.infer<typeof LevelOfMeasurement>;

/** Levels on which a numeric mean is a legal operation. */
const MEAN_LEGAL: ReadonlySet<LevelOfMeasurement> = new Set<LevelOfMeasurement>(['interval', 'ratio']);

/**
 * Whether taking an arithmetic mean over values at this level is legal.
 *
 * Exported because the refusal has to be checkable by callers, not buried in an
 * analysis. ADR-0015's no-default-aggregation stance is downstream of this.
 */
export function meanIsLegal(level: LevelOfMeasurement): boolean {
  return MEAN_LEGAL.has(level);
}

/** Whether values at this level can be ordered at all (and so ranked, or dominated). */
export function isOrdered(level: LevelOfMeasurement): boolean {
  return level !== 'nominal';
}

/**
 * Direction of preference for a (criterion, measure).
 *
 * - `increasing`  higher is better. The common case, and the one that gets
 *                 silently assumed everywhere when it is not declared.
 * - `decreasing`  lower is better. A cost, a latency, a risk.
 * - `target`      a declared value is best and deviation either way is worse.
 * - `ordered`     the values are ordered but no direction is preferred; ranking
 *                 is legal, dominance is not.
 * - `none`        no preference relation exists. Nominal categories live here.
 *
 * `none` and `ordered` are *excluded from dominance by construction*, and any
 * analysis that excludes them must say which ones it excluded -- a silent
 * exclusion is how a Pareto front comes to mean something other than it says.
 */
export const Preference = z.enum(['increasing', 'decreasing', 'target', 'ordered', 'none']);
export type Preference = z.infer<typeof Preference>;

/** Whether a preference direction admits a dominance comparison. */
export function admitsDominance(pref: Preference): boolean {
  return pref === 'increasing' || pref === 'decreasing' || pref === 'target';
}

/**
 * The declared range of a (criterion, measure).
 *
 * Required on every ordered level, and it does three separate jobs that are easy
 * to conflate:
 *
 *   1. it supplies the interval bounds a *contingently missing* cell widens to,
 *      which is what makes dominance over incomplete data a partial order
 *      (ADR-0019);
 *   2. it normalises without rank reversal, because normalising against observed
 *      extrema means adding an alternative can change the ranking of the others;
 *   3. it gives an elicited weight a meaning -- "how much does this criterion
 *      matter" is unanswerable until "across what span" is fixed.
 *
 * Note there is deliberately no `direction` field here. Direction is a property
 * of the preference, not of the range, and putting it in both is how they come
 * to disagree.
 */
export const Range = z.object({
  min: z.number(),
  max: z.number(),
  /** For `target` preference: the value that is best. Must lie within [min, max]. */
  target: z.optional(z.number()),
  /** Human-facing unit, e.g. "USD/month", "ms", "1-5". Never parsed. */
  unit: z.optional(z.string()),
});
export type Range = z.infer<typeof Range>;

/**
 * Thresholds, in the ELECTRE sense, expressed in the criterion's own units --
 * or, on an ordinal scale, in number of levels.
 *
 * - `indifference` (q): a difference at or below this is not a real difference.
 *   Dominance without it "is rare" in practice and will usually report that
 *   nothing is dominated, which reads as a broken feature rather than a finding.
 * - `preference` (p): a difference at or above this is a strong preference.
 *
 * Note what is deliberately **not** here: a veto threshold. ADR-0015 originally
 * claimed comparanda's "veto criterion with a threshold" was ELECTRE's veto.
 * It is not. ELECTRE's veto bounds the *difference between two alternatives* on
 * one criterion; comparanda's concept is an *absolute floor* on an alternative's
 * own value -- a conjunctive screening rule. They are different fields answering
 * different questions, so the floor lives on the criterion as `acceptability`
 * and the name `veto` is reserved for the ELECTRE sense if it is ever needed.
 */
export const Thresholds = z.object({
  indifference: z.optional(z.number()),
  preference: z.optional(z.number()),
});
export type Thresholds = z.infer<typeof Thresholds>;

/**
 * A conjunctive screening rule: an absolute floor (or ceiling) below which the
 * alternative is flagged regardless of how it scores elsewhere.
 *
 * This is what people mean by "if we can't reach the buyer, the market size is
 * irrelevant". It is non-compensatory by design -- that is the point of it --
 * and it is *flagging*, never filtering: the alternative stays in the matrix and
 * stays visible, because an analysis that silently drops rows is not auditable.
 */
export const Acceptability = z.object({
  /** The floor, in the criterion's units. Interpreted against `preference`. */
  threshold: z.number(),
  /** Why this floor. Required, because an unexplained floor is unarguable. */
  rationale: z.string(),
});
export type Acceptability = z.infer<typeof Acceptability>;

/**
 * The full measurement declaration for one (criterion, measure) pair.
 *
 * Declared per pair rather than per criterion because a criterion routinely
 * carries a 1-5 ordinal `score` and a three-level ordinal `confidence` at once,
 * and they are not the same scale. A per-criterion default keeps the common case
 * terse -- see `Criterion.defaultMeasurement`.
 */
export const Measurement = z.object({
  level: LevelOfMeasurement,
  preference: Preference,
  /** Required whenever `level` is ordered; validated by `validateMeasurement`. */
  range: z.optional(Range),
  thresholds: z.optional(Thresholds),
  acceptability: z.optional(Acceptability),
  /**
   * For nominal and ordinal levels: the permitted values, in order. The order is
   * the ordering for `ordinal`, and is display order only for `nominal`.
   */
  levels: z.optional(z.array(z.union([z.string(), z.number()]))),
});
export type Measurement = z.infer<typeof Measurement>;

export interface MeasurementProblem {
  path: string;
  message: string;
}

/**
 * Structural checks a schema type cannot express.
 *
 * Kept as a separate function rather than a refinement so that callers can run
 * it over a partially-built analysis and get *all* the problems, which is what
 * an authoring UI needs, rather than the first one.
 */
export function validateMeasurement(m: Measurement, path = ''): MeasurementProblem[] {
  const problems: MeasurementProblem[] = [];
  const at = (s: string) => (path ? `${path}.${s}` : s);

  if (isOrdered(m.level) && !m.range) {
    problems.push({
      path: at('range'),
      message:
        `level "${m.level}" is ordered, so a range is required. ` +
        'Refusing rather than inferring from observed extrema: inferred bounds change ' +
        'when an alternative is added, which silently reorders the others.',
    });
  }

  if (m.range) {
    if (m.range.min >= m.range.max) {
      problems.push({ path: at('range'), message: `min (${m.range.min}) must be < max (${m.range.max})` });
    }
    if (m.preference === 'target') {
      if (m.range.target === undefined) {
        problems.push({ path: at('range.target'), message: 'preference "target" requires range.target' });
      } else if (m.range.target < m.range.min || m.range.target > m.range.max) {
        problems.push({ path: at('range.target'), message: 'range.target must lie within [min, max]' });
      }
    }
  }

  if (m.level === 'nominal' && m.preference !== 'none') {
    problems.push({
      path: at('preference'),
      message: `nominal values have no order, so preference must be "none" (got "${m.preference}")`,
    });
  }

  if (m.thresholds && m.level === 'nominal') {
    problems.push({ path: at('thresholds'), message: 'thresholds are meaningless on a nominal level' });
  }

  if (m.acceptability && !admitsDominance(m.preference)) {
    problems.push({
      path: at('acceptability'),
      message: `an acceptability floor needs a direction of preference (got "${m.preference}")`,
    });
  }

  if ((m.level === 'nominal' || m.level === 'ordinal') && !m.levels) {
    problems.push({
      path: at('levels'),
      message: `level "${m.level}" requires an explicit list of permitted values`,
    });
  }

  return problems;
}

/**
 * Whether `a` is at least as good as `b` on this measurement.
 *
 * Undefined -- and returns `undefined` rather than guessing -- when the
 * preference admits no dominance comparison.
 */
export function atLeastAsGood(m: Measurement, a: number, b: number): boolean | undefined {
  switch (m.preference) {
    case 'increasing':
      return a >= b;
    case 'decreasing':
      return a <= b;
    case 'target': {
      const t = m.range?.target;
      if (t === undefined) return undefined;
      return Math.abs(a - t) <= Math.abs(b - t);
    }
    default:
      return undefined;
  }
}
