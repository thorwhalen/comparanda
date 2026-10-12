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
import { cellKey, compareCriteriaVersions } from './schema/analysis.js';
import type { Assertion } from './schema/values.js';
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
 * - a criterion that disappeared while anything referred to it -- a cell, a
 *   thread or a suggestion. Deleting one is `tombstone`, which keeps it.
 *   Without this, the guard compares each criterion only with its previous
 *   self, so removing it in one write and adding it back with a new meaning in
 *   the next stored a new meaning against old scores with no version bump
 *   (#165). An unreferenced criterion -- one dropped during elicitation before
 *   anything was scored or said about it -- has no history to rewrite, and may go.
 *
 * Scores *moved* between criteria, or relabelled with a later version, are
 * `scoreHistoryProblems`' half of the same guard; `revisionProblems` runs both.
 *
 * An absent set version reads as `"1"` throughout, as in `nextCriteriaVersion`:
 * an unversioned set "bumped" to `"1"` or `"0"` has not moved. A new criterion
 * has no earlier meaning to rewrite and is not compared.
 */
export function criteriaRevisionProblems(
  before: Pick<Analysis, 'criteria' | 'criteriaVersion'> &
    Partial<Pick<Analysis, 'cells' | 'threads' | 'suggestions' | 'scales' | 'missingCodes'>>,
  after: Pick<Analysis, 'criteria' | 'criteriaVersion'> & Partial<Pick<Analysis, 'scales' | 'missingCodes'>>,
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

  // A declared missingness code is what every stored blank using it means:
  // flipping it to structural moves those blanks from outstanding to excused.
  // The set version is the record that the frame changed (#165).
  const declared = new Map((before.missingCodes ?? []).map((d) => [d.id, canonical(d)]));
  if (!moved) {
    (after.missingCodes ?? []).forEach((d, i) => {
      const was = declared.get(d.id);
      if (was !== undefined && was !== canonical(d)) {
        problems.push({
          path: `missingCodes[${i}]`,
          message: `the missingness code "${d.id}" changed its declaration but the criteria-set version did not move. ` +
            'Every stored blank using it would silently change meaning.',
          fix: 'move criteriaVersion forward with the change, or declare a new code and use it from now on.',
        });
      }
    });
  }

  const kept = new Set(after.criteria.map((c) => c.id));
  const referenced = new Set([
    // An empty cell holds no score, so it is no history to protect.
    ...(before.cells ?? []).filter((c) => c.assertions.length > 0).map((c) => c.criterionId),
    ...[...(before.threads ?? []), ...(before.suggestions ?? [])].map((t) => t.anchor.criterionId),
  ]);
  before.criteria.forEach((c, i) => {
    if (kept.has(c.id) || !referenced.has(c.id)) return;
    problems.push({
      path: `criteria[${i}]`,
      message: `criterion "${c.id}" was removed from the document while cells or annotations refer to it. ` +
        'A removed criterion can come back under the same id with a different meaning and no version bump.',
      fix: 'tombstone it instead (`tombstone(a, {kind: "criterion", id})`), which keeps it and its history.',
    });
  });

  after.criteria.forEach((c, i) => {
    const at = `criteria[${i}]`;
    const prev = old.get(c.id);
    if (prev) {
      const changed: string[] = CRITERION_MEANING_FIELDS.filter((f) => canonical(prev[f]) !== canonical(c[f]));
      // A criterion authored to a named scale means what the scale declares:
      // rewriting the declaration rewrites the criterion (#165).
      if (scalesMeaning(before, prev) !== scalesMeaning(after, c)) changed.push('scale declaration');
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

/** The declarations of every named scale a criterion's measurements are authored to. */
function scalesMeaning(doc: Partial<Pick<Analysis, 'scales'>>, c: Criterion): string {
  const ids = new Set(
    [c.defaultMeasurement, ...Object.values(c.measurements ?? {})].flatMap((m) => (m?.scale ? [m.scale] : [])),
  );
  return canonical((doc.scales ?? []).filter((d) => ids.has(d.id)).sort((x, y) => (x.id < y.id ? -1 : 1)));
}

/** JSON with sorted keys, so a reordered object is not mistaken for a changed one. */
function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, (x as Record<string, unknown>)[k]]))
      : x) ?? 'undefined';
}

/**
 * What was asserted: a stored assertion without the fields that may change --
 * the concurrency token, the disclosure declaration (a view-time property,
 * ADR-0021), `supersededBy` (set once), and evidence (checked by `evidenceKept`).
 */
function assertedContent(s: Assertion): string {
  const { version: _v, disclosure: _d, supersededBy: _s, evidence: _e, ...rest } = s;
  return canonical(rest);
}

/** Evidence without its re-runnable check. Appending a citation is allowed; changing or removing one is not. */
function evidenceKept(s: Assertion, t: Assertion): boolean {
  const strip = (x: Assertion) => (x.evidence ?? []).map(({ check: _c, ...e }) => canonical(e));
  const was = strip(s);
  const now = strip(t);
  return was.length <= now.length && was.every((e, i) => e === now[i]);
}

/**
 * What the change from `before` to `after` does to scores already given.
 *
 * Assertions are retained, never deleted, and a change of mind is a new
 * assertion that supersedes the old one (`Assertion.supersededBy`). So an
 * assertion stored in `before` must still be in the same cell in `after`, and
 * unchanged except for `version`, `disclosure`, its evidence's `check`, new
 * evidence appended after the old, and a `supersededBy` set once. Refused otherwise, because each of these rewrote
 * what an old score meant (#165):
 *
 * - cells moved onto another criterion, new or existing -- the old score now
 *   answers a question it was never asked;
 * - an old assertion's `criteriaVersion` rewritten to the current version, which
 *   makes a superseded score read as current;
 * - a value, justification, `independence` or evidence edited in place --
 *   `independence` above all, which is the one fact no later reader can recover.
 *
 * **Repairs are exempt.** An assertion that `before` already reports as broken
 * -- a dangling or cyclic `supersededBy`, a duplicate id in its cell -- may be
 * changed or renamed, or the document could never be fixed.
 *
 * **The threat model, stated so it is not mistaken for more.** This stops a
 * write from silently rewriting a *stored* claim. It cannot stop a *new* one: a
 * writer can always assert something today, including a copy of an old score
 * under the current version that supersedes the original. That is a claim
 * attributed to its author, visible as a new assertion with its own id, and
 * whether that author may make it is identity and authorisation (ADR-0012,
 * `Analysis.locked`), not this guard.
 */
export function scoreHistoryProblems(
  before: Pick<Analysis, 'cells'>,
  after: Pick<Analysis, 'cells'>,
  { repairable = new Set<string>() }: {
    /** Assertions `before` already reports as broken, as `JSON.stringify([cellKey, index in its cell])`. */
    repairable?: ReadonlySet<string>;
  } = {},
): CriteriaRevisionProblem[] {
  const problems: CriteriaRevisionProblem[] = [];
  // Every assertion by id, in a list: a cell that already holds a duplicate id
  // must not have its healthy original compared against its twin.
  const now = new Map<string, Map<string, Assertion[]>>();
  for (const c of after.cells) {
    const byId = new Map<string, Assertion[]>();
    for (const s of c.assertions ?? []) byId.set(s.id, [...(byId.get(s.id) ?? []), s]);
    now.set(cellKey(c.alternativeId, c.criterionId, c.measure), byId);
  }
  before.cells.forEach((cell, i) => {
    const key = cellKey(cell.alternativeId, cell.criterionId, cell.measure);
    const there = now.get(key);
    cell.assertions.forEach((s, j) => {
      if (repairable.has(JSON.stringify([key, j]))) return;
      const at = `cells[${i}].assertions[${j}]`;
      const candidates = there?.get(s.id) ?? [];
      if (candidates.length === 0) {
        problems.push({
          path: at,
          message: `assertion "${s.id}" on ${cell.alternativeId} x ${cell.criterionId} (${cell.measure}) is gone from ` +
            'its cell. Assertions are retained, never deleted, and a score moved to another cell answers a ' +
            'question it was never asked.',
          fix: 'leave it in place; record a change of mind as a new assertion and set supersededBy on this one.',
        });
        return;
      }
      const t = candidates.find((x) => assertedContent(x) === assertedContent(s) && evidenceKept(s, x)) ?? candidates[0]!;
      const rewritten = assertedContent(s) !== assertedContent(t) || !evidenceKept(s, t);
      const repointed = s.supersededBy !== undefined && t.supersededBy !== s.supersededBy;
      if (rewritten || repointed) {
        problems.push({
          path: at,
          message: `assertion "${s.id}" on ${cell.alternativeId} x ${cell.criterionId} was ` +
            `${rewritten ? 'edited in place' : 'given a different supersededBy'}, which rewrites what was asserted.`,
          fix: 'add a new assertion and set supersededBy on this one; supersededBy, once set, does not change.',
        });
      }
    });
  });
  return problems;
}
