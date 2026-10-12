/**
 * What a write may not do to an analysis: the one check a write path runs.
 *
 * Validation answers "is this document well-formed and honest". A write needs a
 * second question answered -- "does this *change* rewrite history" -- which no
 * single document can answer, because it is about the difference between two.
 * Three families, each owned by its own module and composed here so that a
 * provider runs one function and cannot forget the third:
 *
 * - `criteriaRevisionProblems`: a criterion's meaning changed without the set
 *   version moving, or a referenced criterion was removed (#62, #165);
 * - `scoreHistoryProblems`: a stored assertion was moved, deleted, or edited in
 *   place (#165);
 * - `tombstonedGroupProblems`: something was attached to a tombstoned group, or
 *   one was tombstoned without releasing its blocks (#51, #165).
 *
 * And the validator, counted **by difference**: a write is refused for an error
 * it introduces, never for one already in the document -- otherwise one stored
 * defect would lock the whole document, and a document with two could not be
 * repaired one write at a time.
 *
 * Pure: no DOM, no clock, no store.
 */
import { Analysis, validateAnalysis } from './schema/analysis.js';
import { criteriaRevisionProblems, scoreHistoryProblems } from './criteria-revision.js';
import { tombstonedGroupProblems } from './schema/anchors.js';

/** A write a provider must refuse. */
export interface RevisionProblem {
  path: string;
  message: string;
  fix: string;
}

/**
 * Why the write from `before` to `after` must be refused. Empty when it may go.
 *
 * `after` is untrusted: it is parsed here, and a shape error is reported as a
 * problem rather than thrown from inside a later check.
 */
export function revisionProblems(before: Analysis, after: unknown): RevisionProblem[] {
  const errorsOf = (doc: unknown) =>
    validateAnalysis(doc, { includeCompleteness: false }).problems.filter((p) => p.severity === 'error');
  const parsed = Analysis.safeParse(after);
  if (!parsed.success) return errorsOf(after);

  const a = parsed.data;
  // Problem identity without the path, which shifts when a list is edited.
  const key = (p: { ruleId: string; message: string }) => `${p.ruleId}\u0000${p.message}`;
  const already = new Map<string, number>();
  for (const p of errorsOf(before)) already.set(key(p), (already.get(key(p)) ?? 0) + 1);
  const introduced = errorsOf(a).filter((p) => {
    const n = already.get(key(p)) ?? 0;
    if (n === 0) return true;
    already.set(key(p), n - 1);
    return false;
  });

  return [
    ...criteriaRevisionProblems(before, a),
    ...scoreHistoryProblems(before, a),
    ...tombstonedGroupProblems(before, a),
    ...introduced,
  ];
}
