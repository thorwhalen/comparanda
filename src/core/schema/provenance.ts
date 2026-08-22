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
/**
 * How well the host knows the identity it asserted.
 *
 * `comparanda` never authenticates anybody (ADR-0012); it consumes what it is
 * given. This field is what stops that consumption being mistaken for a claim.
 *
 * - `unverified`  a name somebody typed. The honest default, and what a host
 *                 that asserts nothing leaves in place.
 * - `session`     the host's own session, whatever that is worth there.
 * - `oauth`       an external identity provider vouched for it.
 * - `signed`      a cryptographic signature travels with the assertion.
 *
 * It is a **disclosure, never a control**. Nothing in this package refuses an
 * assertion for being `unverified`, because the alternative is a permission
 * model this package has no business having. What it does is make the reader's
 * question -- how much is this attribution worth -- answerable.
 */
export const AttestationMethod = z.enum(['unverified', 'host-session', 'oauth', 'signature']);
export type AttestationMethod = z.infer<typeof AttestationMethod>;

/**
 * How the identity was established, and by whom.
 *
 * An object rather than a bare enum, because `oauth` on its own is half a fact:
 * "vouched for by an identity provider" is only worth something once you know
 * *which* provider, and "signed" is worth nothing without knowing when. A reader
 * deciding how much an attribution is worth needs the issuer and the moment, and
 * a field that cannot carry them invites the reader to assume.
 */
export const Attestation = z.object({
  method: AttestationMethod,
  /** Who vouched: an identity provider, a signing key id, a host name. */
  issuer: z.optional(z.string()),
  /** When the identity was established. */
  at: z.optional(z.string()),
});
export type Attestation = z.infer<typeof Attestation>;

export const Author = z.object({
  id: z.string(),
  displayName: z.string(),
  kind: AuthorKind,
  /**
   * Who is actually behind this author, when the author is a persona.
   *
   * A persona is a **materialised `Author` of its own** -- it has an id, a
   * display name and a kind, and assertions reference it like any other author.
   * What makes it a persona is this field pointing at the principal.
   *
   * The practice it exists for is real and good: scoring a matrix once as the
   * operator and once as the buyer surfaces disagreements a single pass hides.
   * The representation has to make that possible without letting it become
   * three other things, so (ADR-0012's 2026-08-22 amendment):
   *
   *   - it is **not anonymity**. The principal is in the document and is not
   *     hidden from readers. Someone wanting to contribute unattributed uses the
   *     anonymous session, and gets what that honestly offers. A persona that a
   *     contributor *believed* was concealing them is the worst outcome here, so
   *     it conceals nothing.
   *   - it is **not an independence rung**. See `effectiveIndependence`.
   *   - it **never changes `kind`**. An agent asked to reason as the buyer is
   *     still `agent`, with model, prompt version and run id unchanged.
   *   - it is **declared, never inferred** from what was written.
   *
   * The linkage is pseudonymous rather than anonymous, and inside a small team
   * the mapping is guessable, because the set of accounts is small and known.
   * That must never be described to a contributor as though it hid them from a
   * colleague.
   */
  principalId: z.optional(z.string()),
  /**
   * The perspective this persona is taking, in the contributor's own words --
   * "scored as the buyer, not the operator".
   *
   * Optional, and worth writing: it is the context that makes a divergence
   * between two of one person's personas readable rather than confusing.
   */
  actingAs: z.optional(z.string()),
  /**
   * How well the host knows this identity. Absent reads as `unverified`, which
   * is the honest default for a host that asserts nothing.
   */
  attestation: z.optional(Attestation),
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

/**
 * Whether an assertion at this rung may enter an inter-rater agreement statistic.
 *
 * Takes `undefined` because the field is optional and absent means *unknown
 * independence* -- which must not count. Anything other than a recorded
 * `independent` is excluded, so the safe answer is the default answer rather
 * than something a caller has to remember.
 */
export function countsAsIndependentRater(i: Independence | undefined): boolean {
  return i === 'independent';
}

/**
 * The most cautious reading of a set of assertions: the weakest rung any of
 * them records, with an unrecorded rung counting as weaker than all of them.
 *
 * An agreement statistic must be labelled by this, not by the best rung
 * present -- one shared-context assertion in a set of five makes the whole set
 * correlated, and reporting it as agreement between five raters overstates it.
 */
export function weakestIndependence(
  assertions: readonly { independence?: Independence | undefined }[],
): Independence | 'unknown' {
  if (assertions.length === 0) return 'unknown';
  const rank: Record<Independence, number> = {
    'shared-context': 0, resampled: 1, perturbed: 2, independent: 3, consensus: 4,
  };
  // Any unrecorded rung short-circuits: one assertion whose independence nobody
  // wrote down makes the whole set's independence unknown, and no amount of
  // confidently-labelled company rescues it.
  let weakest: Independence = 'consensus';
  for (const a of assertions) {
    if (a.independence === undefined) return 'unknown';
    if (rank[a.independence] < rank[weakest]) weakest = a.independence;
  }
  return weakest;
}

/**
 * The independence of a set of assertions, **after collapsing personas that
 * share a principal**.
 *
 * This is the function an agreement statistic must use. `weakestIndependence`
 * answers "what is the weakest rung anybody recorded"; this one answers "and how
 * independent are these assertions really", which differs exactly when one
 * person has contributed under more than one name.
 *
 * One person scoring as the operator and again as the buyer may honestly record
 * `independent` on both -- they did not consult the other assertion. They are
 * still one head. Counting them as two raters is the manufactured rigour this
 * whole module exists to prevent, and it is *more* likely now that personas are
 * a supported practice than it was when nobody could sign under two names.
 *
 * The collapse is deliberately blunt: any principal contributing more than once
 * drags the whole set down to `resampled` -- independent of the other
 * assertions' text, not independent of the mind that produced them. That is the
 * same reading `resampled` already has for repeated draws from one model, which
 * is the closest true analogy.
 */
export function effectiveIndependence(
  assertions: readonly { independence?: Independence | undefined; authorId: string }[],
  authors: readonly { id: string; principalId?: string | undefined }[],
): Independence | 'unknown' {
  const recorded = weakestIndependence(assertions);
  if (recorded === 'unknown') return 'unknown';

  const principalOf = new Map(authors.map((a) => [a.id, a.principalId ?? a.id]));
  const counts = new Map<string, number>();
  for (const a of assertions) {
    const p = principalOf.get(a.authorId) ?? a.authorId;
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  const repeated = [...counts.values()].some((n) => n > 1);
  if (!repeated) return recorded;

  const rank: Record<Independence, number> = {
    'shared-context': 0, resampled: 1, perturbed: 2, independent: 3, consensus: 4,
  };
  return rank[recorded] > rank.resampled ? 'resampled' : recorded;
}

/**
 * How many distinct people or agents are behind a set of assertions.
 *
 * The number a reader actually wants beside an agreement statistic, and the one
 * that is wrong if you count authors. Two personas of one analyst are one.
 */
export function distinctPrincipals(
  assertions: readonly { authorId: string }[],
  authors: readonly { id: string; principalId?: string | undefined }[],
): number {
  const principalOf = new Map(authors.map((a) => [a.id, a.principalId ?? a.id]));
  return new Set(assertions.map((a) => principalOf.get(a.authorId) ?? a.authorId)).size;
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
