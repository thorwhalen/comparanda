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
import {
  declarationFields, resolveDeclaration,
  type Resolution,
} from './declarations.js';

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
 * `none` and `ordered` are *excluded from dominance by construction*, and so is
 * `target` in v1 (ADR-0019 clause 7: comparing by distance to the target needs a
 * metric, which smuggles a cardinal assumption back in). Any analysis that
 * excludes them must say which ones it excluded -- a silent exclusion is how a
 * Pareto front comes to mean something other than it says.
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
 * The closed core of scale families.
 *
 * One member, and that is not a placeholder. Everything a Stevens-family scale
 * varies by -- level, direction of preference, range, permitted levels,
 * thresholds -- is already a field of `Measurement`, and every scale-dependent
 * function in this package (`meanIsLegal`, `isOrdered`, `admitsDominance`,
 * `atLeastAsGood`, `validateMeasurement`) is a pure function of those fields.
 * So a reader that has never heard of a particular scale still validates it,
 * still dominates on it, still refuses a mean on it and still renders it.
 *
 * A second member becomes necessary only for a scale whose behaviour is *not* a
 * function of level and preference -- a Bradley-Terry latent strength, say,
 * where the stored number is derived rather than chosen. That one needs an
 * interpreter, and it attaches at the resolver, not at every call site.
 */
export const SCALE_CORE = z.enum(['stevens']);
export type ScaleCore = z.infer<typeof SCALE_CORE>;

/**
 * A named scale, declared in the document so a foreign reader knows what
 * produced the numbers in a column.
 *
 * The declaration does not carry the measurement itself -- `Measurement` already
 * does, on every criterion, as required fields. This says *which named scale the
 * author was working to*, which is what makes two analyses comparable on a
 * criterion, and what a degradation banner names when a build cannot interpret it.
 */
export const ScaleDeclaration = z.object(declarationFields(SCALE_CORE));
export type ScaleDeclaration = z.infer<typeof ScaleDeclaration>;

/**
 * The written conditions that earn each level of an ordinal scale.
 *
 * Anchors are **evidence conditions** -- "a source states a dated commitment" --
 * never evaluative adjectives like "excellent". An adjective is scored against
 * the reader's taste; a condition is scored against a document, which is the
 * only kind of anchor two people can argue about productively.
 */
export const AnchorSet = z.object({
  /**
   * Level value -> the evidence condition that earns it. Keyed by the string
   * form of the level, because JSON object keys are strings and a silent
   * number/string mismatch here would be invisible.
   */
  levels: z.record(z.string(), z.string()),
  /**
   * Hash of `canonicalAnchorJson(levels)`.
   *
   * A **change detector, not a comparability key**: ADR-0012's amendment moved
   * comparability onto the criterion's last *material* version, because a hash
   * cannot tell a boundary-moving edit from a typo fix. This is what tells the
   * tooling the text moved at all, and therefore what forces the author to
   * declare whether the move was material instead of editing silently.
   *
   * Supplied by the producer rather than computed here, so that the core stays
   * free of a crypto dependency and both languages hash the same bytes -- see
   * `canonicalAnchorJson`.
   */
  contentHash: z.string(),
  /**
   * Which levels the scale requires an anchor for.
   *
   * Stored in the document, and this is the point: a build that does not
   * implement the scale can still check the anchor set is complete **on the
   * scale's own terms**. The policy travels with the data instead of living in
   * a table the reader may not have.
   */
  requires: z._default(z.array(z.string()), []),
});
export type AnchorSet = z.infer<typeof AnchorSet>;

/**
 * What a build knows about a named scale.
 *
 * Deliberately thin, and that thinness is the finding rather than a shortcut:
 * everything a Stevens-family scale varies by is already on the `Measurement`,
 * as required fields, so there is nothing for a scale interpreter to supply that
 * a reader does not already have. What a scale name adds is *identity* -- which
 * named scale two analyses were authored to, and therefore whether they are
 * comparable on a criterion.
 */
export interface ScaleFacts {
  /** One line, for a reader whose build does not know this scale. */
  means: string;
}

const CORE_SCALES: Readonly<Record<string, ScaleFacts>> = Object.freeze({
  stevens: {
    means:
      'A Stevens-family scale, fully described by the measurement itself: its level, its ' +
      'direction of preference, its range and its permitted levels.',
  },
});

/**
 * Resolve a scale name through the one resolver.
 *
 * **An unknown scale degrades and does not refuse**, which is the opposite of
 * how an unknown reduction behaves, and the difference is worth being explicit
 * about because both are extension points on the same document.
 *
 * A reduction is a *computation*: running its parent produces a different number
 * and presents it as the author's, so the honest answer is to show nothing. A
 * scale is an *identity*: every behaviour that depends on it -- whether a mean
 * is legal, whether the column can be dominated, which direction is better -- is
 * already a pure function of `level`, `preference` and `range`, which are
 * required fields the reader has in hand. Degrading loses the *name*, not the
 * behaviour, so the column still validates, still dominates and still renders
 * correctly, and the reader is told which name it could not interpret.
 */
export function resolveScale(
  name: string,
  declarations: readonly ScaleDeclaration[] = [],
): Resolution<ScaleFacts> {
  return resolveDeclaration<ScaleFacts>(
    name,
    CORE_SCALES,
    declarations as readonly { id: string; broader: string; means: string }[],
    // A declaration is fully self-describing: its `means` is everything this
    // build needs, because the behaviour lives on the Measurement. So a declared
    // scale resolves rather than degrading -- the same property missingness has,
    // and for the same reason.
    (decl) => ({ means: decl.means }),
  );
}

/**
 * The exact bytes an anchor set hashes over.
 *
 * Both repositories must agree on this or every `contentHash` disagrees across
 * the boundary. Keys are sorted; there is no whitespace; the encoding is
 * `JSON.stringify`'s. Deliberately trivial, and deliberately written down.
 */
export function canonicalAnchorJson(levels: Readonly<Record<string, string>>): string {
  const sorted = Object.keys(levels).sort();
  return JSON.stringify(sorted.map((k) => [k, levels[k]]));
}

/**
 * Whether an anchor set satisfies what it says it requires.
 *
 * Runs **from the document alone**. No scale table is consulted, which is what
 * makes an unimplemented scale still checkable.
 */
export function anchorProblems(anchors: AnchorSet, path = 'anchors'): MeasurementProblem[] {
  const problems: MeasurementProblem[] = [];
  for (const level of anchors.requires) {
    const text = anchors.levels[level];
    if (text === undefined) {
      problems.push({
        path: `${path}.levels.${level}`,
        message: `this scale requires an anchor at level "${level}" and none is written. ` +
          'An unanchored level is scored against taste rather than against a document.',
      });
    } else if (text.trim() === '') {
      problems.push({
        path: `${path}.levels.${level}`,
        message: `the anchor at level "${level}" is empty. An empty anchor is worse than a missing ` +
          'one: it reads as satisfied.',
      });
    }
  }
  return problems;
}

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
  /**
   * The named scale this was authored to, if any.
   *
   * **Optional, and deliberately not defaulted.** A default would be a live bug:
   * a criterion authored as `{level: 'ratio', preference: 'decreasing', range:
   * {...}}` -- which validates with zero problems -- would be silently stamped
   * with the 1-5 ordinal scale, after which an interpreter would reject `4200`
   * and forbid a mean that is perfectly legal on a ratio level.
   *
   * Absent means "Stevens, as declared by `level`, `preference` and `range`",
   * which is exactly what every criterion meant before this field existed.
   */
  scale: z.optional(z.string()),
  /** The evidence conditions earning each level. Ordinal scales only. */
  anchors: z.optional(AnchorSet),
  /** Required whenever `level` is ordered; validated by `validateMeasurement`. */
  range: z.optional(Range),
  thresholds: z.optional(Thresholds),
  acceptability: z.optional(Acceptability),
  /**
   * For nominal and ordinal levels: the permitted values, in order. The order is
   * the ordering for `ordinal`, and is display order only for `nominal`.
   *
   * Booleans are permitted, and were not until a fixture needed one. This
   * module's own opening docstring says "a boolean is a two-level nominal", and
   * `ScalarValue` has always accepted one -- so a yes/no criterion could be
   * *asserted* and could not be *declared*, which is the kind of contradiction
   * that only shows up when someone writes the document the README asked for.
   */
  levels: z.optional(z.array(z.union([z.string(), z.number(), z.boolean()]))),
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

  if (m.anchors) {
    problems.push(...anchorProblems(m.anchors, at('anchors')));
    if (m.level !== 'ordinal') {
      problems.push({
        path: at('anchors'),
        message: `anchors describe what earns each level of an ordinal scale; level is "${m.level}"`,
      });
    }
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
