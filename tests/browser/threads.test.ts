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
import { agentIdentity, anonymousIdentity, inMemoryAnalysisSource, type AnalysisSource } from '../../src/store/index.js';
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
    // Named as what she is: a typed name nobody vouched for (ADR-0012).
    expect(threads().textContent).toContain('Dana (human, unverified)');

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

    // Reopened (#186): back in the open list, and the resolution is kept as a comment.
    const resolvedItem = threads().querySelector('[data-resolved] > [data-thread]')!;
    const reopenedId = resolvedItem.getAttribute('data-thread')!;
    await userEvent.click(Array.from(resolvedItem.querySelectorAll('button')).find((b) => b.textContent === 'Reopen thread')!);
    await settled();
    const back = threads().querySelector(`ol:not([data-resolved]) > [data-thread="${reopenedId}"]`)!;
    expect(back.textContent).toMatch(/Reopened\. It had been resolved by Dana \(human, unverified\) \[dana\], 2026-10-13T12:00:00\.000Z\./);
    expect(document.activeElement?.id).toBe(panel().querySelector('[data-panel-heading]')!.id);
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

describe('focus while a thread write is in flight (#197)', () => {
  const buttonNamed = (name: string) => Array.from(threads().querySelectorAll('button')).find((b) => b.textContent === name)!;
  /** A source whose writes wait for `release`, then fail while `failing` is set. */
  function slowSource() {
    const source = inMemoryAnalysisSource(relocation);
    const control = { failing: false, calls: 0, release: undefined as (() => void) | undefined };
    const wrapped: AnalysisSource = {
      ...source,
      update: async (...args: Parameters<AnalysisSource['update']>) => {
        if (control.failing) {
          control.calls += 1;
          await new Promise<void>((r) => { control.release = r; });
          throw new Error('the store is offline');
        }
        return source.update(...args);
      },
    };
    return { source: wrapped, control };
  }

  for (const [verb, button] of [['resolve', 'Resolve thread'], ['reopen', 'Reopen thread']] as const) {
    it(`a failed ${verb} keeps focus on its button, which stays announced as unavailable while busy`, async () => {
      const { source, control } = slowSource();
      mount({ analysis: relocation, measure: 'score', source, identity: dana, view: at({ alternativeId: 'berlin', criterionId: 'winter-daylight' }) });
      if (verb === 'reopen') {
        await userEvent.click(buttonNamed('Resolve thread'));
        await settled();
        await userEvent.click(Array.from(threads().querySelectorAll('button')).find((b) => /Show \d+ resolved/.test(b.textContent!))!);
      }
      control.failing = true;
      control.calls = 0;
      const target = buttonNamed(button);
      await userEvent.click(target);
      // In flight: still the focused element, marked unavailable, and a second click does nothing.
      expect(document.activeElement).toBe(target);
      expect(target.getAttribute('aria-disabled')).toBe('true');
      expect(target.hasAttribute('disabled')).toBe(false);
      // Busy reads as busy to the eye too (the stylesheet keys off aria-disabled), and a second activation is ignored.
      expect(getComputedStyle(target).cursor).toBe('progress');
      const before = control.calls;
      target.click();
      target.click();
      await settled();
      expect(control.calls).toBe(before);
      control.release!();
      await settled();
      expect(threads().querySelector('[role="alert"]')!.textContent).toContain('the store is offline');
      expect(document.activeElement).toBe(target);
      expect(target.getAttribute('aria-disabled')).toBe('false');
    });
  }
});

describe('a busy compose form (#197)', () => {
  it('keeps focus on its button, sends once however often it is activated, and says why on failure', async () => {
    const source = inMemoryAnalysisSource(relocation);
    let calls = 0;
    let release!: () => void;
    const slow: AnalysisSource = { ...source, update: async () => { calls += 1; await new Promise<void>((r) => { release = r; }); throw new Error('the store is offline'); } };
    mount({ analysis: relocation, measure: 'score', source: slow, identity: dana, view: at(undefined) });
    const box = threads().querySelector('textarea')!;
    await userEvent.click(box);
    await userEvent.keyboard('one thought');
    const send = box.closest('form')!.querySelector('button')!;
    await userEvent.click(send);
    expect(document.activeElement).toBe(send);
    send.click();
    send.click();
    await settled();
    expect(calls).toBe(1);
    release();
    await settled();
    expect(threads().querySelector('[role="alert"]')!.textContent).toContain('the store is offline');
    expect(document.activeElement).toBe(send);
    expect(box.value).toBe('one thought');
  });
});

describe('review findings', () => {
  it('two writes sent together both land: the second builds on the first', async () => {
    const source = inMemoryAnalysisSource(relocation);
    const slow: AnalysisSource = { ...source, update: async (id, doc) => { await new Promise((r) => setTimeout(r, 40)); return source.update(id, doc); } };
    mount({ analysis: relocation, measure: 'score', source: slow, identity: dana, view: at({ alternativeId: 'berlin', criterionId: 'winter-daylight' }) });
    const open = relocation.threads.find((t) => !t.resolved && t.anchor.alternativeId === 'berlin' && t.anchor.criterionId === 'winter-daylight')!;
    const item = () => threads().querySelector(`[data-thread="${open.id}"]`)!;
    await userEvent.click(item().querySelector('textarea')!);
    await userEvent.keyboard('first');
    await userEvent.click(Array.from(item().querySelectorAll('button')).find((b) => b.textContent === 'Reply')!);
    await userEvent.click(Array.from(item().querySelectorAll('button')).find((b) => b.textContent === 'Resolve thread')!);
    await new Promise((r) => setTimeout(r, 200));
    const stored = (await source.getOne(relocation.id))!.threads.find((t) => t.id === open.id)!;
    expect(stored.comments.at(-1)!.body).toBe('first');
    expect(stored.resolved).toBe(true);
  });

  it('a draft stays where it was written: moving the panel starts afresh', async () => {
    const source = inMemoryAnalysisSource(relocation);
    const handle = mount({ analysis: relocation, measure: 'score', source, view: at({ alternativeId: 'berlin', criterionId: 'rent' }) });
    const about = threads().querySelector<HTMLSelectElement>('select');
    if (about) await userEvent.selectOptions(about, about.options[about.options.length - 1]!.value);
    const box = Array.from(threads().querySelectorAll('textarea')).at(-1)!;
    await userEvent.click(box);
    await userEvent.keyboard('about berlin rent');
    handle.update({ view: at({ criterionId: 'eu-residency-path' }) });
    const fresh = Array.from(threads().querySelectorAll('textarea')).at(-1)!;
    expect(fresh.value).toBe('');
    expect(threads().textContent).not.toContain('undefined');
  });

  it('reply and resolve are asked of the thread\'s own anchor', () => {
    const group = relocation.groups.find((g) => g.axis === 'alternatives')!;
    const member = relocation.alternatives.find((a) => a.groupIds.includes(group.id))!;
    const withGroup = startThread(relocation, {
      threadId: 'tg', anchor: { scope: 'group', groupId: group.id },
      comment: { id: 'c', at: '2026-10-13', body: 'grouping?', author: { id: 'dana', displayName: 'Dana', kind: 'human' } },
    });
    mount({
      analysis: withGroup, measure: 'score', source: inMemoryAnalysisSource(withGroup), view: at({ alternativeId: member.id }),
      authorize: (r) => ('target' in r && r.target?.kind === 'group' ? { enabled: false, reason: 'groups are the facilitator\'s to discuss' } : true),
    });
    const item = threads().querySelector('[data-thread="tg"]')!;
    expect(item.querySelector('button')).toBeNull();
    expect(item.textContent).toContain('groups are the facilitator\'s to discuss');
    // The position's own form is still offered: the alternative is not refused.
    expect(Array.from(threads().querySelectorAll('button')).some((b) => b.textContent === 'Start thread')).toBe(true);
  });
});

describe('who writes, and who may (#74, ADR-0012)', () => {
  it('names an agent by its typed kind and run wherever it comments', async () => {
    const source = inMemoryAnalysisSource(relocation);
    const scorer = agentIdentity({ name: 'scorer', model: 'm-1', runId: 'r9' });
    mount({ analysis: relocation, measure: 'score', source, identity: scorer, view: at({ criterionId: 'rent' }) });
    await say(/Start a thread on the criterion Rent/, 'flagging a gap', 'Start thread');
    const doc = (await source.getOne(relocation.id))!;
    expect(doc.authors.find((a) => a.id === 'scorer:r9')).toMatchObject({ kind: 'agent', agent: { name: 'scorer', model: 'm-1', runId: 'r9' } });
    expect(threads().textContent).toContain('scorer (agent scorer, model m-1, run r9, unverified)');
  });

  it('asks the host again when the write happens: a refusal since the form was drawn writes nothing', async () => {
    const source = inMemoryAnalysisSource(relocation);
    let allowed = true;
    mount({
      analysis: relocation, measure: 'score', source, identity: dana, view: at({ criterionId: 'rent' }),
      authorize: () => (allowed ? true : { enabled: false, reason: 'the review window has closed' }),
    });
    allowed = false;
    await say(/Start a thread on the criterion Rent/, 'too late?', 'Start thread');
    expect((await source.getOne(relocation.id))!.threads).toHaveLength(relocation.threads.length);
    expect(threads().textContent).toContain('the review window has closed');
  });
});

describe('the host tells starting, answering and resolving apart (#194)', () => {
  const owner = (r: { action: string; thread?: string }) => (r.action === 'comment' && r.thread === 'resolve' ? { enabled: false, reason: 'only the owner resolves' } : true);

  it('offers the Reply form and no Resolve button where only resolving is refused, each with its own reason', () => {
    mount({
      analysis: relocation, measure: 'score', source: inMemoryAnalysisSource(relocation), identity: dana,
      view: at({ alternativeId: 'berlin', criterionId: 'winter-daylight' }), authorize: owner,
    });
    const item = threads().querySelector('[data-thread]')!;
    expect(item.querySelector('textarea')).not.toBeNull();
    expect(Array.from(item.querySelectorAll('button')).some((b) => b.textContent === 'Resolve thread')).toBe(false);
    expect(item.querySelector('.comparanda-reason')!.textContent).toMatch(/Resolving this thread is not available: only the owner resolves/);
    // Starting is still open.
    expect(threads().textContent).toContain('Start a thread on');
  });

  it('asks again at write time with the act named: a refusal since the button was drawn writes nothing', async () => {
    const store = inMemoryAnalysisSource(relocation);
    const asked: string[] = [];
    let closed = false;
    let pressed = false;
    // The window closes after the button is drawn and pressed, as the write reads the latest document.
    const source: AnalysisSource = { ...store, getOne: async (id) => { if (pressed) closed = true; return store.getOne(id); } };
    mount({
      analysis: relocation, measure: 'score', source, identity: dana, view: at({ alternativeId: 'berlin', criterionId: 'winter-daylight' }),
      authorize: (r) => {
        if (r.action === 'comment') asked.push(r.thread ?? '');
        return closed && r.action === 'comment' && r.thread === 'resolve' ? { enabled: false, reason: 'resolving closed meanwhile' } : true;
      },
    });
    const button = Array.from(threads().querySelectorAll('button')).find((b) => b.textContent === 'Resolve thread')!;
    pressed = true;
    await userEvent.click(button);
    await settled();
    // The refusal redraws the thread with the host's reason in place of the button.
    expect(threads().textContent).toContain('resolving closed meanwhile');
    expect(asked).toContain('resolve');
    expect((await source.getOne(relocation.id))!.threads.filter((t) => t.resolved)).toHaveLength(relocation.threads.filter((t) => t.resolved).length);
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
