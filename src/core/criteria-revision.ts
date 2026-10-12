/**
 * Changing what a criterion means, without rewriting what earlier scores meant.
 *
 * A criterion's definition changes during elicitation -- that is the point of
 * eliciting the frame before scoring -- and a score made against the old wording
 * is not comparable to one made against the new. #62 asks that **changing a
 * definition bump the criteria-set version rather than silently rewriting
 * history**. Two pieces make that true:
 *
 * - `reviseCriterion` is the way to make the change. It always moves the set's
 *   `criteriaVersion`, so the document records that the frame changed. Whether
 *   the change was *material* is the author's declaration, and decides one thing:
 *   whether the criterion's `definedInVersion` moves with it, which is what makes
 *   `supersededCells` report the scores given before it. A typo fix is a new set
 *   version that supersedes nothing; a moved boundary supersedes every score
 *   given under the old one.
 * - `criteriaRevisionProblems(before, after)` is the check a write path runs, so
 *   a change that bypassed `reviseCriterion` is refused rather than stored. The
 *   in-memory analysis source runs it on every `update`.
 *
 * Pure functions over plain documents: no DOM, no clock, no store.
 */
import type { Analysis } from './schema/analysis.js';
import { compareCriteriaVersions } from './schema/analysis.js';
import type { Criterion } from './schema/structure.js';

/**
 * The fields that carry what a criterion *means*. Editing any of them changes
 * the question a score answers. Weights, groups and provenance do not: they are
 * how much the criterion matters and where it sits, not what it asks.
 */
export const CRITERION_MEANING_FIELDS = Object.freeze([
  'label', 'definition', 'measurements', 'defaultMeasurement', 'acceptability', 'missingCodes',
] as const satisfies readonly (keyof Criterion)[]);

export type CriterionMeaningField = (typeof CRITERION_MEANING_FIELDS)[number];

/** A change to what a criterion means. */
export type CriterionRevision = Partial<Pick<Criterion, CriterionMeaningField>>;

/**
 * The version after `current`.
 *
 * A dotted-integer version bumps its last segment (`"3"` -> `"4"`,
 * `"1.2"` -> `"1.3"`). An absent version reads as `"1"`, so the first revision
 * of an unversioned set produces `"2"`: any score recorded against the set as it
 * stood then is earlier than the revision, which is what it is. Anything else
 * cannot be incremented without guessing, and throws -- pass `nextVersion`.
 */
export function nextCriteriaVersion(current: string | undefined): string {
  if (current === undefined) return '2';
  const m = /^([vV]?)((?:\d+\.)*)(\d+)$/.exec(current);
  if (!m) {
    throw new Error(
      `cannot increment the criteria-set version "${current}": it is not a dotted-integer version. ` +
        'Pass nextVersion explicitly, in a form compareCriteriaVersions can order after it.',
    );
  }
  return `${m[1]}${m[2]}${(BigInt(m[3]!) + 1n).toString()}`;
}

/**
 * Revise one criterion's meaning, bumping the criteria-set version.
 *
 * `material` is required, because it is the author's claim and the one thing
 * the tool cannot infer: whether scores given under the old wording still answer
 * the new question. When it is `true` the criterion's `definedInVersion` moves to
 * the new set version and those scores become superseded; when `false` the set
 * version still moves -- the edit is on record -- and nothing is superseded.
 *
 * Returns a new document; the input is not modified.
 */
export function reviseCriterion(
  a: Analysis,
  criterionId: string,
  revision: CriterionRevision,
  { material, nextVersion }: { material: boolean; nextVersion?: string },
): Analysis {
  const i = a.criteria.findIndex((c) => c.id === criterionId);
  if (i < 0) throw new Error(`no criterion "${criterionId}" in analysis "${a.id}".`);
  const version = nextVersion ?? nextCriteriaVersion(a.criteriaVersion);
  if (compareCriteriaVersions(version, effectiveCriteriaVersion(a.criteriaVersion)) !== 1) {
    throw new Error(
      `the next criteria-set version "${version}" does not come after the current ` +
        `"${effectiveCriteriaVersion(a.criteriaVersion)}"${a.criteriaVersion === undefined ? ' (an unversioned set reads as "1")' : ''}. ` +
        'A version that does not order after the last one cannot say which scores came before the change.',
    );
  }
  const unknown = Object.keys(revision).filter((k) => !(CRITERION_MEANING_FIELDS as readonly string[]).includes(k));
  if (unknown.length) {
    throw new Error(
      `reviseCriterion changes what a criterion means; ${unknown.join(', ')} ` +
        `${unknown.length === 1 ? 'is' : 'are'} not part of that. Edit ${unknown.length === 1 ? 'it' : 'them'} directly.`,
    );
  }
  const before = a.criteria[i]!;
  const revised: Criterion = {
    ...before,
    ...revision,
    ...(material ? { definedInVersion: version } : {}),
  };
  const criteria = a.criteria.slice();
  criteria[i] = revised;
  return { ...a, criteria, criteriaVersion: version };
}

/**
 * The version a set is at, reading an absent version as `"1"` -- the same
 * reading `nextCriteriaVersion` makes. One reading, so that "the first revision
 * of an unversioned set" cannot be `"1"` in one function and `"2"` in another.
 */
export function effectiveCriteriaVersion(v: string | undefined): string {
  return v ?? '1';
}

/** A revision a write path must refuse. */
export interface CriteriaRevisionProblem {
  path: string;
  message: string;
  fix: string;
}

/**
 * What is wrong with the change from `before` to `after`, as far as criterion
 * versioning goes. Empty when nothing is.
 *
 * Refused:
 *
 * - a criterion whose meaning changed while the criteria-set version did not
 *   move forward -- the silent rewrite #62 exists to stop;
 * - a `definedInVersion` that moved backwards, which would make superseded
 *   scores read as current;
 * - a `definedInVersion` later than the set's own version, which claims a
 *   change the set never recorded;
 * - a set version that moved backwards, or was dropped, which would make
 *   assertions scored under the later version read as from the future;
 * - a criterion that disappeared. Deleting one is `tombstone`, which keeps it.
 *   Without this, the guard compares each criterion only with its previous
 *   self, so removing it in one write and adding it back with a new meaning in
 *   the next -- or renaming its id and carrying its cells along -- stored a new
 *   meaning against old scores with no version bump (#165). A criterion that
 *   cannot leave the document cannot come back as something else.
 *
 * An absent set version reads as `"1"` throughout, as in `nextCriteriaVersion`:
 * an unversioned set "bumped" to `"1"` or `"0"` has not moved. A new criterion
 * has no earlier meaning to rewrite and is not compared.
 */
export function criteriaRevisionProblems(
  before: Pick<Analysis, 'criteria' | 'criteriaVersion'>,
  after: Pick<Analysis, 'criteria' | 'criteriaVersion'>,
): CriteriaRevisionProblem[] {
  const problems: CriteriaRevisionProblem[] = [];
  const old = new Map(before.criteria.map((c) => [c.id, c]));
  const was = effectiveCriteriaVersion(before.criteriaVersion);
  const now = effectiveCriteriaVersion(after.criteriaVersion);
  const order = compareCriteriaVersions(now, was);
  const moved = order === 1;

  if (order === -1 || (before.criteriaVersion !== undefined && after.criteriaVersion === undefined)) {
    problems.push({
      path: 'criteriaVersion',
      message: `the criteria-set version moved from "${was}" back to ` +
        `${after.criteriaVersion === undefined ? 'nothing (which reads as "1")' : `"${now}"`}. Assertions record the ` +
        'version they were scored against, and those scored under the later one would read as from the future.',
      fix: 'leave the version where it is, or move it forward.',
    });
  }

  const kept = new Set(after.criteria.map((c) => c.id));
  before.criteria.forEach((c, i) => {
    if (kept.has(c.id)) return;
    problems.push({
      path: `criteria[${i}]`,
      message: `criterion "${c.id}" was removed from the document. A removed criterion can come back under the ` +
        'same id, or its scores under a new one, with a different meaning and no version bump.',
      fix: 'tombstone it instead (`tombstone(a, {kind: "criterion", id})`), which keeps it and its history.',
    });
  });

  after.criteria.forEach((c, i) => {
    const at = `criteria[${i}]`;
    const prev = old.get(c.id);
    if (prev) {
      const changed = CRITERION_MEANING_FIELDS.filter((f) => canonical(prev[f]) !== canonical(c[f]));
      if (changed.length && !moved) {
        problems.push({
          path: at,
          message: `criterion "${c.id}" changed its ${changed.join(', ')} but the criteria-set version ` +
            `${before.criteriaVersion === undefined ? 'was not set' : `stayed at "${before.criteriaVersion}"`}. ` +
            'Scores given under the old wording would silently read as answers to the new one.',
          fix: 'make the change through reviseCriterion, declaring whether it is material; it bumps the version.',
        });
      }
      if (prev.definedInVersion !== undefined && c.definedInVersion !== prev.definedInVersion &&
        (c.definedInVersion === undefined || compareCriteriaVersions(c.definedInVersion, prev.definedInVersion) !== 1)) {
        problems.push({
          path: `${at}.definedInVersion`,
          message: `criterion "${c.id}" moved its definedInVersion from "${prev.definedInVersion}" to ` +
            `${c.definedInVersion === undefined ? 'nothing' : `"${c.definedInVersion}"`}, which would make scores ` +
            'superseded by the last change read as current.',
          fix: 'leave definedInVersion where it is, or move it forward with a material revision.',
        });
      }
    }
    if (c.definedInVersion !== undefined && compareCriteriaVersions(c.definedInVersion, now) === 1) {
      problems.push({
        path: `${at}.definedInVersion`,
        message: `criterion "${c.id}" claims to be defined in "${c.definedInVersion}", later than the ` +
          `criteria-set version "${now}"${after.criteriaVersion === undefined ? ' (an unversioned set reads as "1")' : ''}.`,
        fix: 'set definedInVersion to the set version at which the criterion last changed meaning.',
      });
    }
  });
  return problems;
}

/** JSON with sorted keys, so a reordered object is not mistaken for a changed one. */
function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, (x as Record<string, unknown>)[k]]))
      : x) ?? 'undefined';
}
