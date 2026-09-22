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
 *    hard delete of an alternative or a criterion.
 * 3. **`repairHint` is stored and never consulted.** Nothing here reads it, and
 *    the tests pin that a misleading hint changes nothing. A human reading an
 *    orphan may use it; resolution may not.
 *
 * Separate from `annotations.ts` because resolution needs the whole analysis,
 * and `analysis.ts` already imports the annotation shapes.
 */
import type { Analysis } from './analysis.js';
import type { Anchor, Thread } from './annotations.js';

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
 * A tombstoned alternative or criterion counts as orphaning its annotations --
 * the entity is kept so nothing is lost, but the argument no longer has a live
 * subject, and a reader must be shown that rather than left to discover it.
 */
export function resolveAnchor(a: Analysis, anchor: Anchor): AnchorResolution {
  const check = (
    kind: 'alternative' | 'criterion' | 'group', id: string | undefined,
  ): AnchorResolution | undefined => {
    if (kind === 'group') {
      return id !== undefined && a.groups.some((g) => g.id === id)
        ? undefined : { status: 'orphaned', reason: 'missing', entity: { kind, id } };
    }
    const list = kind === 'alternative' ? a.alternatives : a.criteria;
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
 * Delete an alternative or a criterion the only way this core allows: mark it
 * tombstoned, keep it and everything anchored to it. Returns a new analysis;
 * the input is not mutated. `supersededBy` records a split or merge.
 *
 * Throws on an unknown id rather than returning the input unchanged, because a
 * delete that silently did nothing is a delete the caller believes happened.
 */
export function tombstone(
  a: Analysis,
  target: { kind: 'alternative' | 'criterion'; id: string },
  { supersededBy }: { supersededBy?: readonly string[] } = {},
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
  return target.kind === 'alternative'
    ? { ...a, alternatives: mark(a.alternatives) }
    : { ...a, criteria: mark(a.criteria) };
}
