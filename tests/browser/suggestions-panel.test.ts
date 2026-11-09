/**
 * The suggestions panel (#256): each open suggestion with accept and decline,
 * bulk by proposer, every staged decision undoable on its own until the write,
 * the write through the source as the host's identity, and a refusal shown
 * with its reason; and a local identity asked for its name before its first
 * decision, by the same field the discussion asks with (#274).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from '@vitest/browser/context';

import { Analysis } from '../../src/core/schema/analysis.js';
import { anonymousIdentity, inMemoryAnalysisSource, localIdentity, type IdentityStorage } from '../../src/store/index.js';
import { mountMatrix, type MatrixHandle } from '../../src/view/index.js';
import { decideSuggestions } from '../../src/core/suggestions.js';
import { initialViewState, setDetailPanel, setFocus } from '../../src/core/view-state.js';
import relocationJson from '../../examples/relocation.json';

const base = Analysis.parse(relocationJson);
const first = base.suggestions[0]!;
// A second open suggestion from the same proposer, so "all from" has two.
const relocation = Analysis.parse({
  ...base,
  suggestions: [...base.suggestions, {
    ...first, id: 'sg-rent-tai', anchor: { scope: 'cell', alternativeId: 'taipei', criterionId: 'rent', measure: 'score' },
    proposed: { ...first.proposed, id: 'a-rent-tai-cleo', value: 1400, justification: 'a listing average' },
  }],
});
const dana = anonymousIdentity({ id: 'dana', displayName: 'Dana' });

let el: HTMLElement;
let handle: MatrixHandle | undefined;
beforeEach(() => { el = document.createElement('div'); document.body.append(el); });
afterEach(() => { handle?.destroy(); handle = undefined; el.remove(); });

const panel = () => el.querySelector<HTMLElement>('section.comparanda-suggestions');
const entry = (id: string) => panel()!.querySelector<HTMLElement>(`[data-suggestion="${id}"]`)!;
const button = (scope: Element, text: string) => Array.from(scope.querySelectorAll('button')).find((b) => b.textContent === text)!;
const settled = () => new Promise((r) => setTimeout(r, 0));

describe('the suggestions panel', () => {
  it('lists each open suggestion in words, refused with the reason when there is no source', () => {
    handle = mountMatrix(el, { analysis: relocation, measure: 'score' });
    expect(panel()!.querySelector('h2')!.textContent).toBe('Open suggestions (2)');
    expect(entry(first.id).textContent).toMatch(/suggests 5 for the cell Winter daylight, Taipei/);
    const accept = button(entry(first.id), 'Accept');
    expect(accept.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(accept.getAttribute('aria-describedby')!)!.textContent).toMatch(/read-only/);
  });

  it('stages a bulk decision, undoes one step on its own, and writes the rest through the source', async () => {
    const source = inMemoryAnalysisSource(relocation);
    handle = mountMatrix(el, { analysis: relocation, measure: 'score', source, identity: dana }, { now: () => new Date('2026-10-20T12:00:00Z'), decideSuggestions });
    const bulk = panel()!.querySelector('[data-bulk="cleo"]')!;
    await userEvent.click(button(bulk, 'Accept all 2'));
    expect(entry(first.id).getAttribute('data-staged')).toBe('accept');
    expect(entry('sg-rent-tai').textContent).toMatch(/Staged: accept\./);
    // Nothing written yet.
    expect((await source.getOne(relocation.id))!.suggestions.every((s) => s.status === 'open')).toBe(true);
    await userEvent.click(button(entry('sg-rent-tai'), 'Undo'));
    expect(entry('sg-rent-tai').hasAttribute('data-staged')).toBe(false);
    expect(document.activeElement?.textContent).toBe('Accept');
    await userEvent.click(button(panel()!, 'Write 1 decision'));
    await settled(); await settled();
    const doc = (await source.getOne(relocation.id))!;
    expect(doc.suggestions.find((s) => s.id === first.id)).toMatchObject({ status: 'accepted', decidedBy: 'dana', decidedAt: '2026-10-20T12:00:00.000Z' });
    expect(doc.suggestions.find((s) => s.id === 'sg-rent-tai')!.status).toBe('open');
    expect(panel()!.querySelector('h2')!.textContent).toBe('Open suggestions (1)');
    expect(panel()!.querySelector('[data-said]')!.textContent).toBe('Wrote 1 decision.');
    // The Write button left with its write: focus stays in the panel, on its heading, never on the grid (#275).
    expect(document.activeElement).toBe(panel()!.querySelector('h2'));
  });

  it('refuses, with the reason, when the host gave the mount no way to write decisions', () => {
    handle = mountMatrix(el, { analysis: relocation, measure: 'score', source: inMemoryAnalysisSource(relocation), identity: dana });
    const accept = button(entry(first.id), 'Accept');
    expect(accept.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(accept.getAttribute('aria-describedby')!)!.textContent).toMatch(/can only list them/);
  });

  it('moves focus to Undo after staging, so the keyboard path continues', async () => {
    const source = inMemoryAnalysisSource(relocation);
    handle = mountMatrix(el, { analysis: relocation, measure: 'score', source, identity: dana }, { decideSuggestions });
    button(entry(first.id), 'Decline').focus();
    await userEvent.keyboard('{Enter}');
    expect(document.activeElement?.textContent).toBe('Undo');
    expect(entry(first.id).textContent).toMatch(/Staged: decline\./);
  });
});

describe('naming a local identity before its first decision (#274)', () => {
  const memory = (): IdentityStorage => {
    const m = new Map<string, string>();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
  };
  const nameForm = () => panel()!.querySelector<HTMLFormElement>('[data-detail="name"]');
  const at = { now: () => new Date('2026-10-20T12:00:00Z'), decideSuggestions };

  it('asks for a name ahead of every decision, and signs the decision with it', async () => {
    const source = inMemoryAnalysisSource(relocation);
    handle = mountMatrix(el, { analysis: relocation, measure: 'score', source, identity: localIdentity({ storage: memory(), newId: () => '1' }) }, at);
    await settled();
    const form = nameForm()!;
    const box = form.querySelector('input')!;
    expect(panel()!.querySelector(`label[for="${box.id}"]`)!.textContent).toBe('Your name');
    const hint = document.getElementById(box.getAttribute('aria-describedby')!)!.textContent!;
    expect(hint).toMatch(/on this device/);
    expect(hint).toMatch(/unverified/);
    // Ahead of the first decision control.
    expect(form.compareDocumentPosition(button(entry(first.id), 'Accept')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await userEvent.click(box);
    await userEvent.keyboard('Bob{Enter}');
    await settled();
    expect(nameForm()).toBeNull();
    // The form left with focus in it: back to the suggestions panel's heading, never to the grid.
    expect(document.activeElement).toBe(panel()!.querySelector('h2'));

    await userEvent.click(button(entry(first.id), 'Accept'));
    await userEvent.click(button(panel()!, 'Write 1 decision'));
    await settled(); await settled();
    const doc = (await source.getOne(relocation.id))!;
    expect(doc.suggestions.find((s) => s.id === first.id)).toMatchObject({ status: 'accepted', decidedBy: 'local-1' });
    expect(doc.authors.find((a) => a.id === 'local-1')).toMatchObject({ displayName: 'Bob', attestation: { method: 'unverified' } });
  });

  it('is the same field in both panels, and a name taken in one is no longer asked by the other', async () => {
    const storage = memory();
    handle = mountMatrix(el, {
      analysis: relocation, measure: 'score', source: inMemoryAnalysisSource(relocation), identity: localIdentity({ storage }),
      view: setDetailPanel(setFocus(initialViewState(relocation), { alternativeId: 'berlin', criterionId: 'winter-daylight' }), true),
    }, at);
    await settled();
    const forms = () => el.querySelectorAll('[data-detail="name"]');
    // Each panel that signs offers the field, built by one component: the same label, hint and button.
    expect(forms()).toHaveLength(2);
    const [a, b] = Array.from(forms());
    const shape = (f: Element) => [f.querySelector('label')!.textContent, f.querySelector('p')!.textContent, f.querySelector('button')!.textContent];
    expect(shape(a!)).toEqual(shape(b!));

    await userEvent.click(nameForm()!.querySelector('input')!);
    await userEvent.keyboard('Ada{Enter}');
    await settled();
    expect(forms()).toHaveLength(0);
    expect(JSON.parse(storage.getItem('comparanda.identity')!).displayName).toBe('Ada');
  });

  it('refuses an empty name out loud, on the field, and keeps nothing', async () => {
    const storage = memory();
    handle = mountMatrix(el, { analysis: relocation, measure: 'score', source: inMemoryAnalysisSource(relocation), identity: localIdentity({ storage }) }, at);
    await settled();
    const box = nameForm()!.querySelector('input')!;
    await userEvent.click(box);
    await userEvent.keyboard('   {Enter}');
    const alert = nameForm()!.querySelector('[role="alert"]')!;
    expect(alert.textContent).toBe('Name not kept: type a name first.');
    expect(box.getAttribute('aria-invalid')).toBe('true');
    expect(box.getAttribute('aria-describedby')!.split(' ')).toEqual([`${box.id}-hint`, alert.id]);
    expect(storage.getItem('comparanda.identity')).toBeNull();
  });

  it('is not asked when the host refuses every decision, and is asked again once one is allowed (#320)', async () => {
    let allowed = false;
    const authorize = (r: { action: string }) => (r.action === 'decide-suggestion' && !allowed ? { enabled: false, reason: 'the review is closed' } : true);
    handle = mountMatrix(el, { analysis: relocation, measure: 'score', source: inMemoryAnalysisSource(relocation), identity: localIdentity({ storage: memory() }), authorize }, at);
    await settled();
    expect(button(entry(first.id), 'Accept').getAttribute('aria-disabled')).toBe('true');
    expect(nameForm()).toBeNull();
    handle.destroy(); handle = undefined;
    allowed = true;
    handle = mountMatrix(el, { analysis: relocation, measure: 'score', source: inMemoryAnalysisSource(relocation), identity: localIdentity({ storage: memory() }), authorize }, at);
    await settled();
    expect(nameForm()).not.toBeNull();
  });

  it('is asked while one decision is still allowed, though the other is refused (#320)', async () => {
    const authorize = (r: { action: string; decision?: string }) => (r.action === 'decide-suggestion' && r.decision === 'accept' ? { enabled: false, reason: 'only decline' } : true);
    handle = mountMatrix(el, { analysis: relocation, measure: 'score', source: inMemoryAnalysisSource(relocation), identity: localIdentity({ storage: memory() }), authorize }, at);
    await settled();
    expect(button(entry(first.id), 'Accept').getAttribute('aria-disabled')).toBe('true');
    expect(nameForm()).not.toBeNull();
  });

  it('keeps a name being typed when the last open suggestion is decided elsewhere, and focus with it (#321)', async () => {
    const source = inMemoryAnalysisSource(relocation);
    handle = mountMatrix(el, { analysis: relocation, measure: 'score', source, identity: localIdentity({ storage: memory() }) }, at);
    await settled();
    const box = nameForm()!.querySelector('input')!;
    await userEvent.click(box);
    await userEvent.keyboard('Ad');
    // Another tab decides both open suggestions through the source.
    const decider = { by: { id: 'dana', displayName: 'Dana', kind: 'human' as const }, at: '2026-10-20T12:00:00.000Z' };
    const ids = relocation.suggestions.map((x) => ({ suggestionId: x.id, decision: 'decline' as const }));
    await source.update(relocation.id, decideSuggestions(relocation, ids, decider).analysis);
    await settled();
    expect(panel()).not.toBeNull();
    expect(panel()!.querySelector('h2')!.textContent).toBe('Open suggestions (0)');
    const kept = nameForm()!.querySelector('input')!;
    expect(kept.value).toBe('Ad');
    expect(document.activeElement).toBe(kept);
    // Taking the name closes the panel: nothing is left in it.
    await userEvent.keyboard('a{Enter}');
    await settled();
    expect(panel()).toBeNull();
    // Focus was settled in the render that took the name, never dropped to the page.
    expect(document.activeElement).not.toBe(document.body);
  });

  it('lets a held panel go once its emptied name field is left (#321)', async () => {
    const source = inMemoryAnalysisSource(relocation);
    handle = mountMatrix(el, { analysis: relocation, measure: 'score', source, identity: localIdentity({ storage: memory() }) }, at);
    await settled();
    await userEvent.click(nameForm()!.querySelector('input')!);
    await userEvent.keyboard('A{Backspace}');
    const decider = { by: { id: 'dana', displayName: 'Dana', kind: 'human' as const }, at: '2026-10-20T12:00:00.000Z' };
    const ids = relocation.suggestions.map((x) => ({ suggestionId: x.id, decision: 'decline' as const }));
    await source.update(relocation.id, decideSuggestions(relocation, ids, decider).analysis);
    await settled();
    // Still drawn, focus in the box: emptying it does not pull the panel out from under the reader.
    expect(panel()).not.toBeNull();
    (document.activeElement as HTMLElement).blur();
    await settled();
    expect(panel()).toBeNull();
  });

  it('holds one draft for both panels: the discussion\'s field, drawn later, starts from the name typed here (#328)', async () => {
    handle = mountMatrix(el, { analysis: relocation, measure: 'score', source: inMemoryAnalysisSource(relocation), identity: localIdentity({ storage: memory() }) }, at);
    await settled();
    await userEvent.click(nameForm()!.querySelector('input')!);
    await userEvent.keyboard('Ad');
    handle.update({ view: setDetailPanel(setFocus(initialViewState(relocation), { alternativeId: 'berlin', criterionId: 'winter-daylight' }), true) });
    await settled();
    const discussion = el.querySelector<HTMLInputElement>('[data-detail="threads"] [data-detail="name"] input')!;
    expect(discussion.value).toBe('Ad');
    // Typed on there, and the field here takes it up when the reader comes back to it.
    await userEvent.click(discussion);
    await userEvent.keyboard('a');
    await userEvent.click(nameForm()!.querySelector('input')!);
    expect(nameForm()!.querySelector('input')!.value).toBe('Ada');
  });

  it('is not asked of an identity that has a name, takes none, or has no way to write decisions', async () => {
    const storage = memory();
    await localIdentity({ storage }).name('Ada');
    for (const [identity, options] of [
      [localIdentity({ storage }), at], [dana, at], [anonymousIdentity(), at],
      // Without decision writes, the panel can only list: nothing to sign.
      [localIdentity({ storage: memory() }), {}],
    ] as const) {
      handle = mountMatrix(el, { analysis: relocation, measure: 'score', source: inMemoryAnalysisSource(relocation), identity }, options);
      await settled();
      expect(nameForm()).toBeNull();
      handle.destroy(); handle = undefined;
    }
    // The standalone page's case: no source, so no writes, so no name.
    handle = mountMatrix(el, { analysis: relocation, measure: 'score', identity: localIdentity({ storage: memory() }) }, at);
    await settled();
    expect(nameForm()).toBeNull();
  });
});
