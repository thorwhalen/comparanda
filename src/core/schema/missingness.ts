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
import {
  declarationFields, resolveDeclaration, degradationOf,
  type Degradation, type Resolution,
} from './declarations.js';

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
/**
 * The core code a cell falls back to when nothing is asserted for it.
 *
 * Named rather than written as a literal at the call sites that need it. A
 * literal here is the same defect as the inline six-code array that
 * `validateAnalysis` used to carry: it survives a rename of the code it names,
 * and the survivor is silently wrong.
 */
export const NOT_ASSESSED = 'not-assessed' as const;

/** The core code for a cell that a structural rule says should be empty. */
export const NOT_APPLICABLE = 'not-applicable' as const;

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
  ...declarationFields(MissingCode),
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
 * Resolve a code -- core or extension -- through the one resolver.
 *
 * Returns a `Resolution`, not bare facts, because "this build could not
 * interpret the code" and "this code means X" are different answers and a
 * caller that cannot tell them apart will report one as the other.
 *
 * **A declared missingness code never degrades.** Its facts travel *with* the
 * declaration -- `structural`, `terminal`, `informative` are all either stated
 * or inherited from `broader` -- so any build can interpret any declaration
 * without knowing anything about it. That is the whole return on carrying facts
 * in the document rather than in an interpreter, and it makes this the one open
 * vocabulary whose extensions are always fully readable.
 *
 * What still fails is an **undeclared** code, which resolves `undeclared` with
 * no facts rather than defaulting. Defaulting an unknown absence to "outstanding
 * work" or to "correctly nothing" are both wrong and both invisible.
 */
export function resolveMissingCode(
  code: string,
  declarations: readonly MissingCodeDeclaration[] = [],
): Resolution<MissingCodeFacts> {
  return resolveDeclaration<MissingCodeFacts>(
    code,
    CORE_MISSING_CODES,
    declarations as readonly { id: string; broader: string; means: string }[],
    (decl, base) => {
      const d = decl as unknown as MissingCodeDeclaration;
      return {
        structural: d.structural ?? base.structural,
        terminal: d.terminal ?? base.terminal,
        informative: d.informative ?? base.informative,
        means: d.means,
      };
    },
  );
}

/**
 * The facts alone, for a caller that has already dealt with the unknown case.
 *
 * Deliberately named so that reaching for it looks like the shortcut it is:
 * every path that renders to a human, or that feeds a rate, must go through
 * `resolveMissingCode` and report what it could not interpret.
 */
export function missingCodeFactsOrUndefined(
  code: string,
  declarations: readonly MissingCodeDeclaration[] = [],
): MissingCodeFacts | undefined {
  return resolveMissingCode(code, declarations).facts;
}

/**
 * A criterion may narrow or extend the vocabulary for its own column.
 *
 * The overlay exists because a criterion is where a specialised blank actually
 * belongs: "no public filing" means something on a governance column and nothing
 * on a latency one, and forcing it to analysis scope makes every column carry
 * every other column's vocabulary.
 */
export interface MissingnessVocabulary {
  /** Resolve a code, honouring a criterion's overlay where one is given. */
  resolve(code: string, criterionId?: string): Resolution<MissingCodeFacts>;
  /** The one-line meaning, for a reader. `undefined` when nothing defines it. */
  means(code: string, criterionId?: string): string | undefined;
  /** Every declaration in force for a criterion, overlay first. */
  declarationsFor(criterionId?: string): readonly MissingCodeDeclaration[];
}

/**
 * The one way to reach the vocabulary of an analysis.
 *
 * Takes the analysis-level declarations and a lookup for a criterion's overlay,
 * rather than the `Analysis` type, so that this module does not have to import
 * the document it is part of. The composition happens in `analysis.ts`.
 *
 * A criterion's own declaration wins for that criterion. Two declarations of one
 * id at the same scope is a document defect and is caught by `validateAnalysis`;
 * the same id at *different* scopes is not a defect, and the narrower one is the
 * one the author meant.
 */
export function makeVocabulary(
  analysisCodes: readonly MissingCodeDeclaration[],
  overlayFor: (criterionId: string) => readonly MissingCodeDeclaration[] = () => [],
): MissingnessVocabulary {
  const declarationsFor = (criterionId?: string): readonly MissingCodeDeclaration[] =>
    criterionId ? [...overlayFor(criterionId), ...analysisCodes] : analysisCodes;

  return {
    declarationsFor,
    resolve: (code, criterionId) => resolveMissingCode(code, declarationsFor(criterionId)),
    means(code, criterionId) {
      return this.resolve(code, criterionId).facts?.means;
    },
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
  cells: Iterable<{ hasValue: boolean; code?: string; criterionId?: string }>,
  /**
   * Either a flat declaration list, or the vocabulary facade.
   *
   * Pass the **facade** whenever the cells span more than one criterion: a
   * criterion's overlay is only reachable through it, and passing the flat
   * analysis-level list instead silently treats every overlay code as
   * undeclared -- which counts a deliberate, defined blank as outstanding work
   * and moves the completeness report in the wrong direction.
   */
  vocabulary: readonly MissingCodeDeclaration[] | MissingnessVocabulary = [],
  /**
   * Appended to, when a cell names a code this build could not resolve.
   *
   * Optional so the common call stays a one-liner, and by-reference rather than
   * returned so a caller tallying at four scopes accumulates one list. What must
   * not happen is a rate computed over codes nobody could read, with nothing
   * anywhere saying so.
   */
  degradations?: Degradation[],
): Completeness {
  const resolve = Array.isArray(vocabulary)
    ? (code: string) => resolveMissingCode(code, vocabulary as readonly MissingCodeDeclaration[])
    : (code: string, criterionId?: string) =>
        (vocabulary as MissingnessVocabulary).resolve(code, criterionId);

  const c = emptyCompleteness();
  let i = -1;
  for (const cell of cells) {
    i += 1;
    c.total += 1;
    if (cell.hasValue) {
      c.present += 1;
      continue;
    }
    const r = cell.code ? resolve(cell.code, cell.criterionId) : undefined;
    const facts = r?.facts;
    if (r && degradations) {
      const d = degradationOf(r, 'missing-code', `cells[${i}].missing.code`);
      if (d) degradations.push(d);
    }
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
