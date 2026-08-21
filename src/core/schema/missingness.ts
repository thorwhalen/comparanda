/**
 * Qualified absence. No bare nulls, ever (ADR-0009).
 *
 * In every comparison table that matters some cells are empty, and the reasons
 * are not interchangeable. "Does not apply" and "nobody has checked" look
 * identical in a spreadsheet and mean opposite things about whether the analysis
 * is finished.
 *
 * Two flags do the real work, and they are what analyses key on -- never the
 * literal code, so that an analysis keeps working when a deployment extends the
 * set:
 *
 *   - `structural`: the cell *should* be empty. It is excluded from completeness
 *     counts and removed from a dominance comparison entirely.
 *   - `terminal`: someone looked and this is the answer. Non-terminal absences
 *     are work outstanding.
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
  /** One-line meaning, for the UI and for an agent's prompt. */
  means: string;
}

export const CORE_MISSING_CODES: Readonly<Record<MissingCode, MissingCodeFacts>> = Object.freeze({
  'not-applicable': { structural: true, terminal: true, means: 'This criterion does not apply to this alternative.' },
  'not-assessed': { structural: false, terminal: false, means: 'Nobody has looked yet.' },
  deferred: { structural: false, terminal: false, means: 'Deliberately left for now.' },
  'not-evidenced': { structural: false, terminal: true, means: 'We looked; the sources are silent.' },
  indeterminate: { structural: false, terminal: true, means: 'We looked; the sources do not settle it.' },
  withheld: { structural: false, terminal: true, means: 'Known, but not shown here.' },
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
    means: decl.means,
  };
}

/**
 * Counts for a set of cells. Reported as counts *and* as rates, because a rate
 * with no denominator is unreadable and a count with no total is unactionable.
 *
 * `assessedRate` and `settledRate` differ exactly on the cells someone has
 * looked at but could not settle -- which is the number an honest agent moves
 * and a careless one does not.
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
  /** Absent, non-structural, non-terminal: outstanding work. */
  outstanding: number;
  /** (present + settledAbsent) / applicable -- how much has been *looked at*. */
  assessedRate: number;
  /** present / applicable -- how much carries a value. */
  settledRate: number;
  /** settledAbsent / applicable -- how much was looked at and came back empty. */
  silenceRate: number;
}

export function emptyCompleteness(): Completeness {
  return {
    total: 0, structural: 0, applicable: 0, present: 0,
    settledAbsent: 0, outstanding: 0,
    assessedRate: 0, settledRate: 0, silenceRate: 0,
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
    } else {
      // An undeclared code counts as outstanding: the safe direction is to
      // over-report work remaining, never to under-report it.
      c.outstanding += 1;
    }
  }
  c.applicable = c.total - c.structural;
  if (c.applicable > 0) {
    c.assessedRate = (c.present + c.settledAbsent) / c.applicable;
    c.settledRate = c.present / c.applicable;
    c.silenceRate = c.settledAbsent / c.applicable;
  }
  return c;
}
