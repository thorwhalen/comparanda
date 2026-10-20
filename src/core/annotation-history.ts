/**
 * What a write may not do to the argument: threads, comments and suggestions.
 *
 * A thread is "resolvable, never deletable" (annotations.ts) because the record
 * of *why* a score moved is the point (ADR-0011). The thread functions in
 * `threads.ts` keep that promise for a caller who uses them; this is the check
 * that keeps it for one who writes the document directly (#204), the
 * annotation counterpart of `scoreHistoryProblems`. Refused:
 *
 * - a thread, a comment or a suggestion removed;
 * - a comment's id, author or time rewritten, or its body rewritten without
 *   moving `editedAt` (the edit #195 records), or `editedAt` dropped;
 * - a resolved thread reopened without a new comment, or with the resolution it
 *   had (`resolvedBy`, `resolvedAt`) dropped or rewritten -- the record
 *   `reopenThread` keeps until the next resolve overwrites it;
 * - a resolved thread's resolution rewritten while it stays resolved;
 * - a live thread or suggestion moved to another anchor. Re-attaching one whose
 *   anchor is orphaned is the repair the orphan tray exists for, and is allowed;
 * - a suggestion's author, time or proposal rewritten, or a decided suggestion
 *   decided again or reopened.
 *
 * **Repairs are exempt** the way they are for scores: a thread or suggestion id
 * that `before` already holds twice cannot be told from its twin, so neither is
 * compared, and the write that renames one is not refused.
 *
 * Pure: no DOM, no clock, no store.
 */
import type { Analysis } from './schema/analysis.js';
import { resolveAnchor } from './schema/anchors.js';
import type { Comment, Suggestion, Thread } from './schema/annotations.js';
import { canonical } from './canonical.js';

/** A write to the annotations that a provider must refuse. */
export interface AnnotationHistoryProblem {
  path: string;
  message: string;
  fix: string;
}

/** Why the change from `before` to `after` rewrites the argument. Empty when it does not. */
export function annotationHistoryProblems(
  before: Pick<Analysis, 'threads' | 'suggestions'> & Partial<Analysis>,
  after: Pick<Analysis, 'threads' | 'suggestions'>,
): AnnotationHistoryProblem[] {
  const problems: AnnotationHistoryProblem[] = [];
  const refuse = (path: string, message: string, fix: string) => problems.push({ path, message, fix });
  // Re-attaching is allowed only for an annotation the document can no longer place.
  const orphaned = (anchor: Thread['anchor']) => {
    try {
      return resolveAnchor(before as Analysis, anchor).status !== 'live';
    } catch {
      return false;
    }
  };
  const anchorMoved = (was: Thread['anchor'], now: Thread['anchor']) =>
    canonical(was) !== canonical(now) && !orphaned(was);

  const threads = indexed(after.threads);
  for (const [id, was] of unique(before.threads)) {
    const found = threads.get(id);
    if (!found) {
      refuse('threads', `thread "${id}" was removed. A thread is resolvable, never deletable: the record of why a ` +
        'score moved goes with it.', 'resolve it (resolveThread) instead; a resolved thread is hidden by default and kept.');
      continue;
    }
    const [now, i] = found;
    const at = `threads[${i}]`;
    if (anchorMoved(was.anchor, now.anchor)) {
      refuse(`${at}.anchor`, `thread "${id}" was moved to another anchor while its own still resolves, so its ` +
        'argument would read as about something it never discussed.', 'start a new thread at the new anchor.');
    }
    commentProblems(was, now, at, refuse);
    if (was.resolved) {
      const kept = was.resolvedBy === now.resolvedBy && was.resolvedAt === now.resolvedAt;
      if (now.resolved && !kept) {
        refuse(`${at}.resolvedBy`, `thread "${id}" is still resolved but its resolution was rewritten.`,
          'reopen it (reopenThread) and resolve it again.');
      } else if (!now.resolved && !kept) {
        refuse(`${at}.resolved`, `thread "${id}" was reopened with the resolution it had dropped or rewritten. ` +
          'Until it is resolved again, resolvedBy and resolvedAt are the record of who resolved it.',
        'reopen it with reopenThread, which keeps them.');
      } else if (!now.resolved && now.comments.length <= was.comments.length) {
        refuse(`${at}.resolved`, `thread "${id}" was reopened without a comment saying so.`,
          'reopen it with reopenThread, which records who reopened it and what it had been.');
      }
    }
  }

  const suggestions = indexed(after.suggestions);
  for (const [id, was] of unique(before.suggestions)) {
    const found = suggestions.get(id);
    if (!found) {
      refuse('suggestions', `suggestion "${id}" was removed. A suggestion is kept whether it is accepted or declined, ` +
        'so a reader can see what was proposed and what became of it.', 'decline it instead.');
      continue;
    }
    const [now, i] = found;
    const at = `suggestions[${i}]`;
    if (anchorMoved(was.anchor, now.anchor)) {
      refuse(`${at}.anchor`, `suggestion "${id}" was moved to another anchor while its own still resolves.`,
        'make a new suggestion at the new anchor.');
    }
    const asked = (s: Suggestion) => canonical([s.authorId, s.at, s.proposed, s.rationale]);
    if (asked(was) !== asked(now)) {
      refuse(at, `suggestion "${id}" had its author, time, proposal or rationale rewritten in place.`,
        'make a new suggestion; this one keeps what was proposed.');
    }
    const decision = (s: Suggestion) => canonical([s.status, s.decidedBy, s.decidedAt, s.decisionNote]);
    if (was.status !== 'open' && decision(was) !== decision(now)) {
      refuse(`${at}.status`, `suggestion "${id}" was ${was.status} and has been decided again or reopened. ` +
        'A decision is made once.', 'make a new suggestion if the question is open again.');
    }
  }
  return problems;
}

function commentProblems(
  was: Thread, now: Thread, at: string,
  refuse: (path: string, message: string, fix: string) => void,
): void {
  const twice = duplicated(was.comments);
  was.comments.forEach((c, j) => {
    const d = now.comments[j];
    const path = `${at}.comments[${j}]`;
    if (!d) {
      refuse(path, `comment "${c.id}" in thread "${was.id}" was removed. Comments are kept; the thread is the record.`,
        'leave it, and reply if it needs answering.');
      return;
    }
    const who = (x: Comment) => canonical([twice.has(c.id) ? '' : x.id, x.authorId, x.at]);
    if (who(c) !== who(d)) {
      refuse(path, `comment "${c.id}" in thread "${was.id}" had its id, author or time rewritten, or a comment was ` +
        'inserted before it.', 'append new comments after the existing ones, and leave those as they are.');
    } else if (c.editedAt !== undefined && d.editedAt === undefined) {
      refuse(`${path}.editedAt`, `comment "${c.id}" in thread "${was.id}" lost the record that it was edited.`,
        'keep editedAt.');
    } else if (c.body !== d.body && (d.editedAt === undefined || d.editedAt === c.editedAt)) {
      refuse(`${path}.body`, `comment "${c.id}" in thread "${was.id}" was rewritten without recording the edit, so ` +
        'replies to it would read as answering words it never had.', 'set editedAt to the time of the edit.');
    }
  });
}

/** Items by id, with their index; the first of a duplicated id (the validator reports the twin). */
function indexed<T extends { id: string }>(list: readonly T[]): Map<string, [T, number]> {
  const out = new Map<string, [T, number]>();
  list.forEach((x, i) => { if (!out.has(x.id)) out.set(x.id, [x, i]); });
  return out;
}

/** The items whose id occurs once: a duplicated id cannot be told from its twin. */
function unique<T extends { id: string }>(list: readonly T[]): [string, T][] {
  const twice = duplicated(list);
  return list.filter((x) => !twice.has(x.id)).map((x) => [x.id, x]);
}

function duplicated(list: readonly { id: string }[]): Set<string> {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const x of list) (seen.has(x.id) ? twice : seen).add(x.id);
  return twice;
}
