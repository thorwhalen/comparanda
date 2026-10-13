/**
 * Annotation threads at every scope (#106, ADR-0011 clauses 1-2): which threads
 * bear on a position in the matrix, and the five writes a thread takes --
 * start, reply, edit, resolve, reopen.
 *
 * A thread is anchored by ids only (`anchors.ts`), so renaming a criterion or
 * reordering the matrix never moves it; this module only ever compares ids.
 * Resolving hides a thread by default and never deletes it: `resolveThread`
 * sets a flag and who set it, and there is no function here that removes a
 * thread or a comment.
 *
 * Every write is a pure function from an analysis to the next one. Ids and
 * times are the caller's: core mints nothing and owns no clock, so the same
 * inputs give the same document. The comment's author is written into
 * `authors` when the document does not yet describe them, so every comment
 * names someone the document can show (ADR-0012).
 */
import type { Analysis } from './schema/analysis.js';
import type { Anchor, Comment, Thread } from './schema/annotations.js';
import { resolveAnchor } from './schema/anchors.js';
import { axisGroups, groupsOf } from './schema/groups.js';
import type { Author } from './schema/provenance.js';
import type { EditTarget } from './affordances.js';
import { attribution, attributions } from './identity.js';

/** Where a reader is: both ids a cell, one a header, none the analysis as a whole. */
export interface Position {
  alternativeId?: string | undefined;
  criterionId?: string | undefined;
}

/**
 * How a thread's anchor bears on a position: `here` is anchored on it; `group`
 * on a group the alternative or criterion belongs to; `group-pair` on a
 * group-pair block covering the cell. At the analysis as a whole, `here` is the
 * analysis's own threads, and every group and group-pair thread is listed too,
 * since a group band is a label and not a place the reader can stand.
 */
export type ThreadRelation = 'here' | 'group' | 'group-pair';

export interface ThreadAt {
  thread: Thread;
  relation: ThreadRelation;
}

/**
 * Every live-anchored thread bearing on a position, resolved ones included and
 * marked by `thread.resolved`: hiding them is the view's default, not this
 * module's. A thread whose anchor no longer resolves is not listed here; it
 * belongs to the orphan tray (`orphanedThreadsOf`).
 */
export function threadsAt(a: Analysis, position: Position): ThreadAt[] {
  const { alternativeId, criterionId } = position;
  const alternative = alternativeId === undefined ? undefined : a.alternatives.find((x) => x.id === alternativeId);
  const criterion = criterionId === undefined ? undefined : a.criteria.find((x) => x.id === criterionId);
  // With the groups' ancestors: a thread on a parent group bears on its subgroups' members too.
  const altGroups = new Set(alternative ? groupsOf(axisGroups(a, 'alternatives'), alternative.id) : []);
  const critGroups = new Set(criterion ? groupsOf(axisGroups(a, 'criteria'), criterion.id) : []);
  const relationOf = (anchor: Anchor): ThreadRelation | undefined => {
    switch (anchor.scope) {
      case 'analysis':
        return !alternative && !criterion ? 'here' : undefined;
      case 'alternative':
        return alternative && !criterion && anchor.alternativeId === alternative.id ? 'here' : undefined;
      case 'criterion':
        return criterion && !alternative && anchor.criterionId === criterion.id ? 'here' : undefined;
      case 'cell':
        return alternative && criterion && anchor.alternativeId === alternative.id && anchor.criterionId === criterion.id
          ? 'here' : undefined;
      case 'group': {
        if (!alternative && !criterion) return 'group';
        if (alternative && criterion) return undefined;
        const groups = alternative ? altGroups : critGroups;
        return anchor.groupId !== undefined && groups.has(anchor.groupId) ? 'group' : undefined;
      }
      case 'group-pair': {
        if (!alternative && !criterion) return 'group-pair';
        if (!alternative || !criterion) return undefined;
        const [g, h] = [anchor.groupId ?? '', anchor.otherGroupId ?? ''];
        return (altGroups.has(g) && critGroups.has(h)) || (altGroups.has(h) && critGroups.has(g)) ? 'group-pair' : undefined;
      }
    }
  };
  const out: ThreadAt[] = [];
  for (const thread of a.threads) {
    const relation = relationOf(thread.anchor);
    if (relation === undefined || resolveAnchor(a, thread.anchor).status !== 'live') continue;
    out.push({ thread, relation });
  }
  return out;
}

/** What a comment carries before it is written: the caller mints the id and the time. */
export interface NewComment {
  id: string;
  at: string;
  body: string;
  author: Author;
}

/**
 * What a thread's anchor is, as `Affordances.comment` -- and through it the
 * host's `authorize` -- is asked about it.
 */
export function commentTarget(anchor: Anchor): EditTarget {
  switch (anchor.scope) {
    case 'cell': return { kind: 'cell', id: `${anchor.alternativeId ?? ''}/${anchor.criterionId ?? ''}` };
    case 'alternative': return { kind: 'alternative', id: anchor.alternativeId ?? '' };
    case 'criterion': return { kind: 'criterion', id: anchor.criterionId ?? '' };
    case 'group': return { kind: 'group', id: anchor.groupId ?? '' };
    case 'group-pair': return { kind: 'group-pair', id: `${anchor.groupId ?? ''}/${anchor.otherGroupId ?? ''}` };
    case 'analysis': return { kind: 'analysis' };
  }
}

/** Start a thread on a live anchor, with its first comment. */
export function startThread(a: Analysis, { threadId, anchor, comment }: { threadId: string; anchor: Anchor; comment: NewComment }): Analysis {
  const resolution = resolveAnchor(a, anchor);
  if (resolution.status !== 'live') {
    throw new Error(
      `cannot start a thread on a ${anchor.scope} that is ${resolution.reason === 'tombstoned' ? 'deleted (tombstoned)' : 'not in this analysis'}: ` +
        `the ${resolution.entity.kind} "${resolution.entity.id ?? ''}" is not live.`,
    );
  }
  requireNewId(a, threadId);
  const thread: Thread = { id: threadId, anchor: { ...anchor }, comments: [commentOf(comment)], resolved: false };
  return { ...withAuthor(a, comment.author), threads: [...a.threads, thread] };
}

/** Answer an open thread. A resolved thread takes no reply: its record stays as it was resolved. */
export function replyToThread(a: Analysis, threadId: string, comment: NewComment): Analysis {
  const thread = openThread(a, threadId, 'answer');
  if (thread.comments.some((c) => c.id === comment.id)) throw new Error(`comment id "${comment.id}" is already used in this thread.`);
  return {
    ...withAuthor(a, comment.author),
    threads: a.threads.map((t) => (t === thread ? { ...t, comments: [...t.comments, commentOf(comment)] } : t)),
  };
}

/** Resolve an open thread: hidden by default from then on, never deleted. */
export function resolveThread(a: Analysis, threadId: string, { by, at }: { by: Author; at: string }): Analysis {
  const thread = openThread(a, threadId, 'resolve');
  return {
    ...withAuthor(a, by),
    threads: a.threads.map((t) => (t === thread ? { ...t, resolved: true, resolvedBy: by.id, resolvedAt: at } : t)),
  };
}

/**
 * Reopen a resolved thread (#186). The resolution is not erased: a comment by
 * whoever reopens it records who resolved it and when, so the next resolve,
 * which overwrites `resolvedBy` and `resolvedAt`, loses nothing (ADR-0011:
 * the record of *why* is the point). Until then those fields keep the last
 * resolution.
 */
export function reopenThread(a: Analysis, threadId: string, { id, by, at }: { id: string; by: Author; at: string }): Analysis {
  const thread = a.threads.find((t) => t.id === threadId);
  if (!thread) throw new Error(`there is no thread "${threadId}" to reopen in this analysis.`);
  if (!thread.resolved) throw new Error(`the thread "${threadId}" is open; only a resolved thread can be reopened.`);
  if (thread.comments.some((c) => c.id === id)) throw new Error(`comment id "${id}" is already used in this thread.`);
  // The resolver as the panel names them, kind and all, plus the id: a display name alone loses who it was.
  const was = thread.resolvedBy;
  const resolver = was && `${attributions(a.authors).get(was) ?? 'an author this analysis does not describe'} [${was}]`;
  const body = `Reopened. It had been resolved${resolver ? ` by ${resolver}` : ''}${thread.resolvedAt ? `, ${thread.resolvedAt}` : ''}.`;
  return {
    ...withAuthor(a, by),
    threads: a.threads.map((t) => (t === thread ? { ...t, resolved: false, comments: [...t.comments, commentOf({ id, at, body, author: by })] } : t)),
  };
}

/** How the comment that keeps an earlier wording begins; the activity record recognises an edit by it. */
export const EDIT_NOTE = 'Edited a comment by';

/**
 * Edit a comment without losing its earlier wording (#195, option (c) of #219).
 * The comment takes the new body and an `editedAt`; a comment by the editor
 * follows it in the thread, naming whose comment it was, when, and quoting the
 * wording it had, as `reopenThread` records a reopening. The record needs no
 * field the v1 schema lacks and survives any store; a second edit quotes the
 * first's result, so the whole chain stays readable.
 *
 * Known limits of keeping it as a comment (#219): anyone who may reply may write
 * a comment that looks like such a note, signed by themselves, so a note is
 * evidence of what its signer says, not of what the comment said; and the note
 * is itself a comment, editable. A v2 `edits` field would close both.
 */
export function editComment(
  a: Analysis, threadId: string, commentId: string, { body, id, by, at }: { body: string; id: string; by: Author; at: string },
): Analysis {
  const thread = openThread(a, threadId, 'edit');
  const was = thread.comments.find((c) => c.id === commentId);
  if (!was) throw new Error(`there is no comment "${commentId}" in the thread "${threadId}" to edit.`);
  if (thread.comments.some((c) => c.id === id)) throw new Error(`comment id "${id}" is already used in this thread.`);
  const text = body.trim();
  if (text === '') throw new Error('a comment needs words: the body is empty.');
  if (text === was.body.trim()) throw new Error('the new wording is the same as the old; nothing to edit.');
  const author = attributions(a.authors).get(was.authorId) ?? 'an author this analysis does not describe';
  const note = `${EDIT_NOTE} ${author} [${was.authorId}], as it read since ${was.editedAt ?? was.at}. Its earlier wording: ${JSON.stringify(was.body)}`;
  return {
    ...withAuthor(a, by),
    threads: a.threads.map((t) => (t === thread
      ? { ...t, comments: [...t.comments.map((c) => (c === was ? { ...c, body: text, editedAt: at } : c)), commentOf({ id, at, body: note, author: by })] }
      : t)),
  };
}

function openThread(a: Analysis, threadId: string, doing: string): Thread {
  const thread = a.threads.find((t) => t.id === threadId);
  if (!thread) throw new Error(`there is no thread "${threadId}" to ${doing} in this analysis.`);
  if (thread.resolved) throw new Error(`the thread "${threadId}" is resolved; it is kept as it was resolved, and takes no further ${doing === 'answer' ? 'reply' : doing === 'edit' ? 'edit' : 'resolution'} unless it is reopened.`);
  return thread;
}

function commentOf({ id, at, body, author }: NewComment): Comment {
  const text = body.trim();
  if (text === '') throw new Error('a comment needs words: the body is empty.');
  return { id, authorId: author.id, at, body: text };
}

function requireNewId(a: Analysis, threadId: string): void {
  if (a.threads.some((t) => t.id === threadId)) throw new Error(`thread id "${threadId}" is already used in this analysis.`);
}

/**
 * The analysis with this author described, added when it is not; an existing
 * record is never overwritten. A writer whose id the document already gives to
 * a different kind of author, or one known differently well, is refused: the
 * reader sees the document's record, so writing under it would sign as them.
 */
function withAuthor(a: Analysis, author: Author): Analysis {
  const known = a.authors.find((x) => x.id === author.id);
  if (!known) return { ...a, authors: [...a.authors, author] };
  const vouch = (x: Author) => `${x.kind} ${x.attestation?.method ?? 'unverified'} ${x.attestation?.issuer ?? ''}`;
  if (vouch(known) !== vouch(author)) {
    throw new Error(`"${author.id}" is ${attribution(known)} in this analysis; a ${author.kind} identity known differently cannot write as them.`);
  }
  return a;
}
