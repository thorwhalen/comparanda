/**
 * Who asserted a thing, and under what procedure.
 *
 * Provenance is distinct from evidence and the two must not be conflated
 * (ADR-0014): provenance is *who said this and when*, evidence is *what supports
 * it*. Both are stored; they answer different questions and a reader needs both.
 *
 * The load-bearing field in this module is `independence`. Without it, five
 * samples drawn from one model render identically to five human raters who
 * argued in a room -- and an agreement statistic computed over the first is
 * meaningless while the same statistic over the second is the most valuable
 * number on the page. A tool that cannot tell them apart will confidently
 * report one as the other.
 */
import * as z from 'zod/mini';

/**
 * Human or machine, distinguishable at a glance. ADR-0012 calls this a primary
 * requirement of the whole system, not an afterthought: a reader deciding how
 * much to trust a score needs to know whether a person or a model asserted it.
 */
export const AuthorKind = z.enum(['human', 'agent', 'imported', 'derived']);
export type AuthorKind = z.infer<typeof AuthorKind>;

/**
 * An identity, as asserted by the host. `comparanda` never authenticates
 * anybody (ADR-0012); it consumes what it is given and is honest about the fact
 * that a local identity is unverified.
 */
export const Author = z.object({
  id: z.string(),
  displayName: z.string(),
  kind: AuthorKind,
  /** Present when `kind` is `agent`. What actually produced the value. */
  agent: z.optional(
    z.object({
      /** The agent's name, e.g. a tool that produces analyses. */
      name: z.string(),
      /** Model identifier, verbatim as reported by the provider. */
      model: z.optional(z.string()),
      /** Version of the prompt that produced this. Changes behaviour; record it. */
      promptVersion: z.optional(z.string()),
      /** Opaque id for the run, so a whole run can be found or retracted. */
      runId: z.optional(z.string()),
    }),
  ),
  avatarUrl: z.optional(z.string()),
  role: z.optional(z.string()),
});
export type Author = z.infer<typeof Author>;

/**
 * How independent this assertion is from the others in its cell. **This is the
 * field that stops five draws of one model being counted as five raters.**
 *
 * A ladder, weakest first:
 *
 * - `shared-context`   produced in the same conversation or transcript as other
 *                      assertions here. Prior judgements were visible, or at
 *                      least present. Correlation is expected and an agreement
 *                      statistic over these is not measuring agreement.
 * - `resampled`        a fresh draw from the same model and prompt. Independent
 *                      of the *other draws' text* but not of the model's priors.
 * - `perturbed`        deliberately varied -- a different traversal order, a
 *                      shuffled presentation, a withheld prior score. See
 *                      `perturbation` for what was varied.
 * - `independent`      a genuinely separate assessor: a different person, or a
 *                      different model with no shared context.
 * - `consensus`        not an independent observation at all -- an agreed value
 *                      that supersedes the assertions it was derived from.
 *
 * Agreement statistics must be computed only over `independent` assertions, and
 * must say so when they exclude others.
 */
export const Independence = z.enum([
  'shared-context',
  'resampled',
  'perturbed',
  'independent',
  'consensus',
]);
export type Independence = z.infer<typeof Independence>;

/** Whether assertions at this level may enter an inter-rater agreement statistic. */
export function countsAsIndependentRater(i: Independence): boolean {
  return i === 'independent';
}

/**
 * What was deliberately varied, when `independence` is `perturbed`.
 *
 * Recorded because "we varied something" is not reproducible and because the
 * *point* of perturbing is to convert a systematic order effect into random
 * noise that averaging can remove -- which only works if you know it happened.
 */
export const Perturbation = z.object({
  /** e.g. "traversal-order", "option-order", "prior-withheld". */
  kind: z.string(),
  /** The seed, where one was used. Makes the run reproducible. */
  seed: z.optional(z.union([z.string(), z.number()])),
  detail: z.optional(z.string()),
});
export type Perturbation = z.infer<typeof Perturbation>;

/**
 * The procedure that produced a set of assertions.
 *
 * Lives on the analysis, not the cell, because it describes a *run*. Without it,
 * a reader cannot tell whether `k = 5` assertions mean "we asked five people" or
 * "we sampled one model five times at temperature 0.7", which is the difference
 * between a finding and an artefact.
 */
export const Procedure = z.object({
  id: z.string(),
  describedAs: z.string(),
  /** Repeats per cell, where the procedure sampled repeatedly. */
  repeats: z.optional(z.number()),
  /** How repeated assertions were reduced for display. */
  reduction: z.optional(z.string()),
  /** Traversal used, e.g. "cell-wise", "column-wise". Changes results measurably. */
  traversal: z.optional(z.string()),
  temperature: z.optional(z.number()),
  startedAt: z.optional(z.string()),
  finishedAt: z.optional(z.string()),
  notes: z.optional(z.string()),
});
export type Procedure = z.infer<typeof Procedure>;

/**
 * A round of a multi-round elicitation, in the Delphi sense.
 *
 * Optional, and roughly fifteen schema lines. It is here from v1 because round
 * boundaries cannot be reconstructed after the fact: if assertions from round 1
 * and round 2 are stored indistinguishably, the revision -- which is the entire
 * information content of a Delphi process -- is gone.
 */
export const Round = z.object({
  id: z.string(),
  index: z.number(),
  label: z.optional(z.string()),
  /** Whether raters saw others' assertions before making their own. */
  feedback: z.optional(z.enum(['none', 'anonymous-summary', 'full'])),
  /** Whether authorship was visible to other raters during this round. */
  attribution: z.optional(z.enum(['anonymous', 'attributed'])),
  openedAt: z.optional(z.string()),
  closedAt: z.optional(z.string()),
});
export type Round = z.infer<typeof Round>;
