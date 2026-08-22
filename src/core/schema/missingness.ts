/**
 * Qualified absence. No bare nulls, ever (ADR-0009).
 *
 * In every comparison table that matters some cells are empty, and the reasons
 * are not interchangeable. "Does not apply" and "nobody has checked" look
 * identical in a spreadsheet and mean opposite things about whether the analysis
 * is finished.
 *
 * Three flags do the real work, and they are what analyses key on -- never the
 * literal code, so that an analysis keeps working when a deployment extends the
 * set:
 *
 *   - `structural`: the cell *should* be empty. It is excluded from completeness
 *     counts and removed from a dominance comparison entirely.
 *   - `terminal`: someone looked and this is the answer. Non-terminal absences
 *     are work outstanding.
 *   - `informative`: the absence is itself a statement about the *subject*, not
 *     about our process. `not-evidenced` says nobody documents this; `withheld`
 *     says we know and are not saying. Only the first tells a reader anything
 *     about the alternative, and `silenceRate` counts only that kind.
 *
 * The core set is closed and every extension declares a `broader` code inside
 * it, so "what is left to do" stays answerable across deployments. This is the
 * shape HL7/FHIR converged on for null flavours, and the reason to copy it is
 * that a flat extensible enum makes every consumer guess.
 */
import * as z from 'zod/mini';

/**
 * The closed core. An analysis may add codes, but each must name one of these as
 * its `broader`.
 *
 * - `not-applicable`  this criterion does not apply to this alternative --
 *                     often a whole group x group block. Structural, terminal.
 * - `not-assessed`    nobody has looked yet. The default for a new cell.
 * - `deferred`        deliberately left for now; someone was asked to skip it.
 * - `not-evidenced`   we looked and the sources are **silent**.
 * - `indeterminate`   we looked and the sources do **not settle it** -- they
 *                     conflict, or they underdetermine the level.
 * - `withheld`        known, but not shown here. Confidentiality, licensing.
 *
 * `not-evidenced` and `indeterminate` are the pair that used to be one code
 * called `unknown`. Collapsing them destroys the most decision-relevant signal
 * the tool produces: "nobody has written this down" and "the sources disagree"
 * lead to completely different next actions. An agent producing this document
 * must distinguish them, which is why the split is in the schema and not left to
 * a note field.
 */
export const MissingCode = z.enum([
  'not-applicable',
  'not-assessed',
  'deferred',
  'not-evidenced',
  'indeterminate',
  'withheld',
]);
export type MissingCode = z.infer<typeof MissingCode>;

export interface MissingCodeFacts {
  /** The cell should be empty; exclude from completeness and from comparison. */
  structural: boolean;
  /** Someone looked; this is an answer, not outstanding work. */
  terminal: boolean;
  /**
   * The absence is evidence about the subject, not about our process.
   *
   * This is the distinction `silenceRate` keys on, and it cuts *across*
   * `terminal`: `not-evidenced` and `withheld` are both terminal, and only the
   * first says anything about the alternative. Counting both was the defect
   * that made `silenceRate` a weaker quantity than ADR-0009 defines.
   */
  informative: boolean;
  /** One-line meaning, for the UI and for an agent's prompt. */
  means: string;
}

/**
 * The flags for each core code, exactly as ADR-0009 clause 2 tabulates them.
 *
 * `not-applicable` is `informative: true` because "this criterion does not
 * apply" is a real statement about the alternative -- battery life does not
 * apply to a desktop, and that tells you what the alternative is. It never
 * reaches `silenceRate` regardless, being `structural` and so outside the
 * denominator; the flag is set for correctness, not for effect.
 *
 * The pair that matters is `not-evidenced` (informative: nobody documents this)
 * against `withheld` (not informative: we know and are not saying). They are
 * both terminal and they mean opposite things about the subject.
 */
export const CORE_MISSING_CODES: Readonly<Record<MissingCode, MissingCodeFacts>> = Object.freeze({
  'not-applicable': { structural: true, terminal: true, informative: true, means: 'This criterion does not apply to this alternative.' },
  'not-assessed': { structural: false, terminal: false, informative: false, means: 'Nobody has looked yet.' },
  deferred: { structural: false, terminal: false, informative: false, means: 'Deliberately left for now.' },
  'not-evidenced': { structural: false, terminal: true, informative: true, means: 'We looked; the sources are silent.' },
  indeterminate: { structural: false, terminal: true, informative: true, means: 'We looked; the sources do not settle it.' },
  withheld: { structural: false, terminal: true, informative: false, means: 'Known, but not shown here.' },
});

/**
 * A deployment-declared extension to the core set. Every extension is a
 * *refinement* of exactly one core code, so a consumer that knows only the core
 * set can still classify it correctly by following `broader`.
 */
export const MissingCodeDeclaration = z.object({
  code: z.string(),
  broader: MissingCode,
  means: z.string(),
  /** Defaults follow `broader` unless overridden; an override is a real claim. */
  structural: z.optional(z.boolean()),
  terminal: z.optional(z.boolean()),
  /**
   * Also defaults from `broader`, and this is the one worth overriding.
   *
   * The world-versus-process distinction cuts across the silence-versus-conflict
   * one, so a refinement can easily need the opposite value from its parent: a
   * code for "the source is paywalled" is a sensible refinement of
   * `not-evidenced` and is emphatically *not* informative about the subject.
   * Inheriting is a claim the declarer makes by choosing `broader`; overriding
   * is a sharper one.
   */
  informative: z.optional(z.boolean()),
});
export type MissingCodeDeclaration = z.infer<typeof MissingCodeDeclaration>;

/** A qualified absence, as stored in a cell. */
export const Missing = z.object({
  /** A core code, or a declared extension. */
  code: z.string(),
  /** Free text. Never a substitute for the code -- a note cannot be counted. */
  note: z.optional(z.string()),
});
export type Missing = z.infer<typeof Missing>;

/**
 * Resolve a code -- core or extension -- to its facts.
 *
 * Returns `undefined` for an undeclared code rather than defaulting, because
 * defaulting an unknown absence to "outstanding work" or to "correctly nothing"
 * are both wrong and both invisible.
 */
export function resolveMissingCode(
  code: string,
  declarations: readonly MissingCodeDeclaration[] = [],
): MissingCodeFacts | undefined {
  if (code in CORE_MISSING_CODES) return CORE_MISSING_CODES[code as MissingCode];
  const decl = declarations.find((d) => d.code === code);
  if (!decl) return undefined;
  const base = CORE_MISSING_CODES[decl.broader];
  return {
    structural: decl.structural ?? base.structural,
    terminal: decl.terminal ?? base.terminal,
    informative: decl.informative ?? base.informative,
    means: decl.means,
  };
}

/**
 * Counts for a set of cells. Reported as counts *and* as rates, because a rate
 * with no denominator is unreadable and a count with no total is unactionable.
 *
 * `examinedRate` and `valuedRate` differ exactly on the cells someone has
 * looked at but could not settle. That gap is the honest part of the report.
 */
export interface Completeness {
  /** Cells in scope, before any exclusion. */
  total: number;
  /** Structurally absent: excluded from every rate below. */
  structural: number;
  /** total - structural. The denominator for every rate. */
  applicable: number;
  /** Cells carrying an asserted value. */
  present: number;
  /** Absent, non-structural, terminal: looked at, and that is the answer. */
  settledAbsent: number;
  /**
   * Absent, non-structural, terminal **and informative**: looked at, and the
   * emptiness is itself a statement about the subject.
   *
   * A subset of `settledAbsent`. The two differ exactly on the cells we could
   * fill and are choosing not to -- `withheld`, and any deployment code that
   * refines it -- which is why `silenceRate` is computed from this one.
   */
  informativeAbsent: number;
  /** Absent, non-structural, non-terminal: outstanding work. */
  outstanding: number;
  /**
   * (present + settledAbsent) / applicable -- how much has been **looked at**.
   *
   * Named `examinedRate` rather than `assessedRate` or `settledRate` because
   * both of those read naturally as "looked at" *and* as "carries a value",
   * which is precisely how the ADR and the implementation came to define them
   * as each other's opposite. Ambiguous names do not survive two authors.
   */
  examinedRate: number;
  /** present / applicable -- how much carries an actual value. */
  valuedRate: number;
  /**
   * informativeAbsent / applicable -- looked at, and the silence is the finding.
   *
   * The number an honest agent moves and a careless one does not: the share of
   * the matrix where someone searched and the answer was "nothing here", as
   * distinct both from the share nobody has reached yet and from the share we
   * know and are not showing.
   *
   * It is deliberately **not** `settledAbsent / applicable`. That wider
   * quantity counts `withheld` -- a fact about us -- alongside `not-evidenced`
   * -- a fact about the subject -- and only the second is evidence a reader can
   * use. ADR-0009 clause 5 defines the narrow one; the wide one shipped by
   * accident and read as the same thing.
   */
  silenceRate: number;
}

export function emptyCompleteness(): Completeness {
  return {
    total: 0, structural: 0, applicable: 0, present: 0,
    settledAbsent: 0, informativeAbsent: 0, outstanding: 0,
    examinedRate: 0, valuedRate: 0, silenceRate: 0,
  };
}

/**
 * Tally completeness over cells described only by whether they hold a value and,
 * if not, which code they carry.
 *
 * Deliberately takes a minimal shape rather than the full cell type, so it can
 * be reused at analysis, row, column and group scope without four variants.
 */
export function tallyCompleteness(
  cells: Iterable<{ hasValue: boolean; code?: string }>,
  declarations: readonly MissingCodeDeclaration[] = [],
): Completeness {
  const c = emptyCompleteness();
  for (const cell of cells) {
    c.total += 1;
    if (cell.hasValue) {
      c.present += 1;
      continue;
    }
    const facts = cell.code ? resolveMissingCode(cell.code, declarations) : undefined;
    if (facts?.structural) {
      c.structural += 1;
    } else if (facts?.terminal) {
      c.settledAbsent += 1;
      if (facts.informative) c.informativeAbsent += 1;
    } else {
      // An undeclared code counts as outstanding: the safe direction is to
      // over-report work remaining, never to under-report it.
      c.outstanding += 1;
    }
  }
  c.applicable = c.total - c.structural;
  if (c.applicable > 0) {
    c.examinedRate = (c.present + c.settledAbsent) / c.applicable;
    c.valuedRate = c.present / c.applicable;
    c.silenceRate = c.informativeAbsent / c.applicable;
  }
  return c;
}
