/**
 * The analysis document: the top-level shape, its version, and validation at the
 * boundary.
 *
 * This is the package's principal export and the contract with any producer --
 * a human, an agent, or a script. An analysis is equally valid whichever made
 * it, and `comparanda` must not be able to tell the difference except through
 * the authorship metadata every value carries (ADR-0002).
 */
import * as z from 'zod/mini';
import {
  Alternative, Criterion, Group, InapplicableBlock, RejectedCriterion, Aliases,
  measurementFor,
} from './structure.js';
import {
  Cell, Reduction, ReductionDeclaration, CORE_REDUCTIONS, reduce, type Reduced,
} from './values.js';
import { Author, Procedure, Round } from './provenance.js';
import { Thread, Suggestion } from './annotations.js';
import {
  CORE_MISSING_CODES, MissingCodeDeclaration, resolveMissingCode,
  tallyCompleteness, type Completeness,
} from './missingness.js';
import type { Degradation } from './declarations.js';
import { ScaleDeclaration, validateMeasurement, type Measurement } from './measurement.js';
import { Rendition, validateEvidence } from './evidence.js';

/**
 * The schema version this build reads and writes.
 *
 * Bumped on any change to the stored shape. The migration harness ships *with*
 * version 1 rather than when a migration is first needed (ADR-0006), because a
 * harness retrofitted after the first breaking change has to reconstruct what
 * the old shape was from memory.
 */
export const SCHEMA_VERSION = 1;

/** The question being decided. One per analysis. */
export const Subject = z.object({
  question: z.string(),
  /** What decision this informs, and who is making it. Surfaces the frame. */
  decision: z.optional(z.string()),
  decider: z.optional(z.string()),
  context: z.optional(z.string()),
});
export type Subject = z.infer<typeof Subject>;

/**
 * Which measures this analysis stores. `score` and `confidence` are the common
 * pair, but nothing is hard-coded: the matrix is a tensor of
 * `alternatives x criteria x measures` and a deployment may store others.
 *
 * Encodings are *not* here. An encoding is derived and belongs to the view
 * (ADR-0003); storing one would mean persisting computed data.
 */
export const MeasureDeclaration = z.object({
  name: z.string(),
  label: z.optional(z.string()),
  description: z.optional(z.string()),
});
export type MeasureDeclaration = z.infer<typeof MeasureDeclaration>;

export const Analysis = z.object({
  schemaVersion: z._default(z.number(), SCHEMA_VERSION),
  id: z.string(),
  subject: Subject,
  title: z.optional(z.string()),
  createdAt: z.optional(z.string()),
  updatedAt: z.optional(z.string()),

  aliases: z.optional(Aliases),
  measures: z._default(z.array(MeasureDeclaration), []),
  /** Default for cells that do not override it. See `Reduction`. */
  defaultReduction: z._default(Reduction, 'single'),

  alternatives: z._default(z.array(Alternative), []),
  criteria: z._default(z.array(Criterion), []),
  groups: z._default(z.array(Group), []),
  inapplicable: z._default(z.array(InapplicableBlock), []),
  rejectedCriteria: z._default(z.array(RejectedCriterion), []),
  /** Version of the criteria set. Assertions record which version they scored. */
  criteriaVersion: z.optional(z.string()),

  cells: z._default(z.array(Cell), []),
  authors: z._default(z.array(Author), []),
  procedures: z._default(z.array(Procedure), []),
  rounds: z._default(z.array(Round), []),

  threads: z._default(z.array(Thread), []),
  suggestions: z._default(z.array(Suggestion), []),

  /** Deployment extensions to the closed core set of missingness codes. */
  missingCodes: z._default(z.array(MissingCodeDeclaration), []),

  /**
   * The named scales this analysis's criteria were authored to.
   *
   * A row per scale, so a reader that has never heard of one still knows what it
   * was and can say so. The measurement itself is on the criterion, as required
   * fields, which is what lets an unknown scale still dominate and still render.
   */
  scales: z._default(z.array(ScaleDeclaration), []),

  /** Deployment extensions to the closed core set of reductions. */
  reductions: z._default(z.array(ReductionDeclaration), []),

  /**
   * The cleaned copies of ingested sources that this analysis's quotes index
   * into, each with the fingerprint of the original it was made from.
   *
   * Travelling with the document is the point: a recipient with no corpus and no
   * resolver can still check every quote.
   */
  renditions: z._default(z.array(Rendition), []),

  /** Whether the analysis accepts direct edits, or only suggestions. */
  locked: z.optional(z.boolean()),
});
export type Analysis = z.infer<typeof Analysis>;

/**
 * Which kind of rule a problem came from. **This is the boundary contract.**
 *
 * - `shape`         the document is not a document. Always an error.
 * - `honesty`       the document asserts something a reader cannot check: a
 *                   score with no rationale, an assertion by nobody, a blank
 *                   whose code the document never defines, a verdict with no
 *                   date. **Always an error, and it cannot be switched off.**
 * - `completeness`  the document is unfinished. **Always a warning**, because
 *                   "not yet assessed" is a first-class representable state and
 *                   an analysis deliberately full of qualified blanks is a
 *                   legitimate, finished-as-specified document.
 *
 * The split is the whole of the strictness decision: strict on honesty,
 * forgiving on completeness. One global strictness knob cannot express it --
 * turned up, you cannot save work in progress; turned down, "validates against
 * the schema" stops being a claim worth making.
 */
export type RuleFamily = 'shape' | 'honesty' | 'completeness';

export interface ValidationProblem {
  path: string;
  message: string;
  severity: 'error' | 'warning';
  family: RuleFamily;
  /**
   * A stable id for the rule, so a caller can suppress, count or link one
   * without matching on prose.
   */
  ruleId: string;
  /** What would fix it. A problem with no remedy is a puzzle, not an error. */
  fix?: string;
}

/**
 * Validate an analysis at the boundary.
 *
 * Returns *all* problems rather than throwing on the first, because the caller
 * is usually an authoring UI or an agent that wants to fix everything in one
 * pass. Shape errors from the schema come back as `error`; structural problems
 * the schema cannot express -- a cell pointing at a criterion that does not
 * exist, an ordinal criterion with no range -- come back from the checks below.
 */
export function validateAnalysis(
  input: unknown,
  {
    includeCompleteness = true,
  }: {
    /**
     * Whether to report completeness warnings.
     *
     * Note what is **not** here: a way to turn off honesty. That asymmetry is
     * deliberate and is the decision, not an oversight -- an option to skip the
     * honesty family would be reached for on the first inconvenient failure, and
     * the guarantee would erode exactly where it matters. Completeness noise is
     * suppressible because a partially-filled matrix is a normal working state
     * and an authoring UI counting 400 warnings has learned nothing.
     */
    includeCompleteness?: boolean;
  } = {},
): {
  ok: boolean;
  analysis?: Analysis;
  problems: ValidationProblem[];
} {
  const parsed = Analysis.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map((i) => ({
        path: i.path.join('.') || '(root)',
        message: i.message,
        severity: 'error' as const,
        family: 'shape' as const,
        ruleId: 'schema-shape',
      })),
    };
  }

  const a = parsed.data;
  const problems: ValidationProblem[] = [];

  /** An honesty failure. Always an error; there is no switch. */
  const honesty = (ruleId: string, path: string, message: string, fix: string) =>
    problems.push({ path, message, severity: 'error', family: 'honesty', ruleId, fix });

  /** An unfinished-ness. Always a warning, and suppressible as a set. */
  const incomplete = (ruleId: string, path: string, message: string, fix: string) => {
    if (includeCompleteness) {
      problems.push({ path, message, severity: 'warning', family: 'completeness', ruleId, fix });
    }
  };

  // Kept for the structural-integrity checks that predate the families: a
  // document referring to ids that do not exist is malformed rather than
  // dishonest, and calling it `shape` keeps the three families meaning what
  // they say.
  const err = (path: string, message: string) =>
    problems.push({ path, message, severity: 'error', family: 'shape', ruleId: 'referential-integrity' });
  const warn = (path: string, message: string) =>
    problems.push({ path, message, severity: 'warning', family: 'shape', ruleId: 'shape-advisory' });

  if (a.schemaVersion > SCHEMA_VERSION) {
    err('schemaVersion', `document is version ${a.schemaVersion}; this build reads up to ${SCHEMA_VERSION}`);
  }

  const altIds = new Set(a.alternatives.map((x) => x.id));
  const critIds = new Set(a.criteria.map((x) => x.id));
  const groupIds = new Set(a.groups.map((x) => x.id));
  const authorIds = new Set(a.authors.map((x) => x.id));

  for (const [label, list] of [
    ['alternatives', a.alternatives], ['criteria', a.criteria], ['groups', a.groups],
  ] as const) {
    const seen = new Set<string>();
    for (const item of list) {
      if (seen.has(item.id)) err(label, `duplicate id "${item.id}"`);
      seen.add(item.id);
    }
  }

  a.criteria.forEach((c, i) => {
    const declared = Object.entries(c.measurements);
    if (declared.length === 0 && !c.defaultMeasurement) {
      err(`criteria[${i}]`, `criterion "${c.id}" declares no measurement and no default`);
    }
    for (const [measure, m] of declared) {
      for (const p of validateMeasurement(m, `criteria[${i}].measurements.${measure}`)) {
        err(p.path, p.message);
      }
    }
    if (c.defaultMeasurement) {
      for (const p of validateMeasurement(c.defaultMeasurement, `criteria[${i}].defaultMeasurement`)) {
        err(p.path, p.message);
      }
    }
    for (const g of c.groupIds) if (!groupIds.has(g)) err(`criteria[${i}].groupIds`, `unknown group "${g}"`);
  });

  a.alternatives.forEach((alt, i) => {
    for (const g of alt.groupIds) if (!groupIds.has(g)) err(`alternatives[${i}].groupIds`, `unknown group "${g}"`);
  });

  a.cells.forEach((cell, i) => {
    const at = `cells[${i}]`;
    if (!altIds.has(cell.alternativeId)) err(at, `unknown alternative "${cell.alternativeId}"`);
    if (!critIds.has(cell.criterionId)) err(at, `unknown criterion "${cell.criterionId}"`);
    const criterion = a.criteria.find((c) => c.id === cell.criterionId);
    if (criterion && !measurementFor(criterion, cell.measure)) {
      err(at, `criterion "${cell.criterionId}" declares no measurement for measure "${cell.measure}"`);
    }
    cell.assertions.forEach((as, j) => {
      const atA = `${at}.assertions[${j}]`;
      if (!authorIds.has(as.authorId)) {
        honesty(
          'assertion-attributed', atA,
          `unknown author "${as.authorId}". An assertion nobody is named for cannot be weighed, ` +
            'and an agreement statistic over it cannot know how many heads produced it.',
          'add the author to `authors`, or attribute the assertion to an existing one.',
        );
      }
      const hasValue = as.value !== undefined;
      const hasMissing = as.missing !== undefined;
      if (hasValue === hasMissing) {
        err(atA, hasValue
          ? 'an assertion carries a value and a missing reason; exactly one is required'
          : 'an assertion carries neither a value nor a missing reason. No bare nulls: ' +
            'every absence names why (ADR-0009).');
      }

      // A score with no reason is the thing this tool exists not to produce.
      // The justification is the most-read field in the document and the only
      // part of a cell a reader can argue with.
      if (hasValue && !as.justification?.trim()) {
        honesty(
          'score-has-a-reason', `${atA}.justification`,
          'a value with no justification. The number is unarguable without one, and a reader ' +
            'has nothing to disagree with except taste.',
          'write one line saying what the evidence shows, or record a qualified absence instead.',
        );
      }

      // A blank whose code the document never defines. Distinct from a code
      // this build does not implement: that one degrades honestly through
      // `broader` and is a limitation of the reader. This is a document that
      // does not say what its own blank means, which no reader can repair.
      if (as.missing) {
        const r = resolveMissingCode(as.missing.code, a.missingCodes);
        if (r.source === 'undeclared') {
          honesty(
            'blank-is-defined', `${atA}.missing.code`,
            `the code "${as.missing.code}" is neither a core code nor declared in this document, ` +
              'so nothing anywhere says what this blank means.',
            'use a core code, or declare this one in `missingCodes` with a `broader` parent and ' +
              'what it means.',
          );
        }
      }

      // Not being finished is not a defect.
      if (hasValue && as.evidence.length === 0) {
        incomplete(
          'value-has-evidence', `${atA}.evidence`,
          'a value with no evidence reference. Legitimate for a considered human judgement; ' +
            'worth checking for anything that claims to rest on a source.',
          'cite the span the value rests on, if there is one.',
        );
      }

      for (const p of validateEvidence(as.evidence, `${atA}.evidence`)) {
        // Every rule in that module is an honesty rule. They were reported as
        // warnings, which meant a document whose every supporting reference was
        // the agent's own output validated cleanly -- the exact failure
        // ADR-0006 names, passing the boundary written to catch it.
        honesty(p.ruleId, p.path, p.message, p.fix);
      }
    });
  });

  for (const [i, b] of a.inapplicable.entries()) {
    if (!groupIds.has(b.alternativeGroupId)) err(`inapplicable[${i}]`, `unknown group "${b.alternativeGroupId}"`);
    if (!groupIds.has(b.criterionGroupId)) err(`inapplicable[${i}]`, `unknown group "${b.criterionGroupId}"`);
  }

  // The same redeclaration rule, for the two vocabularies that just gained it.
  // Written as a loop over (list, core table, field) rather than three times,
  // because three copies is how the fourth vocabulary gets forgotten.
  const vocabularies: [readonly { id: string }[], Readonly<Record<string, unknown>>, string][] = [
    [a.missingCodes, CORE_MISSING_CODES, 'missingCodes'],
    [a.reductions, CORE_REDUCTIONS, 'reductions'],
  ];
  for (const [decls, core, field] of vocabularies) {
    const seen = new Set<string>();
    for (const [i, d] of decls.entries()) {
      if (Object.prototype.hasOwnProperty.call(core, d.id)) {
        err(`${field}[${i}]`, `"${d.id}" is a core member and cannot be redeclared`);
      }
      if (seen.has(d.id)) {
        err(`${field}[${i}]`, `"${d.id}" is declared more than once; the later one would win silently`);
      }
      seen.add(d.id);
    }
  }

  // A cell's identity must be unique. Two cells with the same identity is not a
  // merge conflict to be resolved later: it is a document in which two readers
  // of the same coordinates see different values.
  const seenCells = new Map<string, number>();
  for (const [i, c] of a.cells.entries()) {
    const k = cellKey(c.alternativeId, c.criterionId, c.measure);
    const first = seenCells.get(k);
    if (first !== undefined) {
      err(
        `cells[${i}]`,
        `duplicates the identity of cells[${first}] (${c.alternativeId} x ${c.criterionId} x ` +
          `${c.measure}). Merge their assertions into one cell -- a cell is already a set of ` +
          'assertions, so there is nothing a second cell can express that the first cannot.',
      );
    } else {
      seenCells.set(k, i);
    }
  }

  return { ok: problems.every((p) => p.severity !== 'error'), analysis: a, problems };
}

/**
 * The identity of a cell, as one string.
 *
 * Exported so that nothing computes it a second time and gets it subtly
 * different.
 *
 * **`JSON.stringify` of the triple, not a separator-joined string**, because a
 * separator-joined key is not injective and a document is untrusted input.
 * With a NUL separator, `cellKey('a\u0000b', 'c', 'd')` and
 * `cellKey('a', 'b\u0000c', 'd')` produce the same key -- so two genuinely
 * different cells collide, one is silently lost from `cellIndex`, and the
 * duplicate check flags a pair that is not a duplicate. "NUL cannot occur in an
 * id" is a belief about producers, and this key does not need to hold it.
 *
 * Length-prefixing would also work. `JSON.stringify` is chosen because it is
 * obviously injective to a reader, and this runs once per cell per index build.
 */
export function cellKey(alternativeId: string, criterionId: string, measure: string): string {
  return JSON.stringify([alternativeId, criterionId, measure]);
}

/** Index cells for O(1) lookup. Rebuilt rather than stored; it is derived. */
export function cellIndex(a: Analysis): Map<string, Cell> {
  const m = new Map<string, Cell>();
  for (const c of a.cells) m.set(cellKey(c.alternativeId, c.criterionId, c.measure), c);
  return m;
}

/**
 * One cell, by identity.
 *
 * **Delegates to `cellIndex` rather than scanning**, and that is a correctness
 * fix rather than a tidy-up. The scan returned the *first* match and the index
 * keeps the *last*, so on a document carrying two cells with the same identity
 * the two readers disagreed -- `getCell` showing one value and every matrix walk
 * showing another, with nothing anywhere saying so. Duplicates are not
 * hypothetical once contributions from several people are merged into one
 * document, which is what v1 does.
 *
 * The duplicate itself is rejected by `validateAnalysis`. This makes the two
 * readers agree even on a document that has not been validated.
 */
export function getCell(a: Analysis, alternativeId: string, criterionId: string, measure: string): Cell | undefined {
  return cellIndex(a).get(cellKey(alternativeId, criterionId, measure));
}

/**
 * A prepared reader over one analysis and one measure.
 *
 * Every analysis that walks the whole matrix -- completeness, dominance,
 * screening -- was otherwise scanning `cells` linearly per lookup, making a full
 * pass quadratic in the number of cells. At a hundred alternatives that is
 * millions of comparisons to answer a question the matrix already knows.
 *
 * Building it also resolves each criterion's measurement once rather than per
 * cell, which was the other repeated lookup.
 */
export interface CellReader {
  measure: string;
  read(alternativeId: string, criterionId: string): Reduced | undefined;
  measurementOf(criterionId: string): Measurement | undefined;
}

export function makeCellReader(
  a: Analysis,
  measure: string,
  /**
   * Appended to when a cell names a reduction this build cannot run.
   *
   * By reference rather than returned, so one list accumulates across a whole
   * matrix walk. Optional so the common call stays two arguments -- but a caller
   * that renders to a human should pass one, because a cell whose reduction was
   * refused shows nothing, and the reason it shows nothing lives here.
   */
  degradations?: Degradation[],
): CellReader {
  const cells = cellIndex(a);
  const measurements = new Map<string, Measurement | undefined>();
  for (const c of a.criteria) measurements.set(c.id, measurementFor(c, measure));

  return {
    measure,
    measurementOf: (criterionId) => measurements.get(criterionId),
    read(alternativeId, criterionId) {
      const cell = cells.get(cellKey(alternativeId, criterionId, measure));
      if (!cell) return undefined;
      const m = measurements.get(criterionId);
      return reduce(cell, {
        defaultReduction: a.defaultReduction,
        reductions: a.reductions,
        ...(m ? { level: m.level } : {}),
        ...(degradations ? { degradations } : {}),
      });
    },
  };
}

/**
 * Reduce one cell.
 *
 * Convenient for a single lookup. Anything walking the matrix should build a
 * {@link CellReader} once instead -- this scans `cells` linearly.
 */
export function reducedValue(
  a: Analysis, alternativeId: string, criterionId: string, measure: string,
): Reduced | undefined {
  const cell = getCell(a, alternativeId, criterionId, measure);
  if (!cell) return undefined;
  const criterion = a.criteria.find((c) => c.id === criterionId);
  const m = criterion ? measurementFor(criterion, measure) : undefined;
  return reduce(cell, {
    defaultReduction: a.defaultReduction,
    reductions: a.reductions,
    ...(m ? { level: m.level } : {}),
  });
}

/** Whether a (alternative, criterion) pair falls in a declared inapplicable block. */
export function isInapplicable(a: Analysis, alternativeId: string, criterionId: string): boolean {
  const alt = a.alternatives.find((x) => x.id === alternativeId);
  const crit = a.criteria.find((x) => x.id === criterionId);
  if (!alt || !crit) return false;
  return a.inapplicable.some(
    (b) => alt.groupIds.includes(b.alternativeGroupId) && crit.groupIds.includes(b.criterionGroupId),
  );
}

/**
 * Completeness at any scope. "What is left to do here" is a real question and
 * the tool should answer it (ADR-0009).
 */
export function completeness(
  a: Analysis,
  scope: { measure: string; alternativeIds?: readonly string[]; criterionIds?: readonly string[] },
): Completeness {
  const alts = scope.alternativeIds ?? a.alternatives.filter((x) => !x.tombstoned).map((x) => x.id);
  const crits = scope.criterionIds ?? a.criteria.filter((x) => !x.tombstoned).map((x) => x.id);
  const cells: { hasValue: boolean; code?: string }[] = [];
  const reader = makeCellReader(a, scope.measure);

  for (const altId of alts) {
    for (const critId of crits) {
      if (isInapplicable(a, altId, critId)) {
        cells.push({ hasValue: false, code: 'not-applicable' });
        continue;
      }
      const r = reader.read(altId, critId);
      if (r?.value !== undefined) cells.push({ hasValue: true });
      else if (r?.missing) cells.push({ hasValue: false, code: r.missing.code });
      else cells.push({ hasValue: false, code: 'not-assessed' });
    }
  }
  return tallyCompleteness(cells, a.missingCodes);
}
