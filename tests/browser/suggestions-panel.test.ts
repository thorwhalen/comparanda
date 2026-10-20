/**
 * The suggestions panel (#256): each open suggestion with accept and decline,
 * bulk by proposer, every staged decision undoable on its own until the write,
 * the write through the source as the host's identity, and a refusal shown
 * with its reason.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from '@vitest/browser/context';

import { Analysis } from '../../src/core/schema/analysis.js';
import { anonymousIdentity, inMemoryAnalysisSource } from '../../src/store/index.js';
import { mountMatrix, type MatrixHandle } from '../../src/view/index.js';
import { decideSuggestions } from '../../src/core/suggestions.js';
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
