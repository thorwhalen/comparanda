/**
 * Re-attaching an orphan from the tray (#249): the new anchor is chosen from
 * core's choices (a split's successors first), asked of the comment
 * affordance, and written through the source; without a source there is no
 * control; a refusal shows its reason.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from '@vitest/browser/context';

import { Analysis } from '../../src/core/schema/analysis.js';
import { tombstone } from '../../src/core/schema/anchors.js';
import { startThread } from '../../src/core/threads.js';
import { anonymousIdentity, inMemoryAnalysisSource } from '../../src/store/index.js';
import { mountMatrix, type MatrixHandle } from '../../src/view/index.js';
import relocationJson from '../../examples/relocation.json';

const ANA = { id: 'ana', displayName: 'Ana Ruiz', kind: 'human' } as const;
const orphaned = tombstone(startThread(Analysis.parse(relocationJson), {
  threadId: 't-rent', anchor: { scope: 'criterion', criterionId: 'rent' },
  comment: { id: 'k1', at: '2026-10-01T00:00:00Z', body: 'before or after utilities?', author: ANA },
}), { kind: 'criterion', id: 'rent' }, { supersededBy: ['income-tax'] });

let el: HTMLElement;
let handle: MatrixHandle | undefined;
beforeEach(() => { el = document.createElement('div'); document.body.append(el); });
afterEach(() => { handle?.destroy(); handle = undefined; el.remove(); });

/** This thread's entry: the fixture has orphans of its own. */
const entry = () => Array.from(el.querySelectorAll<HTMLElement>('.comparanda-orphans [data-orphan="thread"]')).find((li) => li.textContent!.includes('before or after utilities'));
const settled = () => new Promise((r) => setTimeout(r, 0));

describe('re-attaching from the orphan tray', () => {
  it('has no control without a source to write to', () => {
    handle = mountMatrix(el, { analysis: orphaned, measure: 'score' });
    expect(entry()).toBeDefined();
    expect(entry()!.querySelector('[data-reattach]')).toBeNull();
  });

  it('offers the successor first and moves the thread there through the source, by keyboard', async () => {
    const source = inMemoryAnalysisSource(orphaned);
    handle = mountMatrix(el, { analysis: orphaned, measure: 'score', source, identity: anonymousIdentity({ id: 'dana', displayName: 'Dana' }) });
    const select = entry()!.querySelector<HTMLSelectElement>('[data-reattach] select')!;
    expect(select.options[0]!.textContent).toMatch(/Income tax burden \(what it was split or merged into\)/);
    expect(select.options[select.options.length - 1]!.textContent).toBe('The analysis as a whole');
    select.focus();
    await userEvent.keyboard('{Tab}');
    expect(document.activeElement?.textContent).toBe('Re-attach');
    await userEvent.keyboard('{Enter}');
    await settled(); await settled();
    const doc = (await source.getOne(orphaned.id))!;
    expect(doc.threads.find((t) => t.id === 't-rent')!.anchor).toEqual({ scope: 'criterion', criterionId: 'income-tax' });
    expect(entry()).toBeUndefined();
  });

  it('shows the reason when the host refuses', () => {
    const source = inMemoryAnalysisSource(orphaned);
    handle = mountMatrix(el, { analysis: orphaned, measure: 'score', source, authorize: (() => ({ allowed: false, reason: 'only moderators move threads' })) as never });
    const button = entry()!.querySelector<HTMLButtonElement>('[data-reattach] button')!;
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(button.getAttribute('aria-describedby')!)!.textContent).toMatch(/moderators/);
  });
});
