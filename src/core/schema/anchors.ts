/**
 * Resolving annotation anchors against an analysis, and deleting by tombstone.
 *
 * ADR-0011 as amended (#51). An anchor is a tuple of opaque ids, so three
 * properties follow, and this module is where they are true by behaviour rather
 * than by a comment on a schema field:
 *
 * 1. **Renaming never moves an annotation.** Resolution reads ids only; a label
 *    change cannot touch it.
 * 2. **Deleting an annotated entity is a tombstone, and its threads become
 *    visibly orphaned** -- reported with a reason -- rather than silently
 *    disappearing. `tombstone()` is the deletion this core offers; there is no
 *    hard delete of an alternative, a criterion or a group.
 * 3. **`repairHint` is stored and never consulted.** Nothing here reads it, and
 *    the tests pin that a misleading hint changes nothing. A human reading an
 *    orphan may use it; resolution may not.
 *
 * Separate from `annotations.ts` because resolution needs the whole analysis,
 * and `analysis.ts` already imports the annotation shapes.
 */
import type { Analysis } from './analysis.js';
import type { Anchor, Suggestion, Thread } from './annotations.js';
import { makeInapplicability } from './groups.js';

/** Why an anchor no longer points at something live. */
export type OrphanReason = 'missing' | 'tombstoned';

export type AnchorResolution =
  | { status: 'live' }
  | {
    status: 'orphaned';
    reason: OrphanReason;
    /** The entity that is gone or tombstoned, e.g. `{ kind: 'criterion', id: 'c3' }`. */
    entity: { kind: 'alternative' | 'criterion' | 'group'; id: string | undefined };
    /** Present when the entity was split or merged: where its successors are. */
    supersededBy?: string[];
  };

/**
 * Resolve an anchor against the analysis's current structure. Ids only.
 *
 * A tombstoned alternative, criterion or group counts as orphaning its annotations --
 * the entity is kept so nothing is lost, but the argument no longer has a live
 * subject, and a reader must be shown that rather than left to discover it.
 */
export function resolveAnchor(a: Analysis, anchor: Anchor): AnchorResolution {
  const check = (
    kind: 'alternative' | 'criterion' | 'group', id: string | undefined,
  ): AnchorResolution | undefined => {
    const list: readonly { id: string; tombstoned?: boolean | undefined; supersededBy?: string[] | undefined }[] =
      kind === 'alternative' ? a.alternatives : kind === 'criterion' ? a.criteria : a.groups;
    const found = id === undefined ? undefined : list.find((x) => x.id === id);
    if (!found) return { status: 'orphaned', reason: 'missing', entity: { kind, id } };
    if (found.tombstoned) {
      return {
        status: 'orphaned', reason: 'tombstoned', entity: { kind, id },
        ...(found.supersededBy ? { supersededBy: [...found.supersededBy] } : {}),
      };
    }
    return undefined;
  };

  const needs: ['alternative' | 'criterion' | 'group', string | undefined][] =
    anchor.scope === 'analysis' ? []
      : anchor.scope === 'alternative' ? [['alternative', anchor.alternativeId]]
        : anchor.scope === 'criterion' ? [['criterion', anchor.criterionId]]
          : anchor.scope === 'cell'
            ? [['alternative', anchor.alternativeId], ['criterion', anchor.criterionId]]
            : anchor.scope === 'group' ? [['group', anchor.groupId]]
              : [['group', anchor.groupId], ['group', anchor.otherGroupId]];
  for (const [kind, id] of needs) {
    const r = check(kind, id);
    if (r) return r;
  }
  return { status: 'live' };
}

/**
 * Every thread whose anchor no longer resolves, with the reason -- the
 * orphaned-annotation tray's contents. Resolved threads are included: hidden by
 * default is a view decision, and dropping them here would make it this
 * module's.
 */
export function orphanedThreadsOf(a: Analysis): { thread: Thread; resolution: Exclude<AnchorResolution, { status: 'live' }> }[] {
  const out: { thread: Thread; resolution: Exclude<AnchorResolution, { status: 'live' }> }[] = [];
  for (const thread of a.threads) {
    const resolution = resolveAnchor(a, thread.anchor);
    if (resolution.status === 'orphaned') out.push({ thread, resolution });
  }
  return out;
}

/**
 * Every suggestion whose anchor no longer resolves, with the reason.
 *
 * Suggestions are anchored exactly as threads are, so a suggestion against a
 * tombstoned criterion is the same silent loss #51 forbids if nothing lists it.
 * Decided suggestions are included for the same reason resolved threads are.
 */
export function orphanedSuggestionsOf(a: Analysis): { suggestion: Suggestion; resolution: Exclude<AnchorResolution, { status: 'live' }> }[] {
  const out: { suggestion: Suggestion; resolution: Exclude<AnchorResolution, { status: 'live' }> }[] = [];
  for (const suggestion of a.suggestions) {
    const resolution = resolveAnchor(a, suggestion.anchor);
    if (resolution.status === 'orphaned') out.push({ suggestion, resolution });
  }
  return out;
}

/**
 * Delete an alternative, a criterion or a group the only way this core allows:
 * mark it tombstoned, keep it and everything anchored to it. Returns a new
 * analysis; the input is not mutated. `supersededBy` records a split or merge.
 *
 * Throws on an unknown id rather than returning the input unchanged, because a
 * delete that silently did nothing is a delete the caller believes happened.
 *
 * A tombstoned group stops grouping, so the inapplicable blocks naming it stop
 * applying and the cells they excused become outstanding work. That is the
 * #51 decision; doing it *silently* is what #165 found. So tombstoning a group
 * that would reopen cells throws, naming how many, unless the caller passes
 * `reopensInapplicable: true` -- the same "say what you meant" as `material` on
 * `reviseCriterion`. `reopenedByTombstone` answers the question first, for a
 * confirmation prompt.
 */
export function tombstone(
  a: Analysis,
  target: { kind: 'alternative' | 'criterion' | 'group'; id: string },
  { supersededBy, reopensInapplicable = false }: {
    supersededBy?: readonly string[];
    /** Required to tombstone a group whose inapplicable blocks currently excuse cells. */
    reopensInapplicable?: boolean;
  } = {},
): Analysis {
  const mark = <T extends { id: string; tombstoned?: boolean | undefined; supersededBy?: string[] | undefined }>(
    list: readonly T[],
  ): T[] => {
    if (!list.some((x) => x.id === target.id)) {
      throw new Error(`no ${target.kind} with id "${target.id}" to tombstone`);
    }
    return list.map((x) => (x.id === target.id
      ? { ...x, tombstoned: true, ...(supersededBy ? { supersededBy: [...supersededBy] } : {}) }
      : x));
  };
  // Checked at runtime too: a JS caller passing any other kind would otherwise
  // silently tombstone something else.
  if (target.kind === 'alternative') return { ...a, alternatives: mark(a.alternatives) };
  if (target.kind === 'criterion') return { ...a, criteria: mark(a.criteria) };
  if (target.kind === 'group') {
    const after = { ...a, groups: mark(a.groups) };
    if (!reopensInapplicable) {
      const reopened = reopenedBetween(a, after);
      if (reopened.length > 0) {
        throw new Error(
          `tombstoning group "${target.id}" would reopen ${reopened.length} cell${reopened.length === 1 ? '' : 's'} ` +
            'its inapplicable blocks currently excuse; they would become outstanding work. ' +
            'Pass reopensInapplicable: true if that is meant, or declare the blocks on another group first.',
        );
      }
    }
    return after;
  }
  throw new Error(
    `cannot tombstone a "${String(target.kind)}": only alternatives, criteria and groups carry a tombstone.`,
  );
}

/** A live (alternative, criterion) pair. */
export interface CellPair { alternativeId: string; criterionId: string }

/**
 * The live pairs that tombstoning this group would turn from structurally
 * inapplicable into outstanding. Empty for a group no block names.
 */
export function reopenedByTombstone(a: Analysis, groupId: string): CellPair[] {
  if (!a.groups.some((g) => g.id === groupId)) throw new Error(`no group with id "${groupId}"`);
  return reopenedBetween(a, {
    ...a, groups: a.groups.map((g) => (g.id === groupId ? { ...g, tombstoned: true } : g)),
  });
}

function reopenedBetween(before: Analysis, after: Analysis): CellPair[] {
  if (before.inapplicable.length === 0) return [];
  const was = makeInapplicability(before);
  const now = makeInapplicability(after);
  const out: CellPair[] = [];
  for (const alt of before.alternatives) {
    if (alt.tombstoned) continue;
    for (const crit of before.criteria) {
      if (!crit.tombstoned && was(alt.id, crit.id) && !now(alt.id, crit.id)) {
        out.push({ alternativeId: alt.id, criterionId: crit.id });
      }
    }
  }
  return out;
}

/** A write a store must refuse because it builds on a tombstoned group. */
export interface TombstoneProblem {
  path: string;
  message: string;
  fix: string;
}

/**
 * What the change from `before` to `after` adds to a group that was already
 * tombstoned: a new member, a new child group, or a new inapplicable block.
 *
 * A tombstoned group is kept so its annotations stay readable, and groups
 * nothing; anything newly attached to it would be silently ignored by every
 * reader, which is the defect #165 found. What was attached when it was
 * tombstoned stays, as history. A write path runs this beside
 * `criteriaRevisionProblems`; the in-memory analysis source does.
 */
export function tombstonedGroupProblems(
  before: Pick<Analysis, 'groups' | 'alternatives' | 'criteria' | 'inapplicable'>,
  after: Pick<Analysis, 'groups' | 'alternatives' | 'criteria' | 'inapplicable'>,
): TombstoneProblem[] {
  const dead = new Set(before.groups.filter((g) => g.tombstoned).map((g) => g.id));
  for (const g of after.groups) if (!g.tombstoned) dead.delete(g.id);
  if (dead.size === 0) return [];
  const problems: TombstoneProblem[] = [];
  const refuse = (path: string, what: string, gid: string) => problems.push({
    path,
    message: `${what} group "${gid}", which is tombstoned. A tombstoned group groups nothing, so this would be ` +
      'ignored by every reader.',
    fix: 'attach it to a live group, or revive the group first by clearing its tombstone.',
  });

  for (const [axis, list, was] of [
    ['alternatives', after.alternatives, before.alternatives],
    ['criteria', after.criteria, before.criteria],
  ] as const) {
    const prior = new Map(was.map((x) => [x.id, new Set(x.groupIds)]));
    list.forEach((x, i) => {
      for (const gid of x.groupIds) {
        if (dead.has(gid) && !prior.get(x.id)?.has(gid)) refuse(`${axis}[${i}].groupIds`, `"${x.id}" was added to`, gid);
      }
    });
  }
  const priorParent = new Map(before.groups.map((g) => [g.id, g.parentId]));
  after.groups.forEach((g, i) => {
    if (g.parentId !== undefined && dead.has(g.parentId) && priorParent.get(g.id) !== g.parentId) {
      refuse(`groups[${i}].parentId`, `group "${g.id}" was nested under`, g.parentId);
    }
  });
  const priorBlocks = new Set(before.inapplicable.map((b) => JSON.stringify([b.alternativeGroupId, b.criterionGroupId])));
  after.inapplicable.forEach((b, i) => {
    if (priorBlocks.has(JSON.stringify([b.alternativeGroupId, b.criterionGroupId]))) return;
    for (const gid of [b.alternativeGroupId, b.criterionGroupId]) {
      if (dead.has(gid)) refuse(`inapplicable[${i}]`, 'a new inapplicable block names', gid);
    }
  });
  return problems;
}
