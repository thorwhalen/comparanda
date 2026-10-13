/**
 * The detail panel's discussion (#106): every thread bearing on the reader's
 * position, open ones first, resolved ones one button away and never gone, and
 * the forms that start, answer and resolve a thread.
 *
 * Whether a write is offered is asked of `affordances.comment` and nowhere
 * else (ADR-0006 clause 3); a refused one is shown with its reason, never as a
 * control that does nothing. The writes themselves are `ThreadWrites`, which
 * `mountMatrix` implements over the source; this file only collects words.
 */
import { useState } from 'preact/hooks';

import type { Affordances, EditTarget } from '../core/affordances.js';
import type { Analysis } from '../core/schema/analysis.js';
import type { Anchor, Thread } from '../core/schema/annotations.js';
import { aliasesOf } from '../core/schema/structure.js';
import { axisGroups, groupsOf } from '../core/schema/groups.js';
import { threadsAt, type Position, type ThreadAt } from '../core/threads.js';
import { capitalise } from './words.js';

/** The writes a thread takes, performed by whoever holds the source. Each settles when the source has it. */
export interface ThreadWrites {
  start(anchor: Anchor, body: string): Promise<void>;
  reply(threadId: string, body: string): Promise<void>;
  resolve(threadId: string): Promise<void>;
}

export interface ThreadsProps {
  analysis: Analysis;
  /** The measure shown, which a new cell thread is anchored to. */
  measure: string;
  position: Position;
  affordances: Affordances;
  writes?: ThreadWrites | undefined;
  /** For the form controls' ids. */
  idBase: string;
}

export function Threads({ analysis, measure, position, affordances, writes, idBase }: ThreadsProps) {
  const [showResolved, setShowResolved] = useState(false);
  const words = aliasesOf(analysis);
  const all = threadsAt(analysis, position);
  const open = all.filter((x) => !x.thread.resolved);
  const resolved = all.filter((x) => x.thread.resolved);
  const choices = anchorChoices(analysis, position, measure, words);
  const allowed = affordances.comment(choices[0]!.target);
  const names = new Map(analysis.authors.map((x) => [x.id, x.displayName]));
  return (
    <section class="comparanda-threads" aria-labelledby={`${idBase}-threads`} data-detail="threads">
      <h3 id={`${idBase}-threads`}>{`Discussion (${open.length} open${resolved.length ? `, ${resolved.length} resolved` : ''})`}</h3>
      {open.length === 0 && <p class="comparanda-panel-hint">No open threads here.</p>}
      {open.length > 0 && (
        <ol class="comparanda-thread-list">
          {open.map((x) => (
            <ThreadItem key={x.thread.id} at={x} analysis={analysis} names={names} writes={writes} affordances={affordances} idBase={idBase} />
          ))}
        </ol>
      )}
      {resolved.length > 0 && (
        <button type="button" aria-expanded={showResolved} onClick={() => setShowResolved(!showResolved)}>
          {`${showResolved ? 'Hide' : 'Show'} ${resolved.length} resolved thread${resolved.length === 1 ? '' : 's'}`}
        </button>
      )}
      {showResolved && resolved.length > 0 && (
        <ol class="comparanda-thread-list" data-resolved="true">
          {resolved.map((x) => <ThreadItem key={x.thread.id} at={x} analysis={analysis} names={names} affordances={affordances} idBase={idBase} />)}
        </ol>
      )}
      {allowed.enabled && writes
        ? (
          <Compose
            // A draft and its choice belong to the position they were written at: moving the panel starts afresh.
            key={`${position.alternativeId ?? ''}\u0000${position.criterionId ?? ''}`}
            label={`Start a thread on ${choices[0]!.here}`} action="Start thread" idBase={`${idBase}-new`}
            choices={choices.map((x) => x.here)}
            send={(body, i = 0) => {
              const { anchor, target } = choices[i]!;
              const may = affordances.comment(target);
              return may.enabled ? writes.start(anchor, body) : Promise.reject(new Error(may.reason ?? 'not allowed here'));
            }}
          />
        )
        : <p class="comparanda-reason">{`Starting or answering a thread is not available here: ${allowed.reason ?? 'there is nowhere to write it.'}`}</p>}
    </section>
  );
}

function ThreadItem({ at, analysis, names, writes, affordances, idBase }: {
  at: ThreadAt; analysis: Analysis; names: Map<string, string>; writes?: ThreadWrites | undefined; affordances: Affordances; idBase: string;
}) {
  const { thread, relation } = at;
  // Asked about the thread's own anchor, not the reader's position: a group's thread listed at a member is the group's.
  const may = affordances.comment(targetOf(thread.anchor));
  const [error, setError] = useFailure();
  const [busy, setBusy] = useState(false);
  const who = (id: string | undefined) => (id === undefined ? 'someone' : names.get(id) ?? `an author this analysis does not describe (“${id}”)`);
  const resolve = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await writes!.resolve(thread.id);
      // The thread leaves the open list, and focus with it: back to the panel's heading.
      document.getElementById(idBase)?.focus();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li data-thread={thread.id} data-relation={relation}>
      {relation !== 'here' && <p class="comparanda-panel-hint">{onWhat(analysis, thread)}</p>}
      <ol class="comparanda-comments">
        {thread.comments.map((c) => (
          <li key={c.id}><strong>{who(c.authorId)}</strong>{`, ${c.at}: `}{c.body}</li>
        ))}
      </ol>
      {thread.resolved && <p class="comparanda-panel-hint">{`Resolved by ${who(thread.resolvedBy)}${thread.resolvedAt ? `, ${thread.resolvedAt}` : ''}. Kept for the record.`}</p>}
      {writes && !thread.resolved && !may.enabled && (
        <p class="comparanda-reason">{`Answering or resolving this thread is not available: ${may.reason ?? 'not allowed here.'}`}</p>
      )}
      {writes && !thread.resolved && may.enabled && (
        <>
          <Compose label="Reply" action="Reply" idBase={`${idBase}-${thread.id}`} send={(body) => writes.reply(thread.id, body)} />
          <button type="button" disabled={busy} onClick={resolve}>Resolve thread</button>
          {error && <p role="alert" key={error.attempt}>{`Not resolved: ${error.text}`}</p>}
        </>
      )}
    </li>
  );
}

/** A labelled text box and its button. The draft survives a failed send, which says why. */
function Compose({ label, action, idBase, send, choices }: {
  label: string; action: string; idBase: string; send: (body: string, choice?: number) => Promise<void>; choices?: string[] | undefined;
}) {
  const [draft, setDraft] = useState('');
  const [choice, setChoice] = useState(0);
  const [error, setError] = useFailure();
  const [busy, setBusy] = useState(false);
  const submit = async (event: Event) => {
    event.preventDefault();
    if (draft.trim() === '') {
      setError('write something first.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await send(draft, choice);
      setDraft('');
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form class="comparanda-compose" onSubmit={submit}>
      {choices && choices.length > 1 && (
        <>
          <label for={`${idBase}-about`}>About</label>
          <select id={`${idBase}-about`} value={String(choice)} onChange={(e) => setChoice(Number((e.currentTarget as HTMLSelectElement).value))}>
            {choices.map((c, i) => <option key={c} value={String(i)}>{capitalise(c)}</option>)}
          </select>
        </>
      )}
      <label for={`${idBase}-text`}>{choices && choices.length > 1 ? `Start a thread on ${choices[choice]}` : label}</label>
      <textarea id={`${idBase}-text`} rows={2} value={draft} onInput={(e) => setDraft((e.currentTarget as HTMLTextAreaElement).value)} />
      <button type="submit" disabled={busy}>{action}</button>
      {error && <p role="alert" key={error.attempt}>{`Not sent: ${error.text}`}</p>}
    </form>
  );
}

interface AnchorChoice { anchor: Anchor; target: EditTarget; here: string }

/**
 * What a thread started here may be about, first the position itself: on a
 * header also each group the entity is in, on a cell each group-pair block
 * covering it, and at the corner every group, since a band is a label and not
 * a place the reader can stand. Every scope ADR-0011 names is reachable.
 */
function anchorChoices(analysis: Analysis, position: Position, measure: string, words: ReturnType<typeof aliasesOf>): AnchorChoice[] {
  const first = anchorOf(analysis, position, measure, words);
  const live = analysis.groups.filter((g) => !g.tombstoned);
  const group = (g: (typeof live)[number]): AnchorChoice => ({
    anchor: { scope: 'group', groupId: g.id, repairHint: g.label }, target: { kind: 'group', id: g.id }, here: `the group ${g.label}`,
  });
  const alt = analysis.alternatives.find((x) => x.id === position.alternativeId);
  const crit = analysis.criteria.find((x) => x.id === position.criterionId);
  // Each entity's groups with their ancestors, as membership is read everywhere else.
  const altGroups = alt ? groupsOf(axisGroups(analysis, 'alternatives'), alt.id) : undefined;
  const critGroups = crit ? groupsOf(axisGroups(analysis, 'criteria'), crit.id) : undefined;
  if (alt && crit) {
    const pairs = live.filter((g) => altGroups!.includes(g.id)).flatMap((g) => live.filter((h) => critGroups!.includes(h.id)).map((h) => ({
      anchor: { scope: 'group-pair', groupId: g.id, otherGroupId: h.id, repairHint: `${g.label} \u00d7 ${h.label}` } as Anchor,
      target: { kind: 'group-pair', id: `${g.id}/${h.id}` } as EditTarget,
      here: `the block ${g.label} \u00d7 ${h.label}`,
    })));
    return [first, ...pairs];
  }
  const own = altGroups ?? critGroups;
  return [first, ...live.filter((g) => own === undefined || own.includes(g.id)).map(group)];
}

/** The anchor a new thread here takes, what the affordance is asked about, and its name in words. */
function anchorOf(analysis: Analysis, { alternativeId, criterionId }: Position, measure: string, words: ReturnType<typeof aliasesOf>):
  { anchor: Anchor; target: EditTarget; here: string } {
  const alt = analysis.alternatives.find((x) => x.id === alternativeId);
  const crit = analysis.criteria.find((x) => x.id === criterionId);
  if (alt && crit) {
    return {
      anchor: { scope: 'cell', alternativeId: alt.id, criterionId: crit.id, measure, repairHint: `${alt.label} / ${crit.label}` },
      target: { kind: 'cell', id: `${alt.id}/${crit.id}` },
      here: `this cell (${crit.label}, ${alt.label})`,
    };
  }
  if (alt) return { anchor: { scope: 'alternative', alternativeId: alt.id, repairHint: alt.label }, target: { kind: 'alternative', id: alt.id }, here: `the ${words.alternative} ${alt.label}` };
  if (crit) return { anchor: { scope: 'criterion', criterionId: crit.id, repairHint: crit.label }, target: { kind: 'criterion', id: crit.id }, here: `the ${words.criterion} ${crit.label}` };
  return { anchor: { scope: 'analysis' }, target: { kind: 'analysis' }, here: 'the analysis as a whole' };
}

/** Where a thread listed here by inheritance is anchored. */
function onWhat(analysis: Analysis, thread: Thread): string {
  const group = (id: string | undefined) => analysis.groups.find((g) => g.id === id)?.label ?? id ?? '';
  const { anchor } = thread;
  if (anchor.scope === 'group') return `On the group ${group(anchor.groupId)}:`;
  if (anchor.scope === 'group-pair') return `On the block ${group(anchor.groupId)} × ${group(anchor.otherGroupId)}:`;
  return `${capitalise(anchor.scope)}:`;
}

/**
 * The last failure, re-keyed on every attempt so the alert is a new element
 * and the same reason twice is announced twice.
 */
function useFailure(): [{ text: string; attempt: number } | undefined, (text: string | undefined) => void] {
  const [failure, setFailure] = useState<{ text: string; attempt: number } | undefined>(undefined);
  const set = (text: string | undefined) =>
    setFailure((was) => (text === undefined ? undefined : { text, attempt: (was?.attempt ?? 0) + 1 }));
  return [failure, set];
}

/** What a thread's anchor is, as the affordance is asked about it. */
function targetOf(anchor: Anchor): EditTarget {
  switch (anchor.scope) {
    case 'cell': return { kind: 'cell', id: `${anchor.alternativeId ?? ''}/${anchor.criterionId ?? ''}` };
    case 'alternative': return { kind: 'alternative', id: anchor.alternativeId ?? '' };
    case 'criterion': return { kind: 'criterion', id: anchor.criterionId ?? '' };
    case 'group': return { kind: 'group', id: anchor.groupId ?? '' };
    case 'group-pair': return { kind: 'group-pair', id: `${anchor.groupId ?? ''}/${anchor.otherGroupId ?? ''}` };
    case 'analysis': return { kind: 'analysis' };
  }
}

function messageOf(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).replace(/\.?$/, '.');
}
