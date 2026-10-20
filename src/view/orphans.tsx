/**
 * The orphaned-annotations tray (#108, ADR-0011 clause 2): every thread and
 * suggestion whose anchor was tombstoned or removed, visible above the matrix
 * rather than silently gone. Drawn only when there is one; the words are
 * `describeOrphans`', so the view decides nothing about them.
 */
import { useId } from 'preact/hooks';

import type { Analysis } from '../core/schema/analysis.js';
import type { Vouched } from '../core/identity.js';
import { describeOrphans } from '../core/orphans.js';

export function OrphanTray({ analysis, vouched }: { analysis: Analysis; vouched?: Vouched | undefined }) {
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
          </li>
        ))}
      </ol>
    </section>
  );
}
