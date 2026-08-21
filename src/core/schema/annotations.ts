/**
 * Annotations: threaded comments anchored anywhere in the matrix.
 *
 * A comparison is produced, then argued over, amended, and used to bring a group
 * to a decision. A tool that only supports authoring -- and treats the argument
 * as something that happens elsewhere -- loses the reasoning exactly where it is
 * most valuable, and the artifact decays into a screenshot.
 *
 * Anchors are **tuples of stable opaque ids and nothing else.** Google's own
 * document API concedes that its anchors' "position relative to the content of a
 * document cannot be guaranteed between revisions" -- a defeat forced by text
 * having no stable identity. We are not in that situation: alternatives and
 * criteria are entities we mint, so an anchor can point at an id that never
 * moves however the matrix is reordered or relabelled. The label is kept only as
 * a repair hint for a human reading an orphan, and is never used to resolve.
 */
import * as z from 'zod/mini';

export const AnchorScope = z.enum([
  'analysis',
  'alternative',
  'criterion',
  'cell',
  'group',
  'group-pair',
]);
export type AnchorScope = z.infer<typeof AnchorScope>;

/**
 * Where a thread is attached.
 *
 * Criterion-level is where definitional arguments live -- "what do we even mean
 * by reachability" -- and those are frequently the most valuable threads in the
 * document, which is why the scope exists at all rather than everything hanging
 * off cells.
 */
export const Anchor = z.object({
  scope: AnchorScope,
  alternativeId: z.optional(z.string()),
  criterionId: z.optional(z.string()),
  measure: z.optional(z.string()),
  groupId: z.optional(z.string()),
  otherGroupId: z.optional(z.string()),
  /**
   * The label at the time of anchoring. **Never used for resolution** -- purely
   * so a human looking at an orphaned thread can tell what it was about.
   */
  repairHint: z.optional(z.string()),
});
export type Anchor = z.infer<typeof Anchor>;

export const Comment = z.object({
  id: z.string(),
  authorId: z.string(),
  at: z.string(),
  body: z.string(),
  editedAt: z.optional(z.string()),
});
export type Comment = z.infer<typeof Comment>;

/**
 * A thread. Resolvable, never deletable: the record of *why* a score moved is
 * the point, and a resolved thread that vanishes takes the reasoning with it.
 */
export const Thread = z.object({
  id: z.string(),
  anchor: Anchor,
  comments: z._default(z.array(Comment), []),
  resolved: z._default(z.boolean(), false),
  resolvedBy: z.optional(z.string()),
  resolvedAt: z.optional(z.string()),
});
export type Thread = z.infer<typeof Thread>;

/**
 * A proposed edit from someone without write access, or against a locked
 * analysis. This is how a reviewer participates without mutating a shared
 * artifact.
 */
export const Suggestion = z.object({
  id: z.string(),
  anchor: Anchor,
  authorId: z.string(),
  at: z.string(),
  /** The proposed assertion, as it would be written if accepted. */
  proposed: z.unknown(),
  rationale: z.optional(z.string()),
  status: z._default(z.enum(['open', 'accepted', 'declined', 'superseded']), 'open'),
  decidedBy: z.optional(z.string()),
  decidedAt: z.optional(z.string()),
  decisionNote: z.optional(z.string()),
});
export type Suggestion = z.infer<typeof Suggestion>;

/** Whether an anchor still resolves against the current structure. */
export function anchorResolves(
  anchor: Anchor,
  known: { alternativeIds: ReadonlySet<string>; criterionIds: ReadonlySet<string>; groupIds: ReadonlySet<string> },
): boolean {
  switch (anchor.scope) {
    case 'analysis':
      return true;
    case 'alternative':
      return !!anchor.alternativeId && known.alternativeIds.has(anchor.alternativeId);
    case 'criterion':
      return !!anchor.criterionId && known.criterionIds.has(anchor.criterionId);
    case 'cell':
      return (
        !!anchor.alternativeId && known.alternativeIds.has(anchor.alternativeId) &&
        !!anchor.criterionId && known.criterionIds.has(anchor.criterionId)
      );
    case 'group':
      return !!anchor.groupId && known.groupIds.has(anchor.groupId);
    case 'group-pair':
      return (
        !!anchor.groupId && known.groupIds.has(anchor.groupId) &&
        !!anchor.otherGroupId && known.groupIds.has(anchor.otherGroupId)
      );
  }
}

/**
 * Threads whose anchor no longer resolves.
 *
 * These get a visible tray in the UI rather than silent deletion. An argument
 * that lost its subject is still an argument somebody had, and it is usually
 * evidence that something was removed which should not have been.
 */
export function orphanedThreads(
  threads: readonly Thread[],
  known: { alternativeIds: ReadonlySet<string>; criterionIds: ReadonlySet<string>; groupIds: ReadonlySet<string> },
): Thread[] {
  return threads.filter((t) => !anchorResolves(t.anchor, known));
}
