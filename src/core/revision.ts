/**
 * What a write may not do to an analysis: the one check a write path runs.
 *
 * Validation answers "is this document well-formed and honest". A write needs a
 * second question answered -- "does this *change* rewrite history" -- which no
 * single document can answer, because it is about the difference between two.
 * Five families, each owned by its own module and composed here so that a
 * provider runs one function and cannot forget one:
 *
 * - `criteriaRevisionProblems`: a criterion's meaning changed without the set
 *   version moving, or a referenced criterion was removed (#62, #165);
 * - `scoreHistoryProblems`: a stored assertion was moved, deleted, or edited in
 *   place (#165);
 * - `tombstonedGroupProblems`: something was attached to a tombstoned group, or
 *   one was tombstoned without releasing its blocks (#51, #165);
 * - `annotationHistoryProblems`: a thread, comment or suggestion was removed or
 *   rewritten in place (#204);
 * - `removedEntityProblems`: an alternative or group something refers to was
 *   removed rather than tombstoned (#204).
 *
 * And the validator, counted **by difference**: a write is refused for an error
 * it introduces, never for one already in the document -- otherwise one stored
 * defect would lock the whole document, and a document with two could not be
 * repaired one write at a time.
 *
 * Pure: no DOM, no clock, no store.
 */
import { Analysis, cellKey, compareCriteriaVersions, validateAnalysis, type ValidationProblem } from './schema/analysis.js';
import { criteriaRevisionProblems, scoreHistoryProblems } from './criteria-revision.js';
import { removedEntityProblems, tombstonedGroupProblems } from './schema/anchors.js';
import { annotationHistoryProblems } from './annotation-history.js';
import { valueRefusal } from './schema/measurement.js';
import { measurementFor } from './schema/structure.js';

/** A write a provider must refuse. */
export interface RevisionProblem {
  path: string;
  message: string;
  fix: string;
}

/** The rules whose failures name an assertion a repair has to be allowed to change. */
const REPAIRABLE_RULES = new Set(['supersession-resolves', 'supersession-acyclic', 'unique-ids', 'schema-shape']);

/**
 * Why the write from `before` to `after` must be refused. Empty when it may go.
 *
 * `after` is untrusted: it is parsed here, and a shape error is reported as a
 * problem rather than thrown from inside a later check. A `before` that does not
 * parse -- stored before a rule existed -- is held only to the by-difference
 * rule, so the write that repairs it is not refused for what it repairs.
 */
export function revisionProblems(before: Analysis, after: unknown): RevisionProblem[] {
  const beforeErrors = errorsOf(before);
  const afterErrors = errorsOf(after);
  const introduced = byDifference(before, beforeErrors, after, afterErrors);

  const parsed = Analysis.safeParse(after);
  // A write must leave a document that parses -- shape errors carry no ids to
  // compare by, so "already there" cannot be told from "introduced" (#165).
  if (!parsed.success) return afterErrors;
  const a = parsed.data;
  const prior = Analysis.safeParse(before);
  // A stored document that does not parse (written before a rule existed) is
  // still guarded: the history checks run on it as stored. One malformed so
  // badly they cannot read it is refused until a write repairs only its shape.
  const b = prior.success ? prior.data : before;

  const repairable = new Set<string>();
  for (const p of beforeErrors) {
    // Bracketed from the rules, dotted from a shape error.
    const m = /^cells(?:\[(\d+)\]|\.(\d+))\.assertions(?:\[(\d+)\]|\.(\d+))/.exec(p.path);
    if (!m || !REPAIRABLE_RULES.has(p.ruleId)) continue;
    const cell = b.cells?.[Number(m[1] ?? m[2])];
    const j = Number(m[3] ?? m[4]);
    // The assertion at the reported index, and only it: a duplicate id must not
    // make its healthy twin rewritable too.
    if (cell?.assertions?.[j]) {
      repairable.add(JSON.stringify([cellKey(cell.alternativeId, cell.criterionId, cell.measure), j]));
    }
  }

  try {
    return [
      ...criteriaRevisionProblems(b, a),
      ...scoreHistoryProblems(b, a, { repairable }),
      ...tombstonedGroupProblems(b, a),
      ...annotationHistoryProblems(b, a),
      ...removedEntityProblems(b, a),
      ...newValuesOffScale(b, a),
      ...introduced,
    ];
  } catch {
    return [{
      path: '(root)',
      message: 'the stored document is malformed in a way the history checks cannot read, so this write cannot be ' +
        'checked against it.',
      fix: 'first make a write that repairs only the stored document\'s shape errors.',
    }];
  }
}

function errorsOf(doc: unknown): ValidationProblem[] {
  return validateAnalysis(doc, { includeCompleteness: false }).problems.filter((p) => p.severity === 'error');
}

/**
 * The errors in `after` that `before` did not have. A problem's identity is its
 * rule, its message and the *entities* its path names -- `cells[3]` read as the
 * cell's coordinates, `assertions[1]` as the assertion's id -- because indexes
 * shift when a list is edited, and a message alone does not always say where:
 * two off-scale values in different cells share one message (#165).
 */
function byDifference(before: unknown, bErrors: ValidationProblem[], after: unknown, aErrors: ValidationProblem[]) {
  const key = (doc: unknown, p: ValidationProblem) => `${p.ruleId}\u0000${p.message}\u0000${stablePath(doc, p.path)}`;
  const already = new Map<string, number>();
  for (const p of bErrors) already.set(key(before, p), (already.get(key(before, p)) ?? 0) + 1);
  return aErrors.filter((p) => {
    const n = already.get(key(after, p)) ?? 0;
    if (n === 0) return true;
    already.set(key(after, p), n - 1);
    return false;
  });
}

/** A validation path with list indexes replaced by the ids of what they index. */
function stablePath(doc: unknown, path: string): string {
  const d = (doc ?? {}) as Record<string, unknown>;
  const at = (list: unknown, i: number) => (Array.isArray(list) ? list[i] : undefined) as Record<string, unknown> | undefined;
  let cell: Record<string, unknown> | undefined;
  return path.replace(/\b(cells|assertions|criteria|alternatives|groups|missingCodes|scales|reductions|threads|suggestions)\[(\d+)\]/g, (whole, list: string, n: string) => {
    const i = Number(n);
    if (list === 'cells') {
      cell = at(d.cells, i);
      return cell ? `cells[${JSON.stringify([cell.alternativeId, cell.criterionId, cell.measure])}]` : whole;
    }
    const item = list === 'assertions' ? at(cell?.assertions, i) : at(d[list], i);
    return item && typeof item.id === 'string' ? `${list}[${JSON.stringify(item.id)}]` : whole;
  });
}

/**
 * A new assertion's value, held to the current scale. The validator exempts a
 * score whose version is absent or unorderable once its criterion has changed
 * meaning, because it may predate the change; a score written *now* does not,
 * so the store refuses exactly what the affordance layer would not offer --
 * unless it says it was scored against an earlier definition (#165).
 */
function newValuesOffScale(before: Analysis, after: Analysis): RevisionProblem[] {
  const old = new Set(before.cells.flatMap((c) =>
    c.assertions.map((s) => JSON.stringify([cellKey(c.alternativeId, c.criterionId, c.measure), s.id]))));
  const crits = new Map(after.criteria.map((c) => [c.id, c]));
  const problems: RevisionProblem[] = [];
  after.cells.forEach((cell, i) => {
    const crit = crits.get(cell.criterionId);
    const m = crit ? measurementFor(crit, cell.measure) : undefined;
    if (!crit || !m) return;
    const key = cellKey(cell.alternativeId, cell.criterionId, cell.measure);
    cell.assertions.forEach((s, j) => {
      if (s.value === undefined || old.has(JSON.stringify([key, s.id]))) return;
      if (crit.definedInVersion !== undefined && s.criteriaVersion !== undefined &&
        compareCriteriaVersions(s.criteriaVersion, crit.definedInVersion) === -1) return;
      const reason = valueRefusal(m, s.value);
      if (reason !== undefined) {
        problems.push({
          path: `cells[${i}].assertions[${j}].value`,
          message: `new assertion "${s.id}" on ${cell.alternativeId} x ${cell.criterionId}: ${reason}`,
          fix: 'record a value the current measurement admits, or state the earlier criteriaVersion it was scored against.',
        });
      }
    });
  });
  return problems;
}
