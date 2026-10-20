/**
 * The orphaned-annotations tray (#108, ADR-0011 clause 2): every thread and
 * suggestion whose anchor was tombstoned or removed, visible above the matrix
 * rather than silently gone. Drawn only when there is one; the words are
 * `describeOrphans`', so the view decides nothing about them.
 *
 * Each entry can be re-attached (#249): a choice of new anchor from core's
 * `reattachChoices` (a split's successors first), asked of
 * `affordances.comment(target, 'reattach')` and written through the source by
 * `ReattachWrite`. A refusal is shown with its reason; without a write there is
 * no control, only the list.
 */
import { useId, useState } from 'preact/hooks';

import type { Analysis } from '../core/schema/analysis.js';
import type { Anchor } from '../core/schema/annotations.js';
import type { Affordances } from '../core/affordances.js';
import type { Vouched } from '../core/identity.js';
import { describeOrphans, reattachChoices, type OrphanEntry } from '../core/orphans.js';
import { commentTarget } from '../core/threads.js';
import { capitalise } from './words.js';

/** Move an orphaned thread or suggestion to `anchor`, through the source; rejects with the reason. */
export type ReattachWrite = (which: { kind: 'thread' | 'suggestion'; id: string }, anchor: Anchor) => Promise<void>;

export function OrphanTray({ analysis, vouched, affordances, reattach }: {
  analysis: Analysis; vouched?: Vouched | undefined; affordances?: Affordances | undefined; reattach?: ReattachWrite | undefined;
}) {
  const id = useId();
  const orphans = describeOrphans(analysis, { vouched });
  if (orphans.length === 0) return null;
  return (
    <section class="comparanda-orphans" aria-labelledby={id} data-orphans={String(orphans.length)}>
      <h2 id={id}>{`Orphaned annotations (${orphans.length})`}</h2>
      <p class="comparanda-panel-hint">What these were attached to has been deleted or removed. They are kept, because the argument still happened; each needs a person to decide what became of it.</p>
      <ol class="comparanda-thread-list">
        {orphans.map((o) => (
          <li key={`${o.kind}:${o.id}`} data-orphan={o.kind}>
            <p>{o.said} <span class="comparanda-panel-hint">{`(${o.standing})`}</span></p>
            {o.comments.length > 0 && (
              <ol class="comparanda-comments">
                {o.comments.map((c) => <li key={c.id}><strong>{c.who}</strong>{`, ${c.at}: `}{c.body}</li>)}
              </ol>
            )}
            {reattach && affordances && <Reattach analysis={analysis} entry={o} affordances={affordances} reattach={reattach} idBase={`${id}-${o.kind}-${o.id}`} />}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Reattach({ analysis, entry, affordances, reattach, idBase }: {
  analysis: Analysis; entry: OrphanEntry; affordances: Affordances; reattach: ReattachWrite; idBase: string;
}) {
  const which = { kind: entry.kind, id: entry.id };
  const choices = reattachChoices(analysis, which);
  const [picked, setPicked] = useState(0);
  const [said, setSaid] = useState('');
  const choice = choices[Math.min(picked, choices.length - 1)];
  if (!choice) return null;
  const may = affordances.comment(commentTarget(choice.anchor), 'reattach', entry.kind === 'thread' ? { threadId: entry.id } : {});
  return (
    <form
      class="comparanda-reattach" data-reattach=""
      onSubmit={(e) => {
        e.preventDefault();
        if (!may.enabled) return;
        setSaid('');
        reattach(which, choice.anchor).catch((error: unknown) => setSaid(`Not re-attached: ${error instanceof Error ? error.message : String(error)}`));
      }}
    >
      <label for={`${idBase}-to`}>Re-attach to</label>{' '}
      <select id={`${idBase}-to`} value={String(picked)} onChange={(e) => setPicked(Number((e.currentTarget as HTMLSelectElement).value))}>
        {choices.map((c, i) => <option key={i} value={String(i)}>{c.said}</option>)}
      </select>{' '}
      {may.enabled
        ? <button type="submit">Re-attach</button>
        : <><button type="submit" aria-disabled="true" aria-describedby={`${idBase}-why`}>Re-attach</button>{' '}<span class="comparanda-reason" id={`${idBase}-why`}>{capitalise(may.reason || 'not possible here.')}</span></>}
      {said && <p class="comparanda-reason" role="status">{said}</p>}
    </form>
  );
}
