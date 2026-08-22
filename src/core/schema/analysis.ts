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
import { Cell, Reduction, reduce, type Reduced } from './values.js';
import { Author, Procedure, Round } from './provenance.js';
import { Thread, Suggestion } from './annotations.js';
import {
  CORE_MISSING_CODES, MissingCodeDeclaration, tallyCompleteness, type Completeness,
} from './missingness.js';
import { validateMeasurement, type Measurement } from './measurement.js';
import { validateEvidence } from './evidence.js';

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

  /** Whether the analysis accepts direct edits, or only suggestions. */
  locked: z.optional(z.boolean()),
});
export type Analysis = z.infer<typeof Analysis>;

export interface ValidationProblem {
  path: string;
  message: string;
  severity: 'error' | 'warning';
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
export function validateAnalysis(input: unknown): {
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
      })),
    };
  }

  const a = parsed.data;
  const problems: ValidationProblem[] = [];
  const err = (path: string, message: string) => problems.push({ path, message, severity: 'error' });
  const warn = (path: string, message: string) => problems.push({ path, message, severity: 'warning' });

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
      if (!authorIds.has(as.authorId)) err(atA, `unknown author "${as.authorId}"`);
      const hasValue = as.value !== undefined;
      const hasMissing = as.missing !== undefined;
      if (hasValue === hasMissing) {
        err(atA, hasValue
          ? 'an assertion carries a value and a missing reason; exactly one is required'
          : 'an assertion carries neither a value nor a missing reason. No bare nulls: ' +
            'every absence names why (ADR-0009).');
      }
      for (const p of validateEvidence(as.evidence, `${atA}.evidence`)) warn(p.path, p.message);
    });
  });

  for (const [i, b] of a.inapplicable.entries()) {
    if (!groupIds.has(b.alternativeGroupId)) err(`inapplicable[${i}]`, `unknown group "${b.alternativeGroupId}"`);
    if (!groupIds.has(b.criterionGroupId)) err(`inapplicable[${i}]`, `unknown group "${b.criterionGroupId}"`);
  }

  for (const [i, d] of a.missingCodes.entries()) {
    // Read the core set rather than restating it. An inline list here is a
    // second source of truth in the file that owns the rule: add a seventh core
    // code and this check silently starts permitting its redeclaration, which
    // is the one thing it exists to stop.
    if (Object.prototype.hasOwnProperty.call(CORE_MISSING_CODES, d.id)) {
      err(`missingCodes[${i}]`, `"${d.id}" is a core code and cannot be redeclared`);
    }
  }

  return { ok: problems.every((p) => p.severity !== 'error'), analysis: a, problems };
}

/** Index cells for O(1) lookup. Rebuilt rather than stored; it is derived. */
export function cellIndex(a: Analysis): Map<string, Cell> {
  const m = new Map<string, Cell>();
  for (const c of a.cells) m.set(`${c.alternativeId}\u0000${c.criterionId}\u0000${c.measure}`, c);
  return m;
}

export function getCell(a: Analysis, alternativeId: string, criterionId: string, measure: string): Cell | undefined {
  return a.cells.find(
    (c) => c.alternativeId === alternativeId && c.criterionId === criterionId && c.measure === measure,
  );
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

export function makeCellReader(a: Analysis, measure: string): CellReader {
  const cells = cellIndex(a);
  const measurements = new Map<string, Measurement | undefined>();
  for (const c of a.criteria) measurements.set(c.id, measurementFor(c, measure));

  return {
    measure,
    measurementOf: (criterionId) => measurements.get(criterionId),
    read(alternativeId, criterionId) {
      const cell = cells.get(`${alternativeId}\u0000${criterionId}\u0000${measure}`);
      if (!cell) return undefined;
      const m = measurements.get(criterionId);
      return reduce(cell, {
        defaultReduction: a.defaultReduction,
        ...(m ? { level: m.level } : {}),
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
