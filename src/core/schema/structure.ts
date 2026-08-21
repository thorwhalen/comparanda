/**
 * The two axes and their grouping: alternatives, criteria, groups.
 *
 * The vocabulary is MCDA's, deliberately (ADR-0003): a field fifty years old
 * already named these things, and taking its names means the literature reads
 * without translation. Display aliases let a deployment say "options and
 * requirements" without the data changing.
 */
import * as z from 'zod/mini';
import { Measurement, Acceptability } from './measurement.js';

/** A thing being compared. A row, by convention. */
export const Alternative = z.object({
  id: z.string(),
  label: z.string(),
  description: z.optional(z.string()),
  /** Group ids. Membership is many-to-many: groups are tags, not a partition. */
  groupIds: z._default(z.array(z.string()), []),
  /**
   * Retained rather than deleted when it carries annotations or assertions.
   * A hard delete orphans every anchor pointing at it, and the record of why a
   * thing was dropped is usually worth more than the row it occupied.
   */
  tombstoned: z.optional(z.boolean()),
  supersededBy: z.optional(z.array(z.string())),
});
export type Alternative = z.infer<typeof Alternative>;

/**
 * What a criterion *means*, in enough detail to be scored consistently.
 *
 * Free text is not enough. An undefined criterion gets scored inconsistently by
 * different raters and by the same rater on different days, and the
 * inconsistency is invisible until someone tries to reproduce a score. Every
 * field here exists because its absence produced a real disagreement:
 *
 * - `objective`   what underlying goal this serves. Criteria derived from
 *                 objectives beat criteria derived from whatever the
 *                 alternatives happen to differ on.
 * - `question`    the question a rater answers. Phrasing it as a question is
 *                 what makes "high" and "low" mean the same thing twice.
 * - `anchors`     what each level *means*. Described levels beat bare numbers.
 * - `evidenceRule` what counts as support here. Prevents "I read something once".
 * - `missingRule`  when to record an absence rather than reach for a number.
 *                  This is where the honesty rule becomes criterion-specific.
 * - `exclusions`  what this criterion deliberately does *not* cover, which is
 *                 how you stop two criteria quietly measuring the same thing.
 */
export const CriterionDefinition = z.object({
  objective: z.optional(z.string()),
  question: z.optional(z.string()),
  /** Level value -> what that level means. Keys match `Measurement.levels`. */
  anchors: z.optional(z.record(z.string(), z.string())),
  evidenceRule: z.optional(z.string()),
  missingRule: z.optional(z.string()),
  exclusions: z.optional(z.array(z.string())),
});
export type CriterionDefinition = z.infer<typeof CriterionDefinition>;

/** Where a criterion came from. Criteria deserve the discipline values get. */
export const CriterionProvenance = z.object({
  origin: z.enum(['user-stated', 'derived-from-source', 'agent-proposed', 'imported']),
  authorId: z.optional(z.string()),
  at: z.optional(z.string()),
  /** Evidence ref ids, when the criterion was derived from a source. */
  derivedFrom: z._default(z.array(z.string()), []),
  rationale: z.optional(z.string()),
});
export type CriterionProvenance = z.infer<typeof CriterionProvenance>;

/**
 * Two kinds of weight, never one field.
 *
 * They are different quantities and collapsing them is why weighted totals so
 * often mean nothing:
 *
 * - `substitution` is a rate of exchange: how much of criterion A compensates
 *   for a unit of criterion B. It is only meaningful alongside a declared range
 *   ("important" is unanswerable until "across what span" is fixed), and it is
 *   what a weighted sum actually requires.
 * - `voting` is stated importance: how much this criterion matters to whoever
 *   is deciding. It is what people give you when you ask for a weight, and it
 *   is *not* a substitution rate.
 *
 * Naming them apart costs nothing now and is a migration through every stored
 * analysis later.
 */
export const Weights = z.object({
  substitution: z.optional(z.number()),
  voting: z.optional(z.number()),
  /** Who set them and why; a weight nobody owns is a weight nobody defends. */
  setBy: z.optional(z.string()),
  rationale: z.optional(z.string()),
});
export type Weights = z.infer<typeof Weights>;

/** A thing alternatives are compared on. A column, by convention. */
export const Criterion = z.object({
  id: z.string(),
  label: z.string(),
  definition: z.optional(CriterionDefinition),
  provenance: z.optional(CriterionProvenance),
  /**
   * Measurement per measure name, e.g. `{ score: {...}, confidence: {...} }`.
   * `defaultMeasurement` covers the common case where every measure on this
   * criterion shares a declaration.
   */
  measurements: z._default(z.record(z.string(), Measurement), {}),
  defaultMeasurement: z.optional(Measurement),
  acceptability: z.optional(Acceptability),
  weights: z.optional(Weights),
  groupIds: z._default(z.array(z.string()), []),
  tombstoned: z.optional(z.boolean()),
  supersededBy: z.optional(z.array(z.string())),
  /**
   * The version of the criteria set at which this criterion last changed
   * meaning. An assertion records the version it was scored against, so a
   * criterion whose definition moved does not silently re-interpret old scores.
   */
  definedInVersion: z.optional(z.string()),
});
export type Criterion = z.infer<typeof Criterion>;

/** Resolve the measurement for a (criterion, measure), honouring the default. */
export function measurementFor(criterion: Criterion, measure: string): Measurement | undefined {
  return criterion.measurements[measure] ?? criterion.defaultMeasurement;
}

/**
 * A criterion that was proposed and rejected, retained with its reason.
 *
 * Kept in the analysis because "why isn't cost in here?" is asked in every
 * review, and an answer that lives only in someone's memory gets re-litigated
 * every time.
 */
export const RejectedCriterion = z.object({
  label: z.string(),
  reason: z.string(),
  reasonCode: z.optional(
    z.enum(['redundant', 'not-discriminating', 'out-of-scope', 'not-assessable', 'merged', 'other']),
  ),
  /** For `merged` and `redundant`: the criterion it was folded into. */
  mergedIntoId: z.optional(z.string()),
  proposedBy: z.optional(z.string()),
  at: z.optional(z.string()),
});
export type RejectedCriterion = z.infer<typeof RejectedCriterion>;

/** A named set of alternatives or criteria. Groups are data; selection is not. */
export const Group = z.object({
  id: z.string(),
  label: z.string(),
  axis: z.enum(['alternatives', 'criteria']),
  /** Nesting is permitted in the schema; a view may render one level. */
  parentId: z.optional(z.string()),
  description: z.optional(z.string()),
  color: z.optional(z.string()),
});
export type Group = z.infer<typeof Group>;

/**
 * A declaration that a criteria group does not apply to an alternatives group.
 *
 * Auto-populates that whole block with `not-applicable` and lets the view omit
 * it entirely rather than rendering a rectangle of blanks -- which is both
 * clearer and, at scale, the difference between a legible matrix and a wall.
 */
export const InapplicableBlock = z.object({
  alternativeGroupId: z.string(),
  criterionGroupId: z.string(),
  reason: z.optional(z.string()),
});
export type InapplicableBlock = z.infer<typeof InapplicableBlock>;

/** Per-analysis display aliases. Never hard-code the internal words into a UI. */
export const Aliases = z.object({
  alternative: z._default(z.string(), 'alternative'),
  alternatives: z._default(z.string(), 'alternatives'),
  criterion: z._default(z.string(), 'criterion'),
  criteria: z._default(z.string(), 'criteria'),
});
export type Aliases = z.infer<typeof Aliases>;
