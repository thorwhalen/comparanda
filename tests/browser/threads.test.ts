/**
 * Annotation threads at every scope (#106), in the detail panel: start, reply
 * and resolve through the source, as the host's identity; a criterion thread
 * survives a rename and a reorder; a resolved thread is hidden by default and
 * one button away; a refused write is shown with its reason.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from '@vitest/browser/context';

import { Analysis } from '../../src/core/schema/analysis.js';
import { startThread } from '../../src/core/threads.js';
import { reviseCriterion } from '../../src/core/criteria-revision.js';
import { applyOrder, initialViewState, setDetailPanel, setFocus, type ViewState } from '../../src/core/view-state.js';
import { anonymousIdentity, inMemoryAnalysisSource, type AnalysisSource } from '../../src/store/index.js';
import { mountMatrix, type MatrixHandle, type MountMatrixProps } from '../../src/view/index.js';
import relocationJson from '../../examples/relocation.json';

const relocation = Analysis.parse(relocationJson);
const dana = anonymousIdentity({ id: 'dana', displayName: 'Dana' });

let el: HTMLElement;
const handles: MatrixHandle[] = [];
let ids = 0;
const mount = (props: MountMatrixProps) => {
  const handle = mountMatrix(el, props, { now: () => new Date('2026-10-13T12:00:00Z'), newId: () => `id-${(ids += 1)}` });
  handles.push(handle);
  return handle;
};
beforeEach(() => {
  el = document.createElement('div');
  document.body.append(el);
});
afterEach(() => {
  for (const handle of handles.splice(0)) handle.destroy();
  el.remove();
});

const at = (focus: ViewState['session']['focus'], view = initialViewState(relocation)) => setDetailPanel(setFocus(view, focus), true);
const panel = () => el.querySelector<HTMLElement>('aside.comparanda-panel')!;
const threads = () => panel().querySelector<HTMLElement>('[data-detail="threads"]')!;
/** Wait for the source's write to come back as a render. */
const settled = () => new Promise((r) => setTimeout(r, 0));
async function say(label: RegExp, text: string, button: string) {
  const box = Array.from(threads().querySelectorAll('textarea')).find((t) => label.test(threads().querySelector(`label[for="${t.id}"]`)!.textContent!))!;
  await userEvent.click(box);
  await userEvent.keyboard(text);
  const form = box.closest('form')!;
  await userEvent.click(Array.from(form.querySelectorAll('button')).find((b) => b.textContent === button)!);
  await settled();
}

describe('threads in the panel', () => {
  it('starts a thread on a criterion as the host identity, and it survives a rename and a reorder', async () => {
    const source = inMemoryAnalysisSource(relocation);
    mount({ analysis: relocation, measure: 'score', source, identity: dana, view: at({ criterionId: 'rent' }) });
    await say(/Start a thread on the criterion Rent/, 'is this rent before or after utilities?', 'Start thread');
    const doc = (await source.getOne(relocation.id))!;
    const thread = doc.threads.at(-1)!;
    expect(thread).toMatchObject({ anchor: { scope: 'criterion', criterionId: 'rent' }, comments: [{ authorId: 'dana', at: '2026-10-13T12:00:00.000Z' }] });
    expect(threads().textContent).toContain('is this rent before or after utilities?');
    expect(threads().textContent).toContain('Dana');

    // Rename the criterion in the document and reorder the view: the thread stays on it.
    await source.update(doc.id, reviseCriterion(doc, 'rent', { label: 'Monthly housing cost' }, { material: false }));
    const reordered = applyOrder(at({ criterionId: 'rent' }), 'criteria', [...doc.criteria.map((c) => c.id)].reverse(), { kind: 'manual', by: 'dana' });
    await settled();
    handles[0]!.update({ view: reordered });
    expect(panel().querySelector('[data-panel-heading]')!.textContent).toContain('Monthly housing cost');
    expect(threads().textContent).toContain('is this rent before or after utilities?');
  });

  it('replies and resolves; a resolved thread is hidden by default and retrievable', async () => {
    const source = inMemoryAnalysisSource(relocation);
    mount({ analysis: relocation, measure: 'score', source, identity: dana, view: at({ alternativeId: 'berlin', criterionId: 'winter-daylight' }) });
    const open = threads().querySelectorAll('[data-thread]').length;
    expect(open).toBeGreaterThan(0);
    await say(/Reply/, 'agreed, the solstice figure is right', 'Reply');
    expect(threads().textContent).toContain('agreed, the solstice figure is right');
    await userEvent.click(Array.from(threads().querySelectorAll('button')).find((b) => b.textContent === 'Resolve thread')!);
    await settled();
    expect(threads().querySelectorAll('ol:not([data-resolved]) > [data-thread]')).toHaveLength(open - 1);
    const toggle = Array.from(threads().querySelectorAll('button')).find((b) => /Show \d+ resolved/.test(b.textContent!))!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(toggle);
    expect(threads().querySelector('[data-resolved]')!.textContent).toMatch(/Resolved by Dana/);
    // Kept, never deleted.
    expect((await source.getOne(relocation.id))!.threads.length).toBe(relocation.threads.length);
  });

  it('every scope is reachable: a cell offers the group-pair blocks covering it', async () => {
    const source = inMemoryAnalysisSource(relocation);
    const alt = relocation.alternatives.find((a) => a.groupIds.length > 0)!;
    const crit = relocation.criteria.find((c) => c.groupIds.length > 0)!;
    mount({ analysis: relocation, measure: 'score', source, identity: dana, view: at({ alternativeId: alt.id, criterionId: crit.id }) });
    const about = threads().querySelector<HTMLSelectElement>('select')!;
    const block = Array.from(about.options).find((o) => /^The block /.test(o.textContent!))!;
    await userEvent.selectOptions(about, block.value);
    await say(/Start a thread on the block/, 'should this block be declared inapplicable?', 'Start thread');
    const thread = (await source.getOne(relocation.id))!.threads.at(-1)!;
    expect(thread.anchor).toMatchObject({ scope: 'group-pair', groupId: alt.groupIds[0], otherGroupId: crit.groupIds[0] });
    // It is listed here, as the block's.
    expect(threads().querySelector(`[data-thread="${thread.id}"]`)!.getAttribute('data-relation')).toBe('group-pair');
  });

  it('a failed write says why and keeps the draft', async () => {
    const source = inMemoryAnalysisSource(relocation);
    const failing: AnalysisSource = { ...source, update: async () => { throw new Error('the store is offline'); } };
    mount({ analysis: relocation, measure: 'score', source: failing, view: at(undefined) });
    await say(/Start a thread on the analysis/, 'overall: are we missing a criterion?', 'Start thread');
    expect(threads().querySelector('[role="alert"]')!.textContent).toContain('the store is offline');
    expect(threads().querySelector('textarea')!.value).toBe('overall: are we missing a criterion?');
  });

  it('without a source, the write is refused with its reason, and nothing pretends to work', () => {
    mount({ analysis: relocation, measure: 'score', view: at({ alternativeId: 'berlin', criterionId: 'winter-daylight' }) });
    expect(threads().querySelector('textarea')).toBeNull();
    expect(threads().querySelector('.comparanda-reason')!.textContent).toMatch(/not available here: .*read-only/);
    // The record is still all there to read.
    expect(threads().querySelectorAll('[data-thread]').length).toBeGreaterThan(0);
  });

  it('a group thread shows on its members, marked as the group\'s', () => {
    const group = relocation.groups.find((g) => g.axis === 'alternatives')!;
    const member = relocation.alternatives.find((a) => a.groupIds.includes(group.id))!;
    const withGroup = startThread(relocation, {
      threadId: 'tg', anchor: { scope: 'group', groupId: group.id },
      comment: { id: 'c', at: '2026-10-13', body: 'is this grouping still useful?', author: { id: 'dana', displayName: 'Dana', kind: 'human' } },
    });
    mount({ analysis: withGroup, measure: 'score', view: at({ alternativeId: member.id }) });
    const item = threads().querySelector('[data-thread="tg"]')!;
    expect(item.getAttribute('data-relation')).toBe('group');
    expect(item.textContent).toContain(`On the group ${group.label}`);
  });
});

describe('the grid says where discussion is', () => {
  it('a cell with an open thread says so in words, and the legend keys the mark', () => {
    mount({ analysis: relocation, measure: 'score' });
    const open = relocation.threads.find((t) => !t.resolved && t.anchor.scope === 'cell')!;
    const r = relocation.alternatives.findIndex((a) => a.id === open.anchor.alternativeId) + 1;
    const c = relocation.criteria.findIndex((x) => x.id === open.anchor.criterionId) + 1;
    expect(el.querySelector(`[data-cell="${r}:${c}"]`)!.textContent).toMatch(/1 open discussion thread\./);
    expect(el.textContent).toContain('A speech bubble and a number: open discussion threads');
    // A resolved thread leaves no mark.
    const resolved = relocation.threads.find((t) => t.resolved && t.anchor.scope === 'cell')!;
    const rr = relocation.alternatives.findIndex((a) => a.id === resolved.anchor.alternativeId) + 1;
    const rc = relocation.criteria.findIndex((x) => x.id === resolved.anchor.criterionId) + 1;
    expect(el.querySelector(`[data-cell="${rr}:${rc}"]`)!.textContent).not.toMatch(/open discussion/);
  });
});
