/**
 * The activity record: what moved, who moved it, when, and what justification
 * they gave (ADR-0011 clause 7), read off the document, with the round-scoped
 * redaction applied once (ADR-0023, #107).
 *
 * Derived, never stored: every assertion is already `{ authorId, at, value,
 * justification }` and a superseded one names its successor, so "the record" is
 * those facts in time order. Nothing is added to the schema.
 *
 * **Every fact about an assertion passes through `assertionVisibility`.** An
 * entry for an assertion whose author the round hides from this viewer has no
 * `who` (it says `whoHidden`) and carries the content the round's feedback
 * policy allows -- so inside an open `blind-until-close` round the record says
 * *what moved and when*, and becomes legible as *who* the moment the round
 * closes, with nothing in the entry to reconstruct the author from (no id, no
 * procedure). A presentation policy, not a security boundary (ADR-0023).
 *
 * Comments are not assertions and belong to no round, so their authors are
 * shown. A comment edit made through `editComment` leaves a comment by the
 * editor quoting the earlier wording, and is reported as the editor's edit; an
 * older one has only `editedAt`, with no earlier wording and no editor, which
 * this record cannot invent (#195).
 */
import { attributions } from './identity.js';
import { editNoteOf } from './threads.js';
import type { Analysis } from './schema/analysis.js';
import { assertionVisibility, redactForViewer, type AssertionVisibility, type ViewerContext } from './schema/redaction.js';
import type { ScalarValue } from './schema/values.js';

export type ActivityKind = 'asserted' | 'changed' | 'started-thread' | 'replied' | 'resolved' | 'edited-comment';

export interface ActivityEntry {
  /** When it happened, as recorded. */
  at: string;
  kind: ActivityKind;
  /** The cell, for an assertion. */
  alternativeId?: string | undefined;
  criterionId?: string | undefined;
  measure?: string | undefined;
  /** The thread, for a comment or a resolution. */
  threadId?: string | undefined;
  /** Who, as the document attributes them. Absent when `whoHidden`, or when the document does not describe the author (then the id). */
  who?: string | undefined;
  /** The round hides who this was from this viewer. Never true for a comment. */
  whoHidden: boolean;
  /** The value, when the round lets this viewer see it. */
  value?: ScalarValue | undefined;
  /** The absence code, when it records one and the round lets this viewer see it. */
  absence?: string | undefined;
  /** For `changed`: the value this replaced, when the viewer may see that one too. */
  previous?: ScalarValue | undefined;
  /** The justification given, when the round lets this viewer see it. */
  justification?: string | undefined;
  /** The round it was made in, by label. */
  round?: string | undefined;
  /** Why this viewer sees what they see of it. */
  because: AssertionVisibility['because'] | 'discussion';
  /** One sentence for a reader or a screen reader: what moved, who, when. */
  said: string;
}

export interface ActivityOptions {
  /** Only what happened after this moment (exclusive): "what changed since I last looked". */
  since?: string | undefined;
}

const time = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
};

/**
 * Everything that happened in the analysis, oldest first, as `viewer` may see it.
 * Equal moments keep the document's order (assertions by cell, then threads).
 */
export function activityRecord(a: Analysis, viewer: ViewerContext, { since }: ActivityOptions = {}): ActivityEntry[] {
  const names = attributions(a.authors);
  const label = {
    alternative: new Map(a.alternatives.map((x) => [x.id, x.label])),
    criterion: new Map(a.criteria.map((x) => [x.id, x.label])),
  };
  const rounds = new Map(a.rounds.map((r) => [r.id, r.label ?? `round ${r.index}`]));
  const entries: ActivityEntry[] = [];

  for (const cell of a.cells) {
    const where = `${label.criterion.get(cell.criterionId) ?? cell.criterionId} for ${label.alternative.get(cell.alternativeId) ?? cell.alternativeId}`;
    const predecessors = new Map(cell.assertions.flatMap((s) => (s.supersededBy === undefined ? [] : [[s.supersededBy, s] as const])));
    for (const s of cell.assertions) {
      const visibility = assertionVisibility(a, s, viewer);
      // The redacted copy is all this loop reads from here on: nothing below can name an author the round hides.
      const shown = redactForViewer(s, visibility, 'hidden');
      // A replacement is shown as one only between two assertions the viewer may attribute alike: linking a named hand to an
      // unnamed one would say they are the same (people mostly revise their own).
      const candidate = predecessors.get(s.id);
      const beforeVisibility = candidate === undefined ? undefined : assertionVisibility(a, candidate, viewer);
      const before = beforeVisibility?.author === visibility.author ? candidate : undefined;
      const previous = before === undefined ? undefined : redactForViewer(before, beforeVisibility!, 'hidden').value;
      const who = visibility.author ? names.get(s.authorId) ?? s.authorId : undefined;
      const kind: ActivityKind = before === undefined ? 'asserted' : 'changed';
      const verb = before === undefined ? 'recorded' : 'changed';
      const content = shown.value !== undefined
        ? `${verb} ${where} ${before === undefined ? 'as' : 'to'} ${String(shown.value)}${previous !== undefined ? ` (was ${String(previous)})` : ''}`
        : shown.missing !== undefined
          ? `${verb} ${where} ${before === undefined ? 'as' : 'to'} ${shown.missing.code}`
          : `${verb} ${where}, a value the round keeps hidden until it closes`;
      entries.push({
        at: s.at, kind, alternativeId: cell.alternativeId, criterionId: cell.criterionId, measure: cell.measure,
        whoHidden: !visibility.author,
        ...(who !== undefined ? { who } : {}),
        ...(shown.value !== undefined ? { value: shown.value } : {}),
        ...(shown.missing !== undefined ? { absence: shown.missing.code } : {}),
        ...(previous !== undefined ? { previous } : {}),
        ...(shown.justification !== undefined ? { justification: shown.justification } : {}),
        ...(s.roundId !== undefined ? { round: rounds.get(s.roundId) ?? s.roundId } : {}),
        because: visibility.because,
        said: `${who ?? 'Someone'} ${content}, ${s.at}.${shown.justification ? ` Because: ${shown.justification}` : ''}`,
      });
    }
  }

  for (const thread of a.threads) {
    // A note counts when it names a comment this thread has; a reply that merely sounds like one is a reply.
    const ids = new Set(thread.comments.map((c) => c.id));
    const noteFor = (body: string) => { const id = editNoteOf(body); return id !== undefined && ids.has(id) ? id : undefined; };
    const noted = new Set(thread.comments.flatMap((n, j) => (j > 0 ? [noteFor(n.body)] : [])).filter((x): x is string => x !== undefined));
    thread.comments.forEach((c, i) => {
      const who = names.get(c.authorId) ?? c.authorId;
      const base = { threadId: thread.id, whoHidden: false, who, because: 'discussion' as const };
      // The comment `editComment` leaves is the editor's edit, not a reply; the edited comment's own `editedAt` is then already said.
      if (i > 0 && noteFor(c.body)) {
        entries.push({ ...base, at: c.at, kind: 'edited-comment', said: `${who} edited a comment, ${c.at}; its earlier wording is quoted in the thread.` });
        return;
      }
      entries.push({ ...base, at: c.at, kind: i === 0 ? 'started-thread' : 'replied', said: `${who} ${i === 0 ? 'started a thread' : 'replied in a thread'}, ${c.at}.` });
      if (c.editedAt !== undefined && !noted.has(c.id)) {
        entries.push({ ...base, at: c.editedAt, kind: 'edited-comment', said: `A comment by ${who} was edited, ${c.editedAt}; the earlier wording and the editor are not recorded.` });
      }
    });
    if (thread.resolved && thread.resolvedAt !== undefined) {
      const by = thread.resolvedBy === undefined ? undefined : names.get(thread.resolvedBy) ?? thread.resolvedBy;
      entries.push({
        at: thread.resolvedAt, kind: 'resolved', threadId: thread.id, whoHidden: false, ...(by !== undefined ? { who: by } : {}),
        because: 'discussion', said: `${by ?? 'Someone'} resolved a thread, ${thread.resolvedAt}.`,
      });
    }
  }

  const ordered = entries.map((e, i) => ({ e, i })).sort((x, y) => time(x.e.at) - time(y.e.at) || x.i - y.i).map(({ e }) => e);
  return since === undefined ? ordered : ordered.filter((e) => time(e.at) > time(since));
}
