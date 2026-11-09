/**
 * The saved-views panel (#117, ADR-0007, ADR-0013): saved views work while the
 * annotations are read-only, and every control the store refuses says why --
 * derived from the providers' capabilities, so flipping one changes the
 * control and its reason together. Saving, showing a view whole through the
 * session overlay, the "modified" marker, rename and delete, all by keyboard,
 * with focus kept in the panel.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from '@vitest/browser/context';

import { Analysis } from '../../src/core/schema/analysis.js';
import { initialViewState, transpose, type ViewState } from '../../src/core/view-state.js';
import type { SavedView } from '../../src/core/saved-views.js';
import {
  createInMemoryProvider, emptyReadOnlyProvider, localSavedViews, savedViewStore, type DataProvider,
} from '../../src/store/index.js';
import { mountMatrix, type MatrixHandle } from '../../src/view/index.js';
import relocationJson from '../../examples/relocation.json';

const relocation = Analysis.parse(relocationJson);
const ana = { by: 'anonymous', at: '2026-11-09T10:00:00Z' };

const mapStorage = () => {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
};
/** A provider whose capabilities a test flips. */
const flippable = () => {
  const p = createInMemoryProvider<SavedView>([], { idField: 'id' });
  let caps: Partial<Record<'canCreate' | 'canUpdate' | 'canDelete', boolean>> = {};
  const provider: DataProvider<SavedView> = { ...p, getCapabilities: () => ({ ...p.getCapabilities!(), ...caps }) };
  return { provider, set: (next: typeof caps) => { caps = next; } };
};
/** The standalone page's ports: personal views kept locally, nowhere for shared ones. */
const standalone = (storage = mapStorage()) => {
  const personal = localSavedViews(relocation.id, { storage });
  return { personal, store: savedViewStore({ personal: personal.provider, shared: emptyReadOnlyProvider(), sequences: emptyReadOnlyProvider() }) };
};

let el: HTMLElement;
let handle: MatrixHandle | undefined;
beforeEach(() => { el = document.createElement('div'); document.body.append(el); });
afterEach(() => { handle?.destroy(); handle = undefined; el.remove(); });

const panel = () => el.querySelector<HTMLElement>('section.comparanda-saved-views')!;
const button = (scope: Element, text: string | RegExp) =>
  Array.from(scope.querySelectorAll('button')).find((b) => (typeof text === 'string' ? b.textContent === text : text.test(b.textContent ?? '')))!;
const reasonOf = (b: Element) => document.getElementById(b.getAttribute('aria-describedby') ?? '')?.textContent ?? '';
const entry = (name: string) => Array.from(panel().querySelectorAll<HTMLElement>('[data-saved-view]')).find((li) => li.querySelector('strong')?.textContent === name);
const said = () => panel().querySelector('[data-said]')!.textContent;
const settled = async (until: () => unknown) => {
  for (let i = 0; i < 50 && !until(); i += 1) await new Promise((r) => setTimeout(r, 10));
  expect(until()).toBeTruthy();
};

describe('the saved-views panel', () => {
  it('in standalone, works while annotations are read-only, and says why shared views are not offered', async () => {
    const { store } = standalone();
    handle = mountMatrix(el, { analysis: relocation, measure: 'score', savedViews: { store } });
    await settled(() => panel().getAttribute('data-saved-views') === '0');
    const personal = button(panel(), 'Save as a personal view');
    expect(personal.hasAttribute('aria-disabled')).toBe(false);
    const shared = button(panel(), 'Save as a shared view');
    expect(shared.getAttribute('aria-disabled')).toBe('true');
    // The reason is the shared provider's, in words, visible beside the control.
    expect(reasonOf(shared)).toMatch(/does not accept new items, so a shared view cannot be added here/);
    // And annotations stay read-only, saying so.
    const accept = button(el.querySelector('section.comparanda-suggestions')!, 'Accept');
    expect(reasonOf(accept)).toMatch(/read-only/);
  });

  it('flips a control and its reason with the provider\'s capability', async () => {
    const shared = flippable();
    const personal = flippable();
    const store = savedViewStore({ personal: personal.provider, shared: shared.provider });
    await store.create(initialViewState(relocation), { analysisId: relocation.id, name: 'Cost first', ...ana });
    handle = mountMatrix(el, { analysis: relocation, measure: 'score', savedViews: { store } });
    await settled(() => entry('Cost first'));
    expect(button(panel(), 'Save as a shared view').hasAttribute('aria-disabled')).toBe(false);
    expect(button(entry('Cost first')!, 'Delete').hasAttribute('aria-disabled')).toBe(false);
    shared.set({ canCreate: false });
    personal.set({ canDelete: false });
    handle.update({});
    const refusedShare = button(panel(), 'Save as a shared view');
    expect(refusedShare.getAttribute('aria-disabled')).toBe('true');
    expect(reasonOf(refusedShare)).toMatch(/does not accept new items/);
    const refusedDelete = button(entry('Cost first')!, 'Delete');
    expect(refusedDelete.getAttribute('aria-disabled')).toBe('true');
    expect(reasonOf(refusedDelete)).toMatch(/does not accept deletes, so the view "Cost first" cannot be deleted here/);
    // A refused control does nothing when pressed: no confirmation is opened.
    refusedDelete.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(entry('Cost first')!.querySelector('[data-confirm-delete]')).toBeNull();
  });

  it('saves the arrangement by keyboard, marks it modified when it moves on, and saves over or reverts it', async () => {
    const { store } = standalone();
    const reported: ViewState[] = [];
    handle = mountMatrix(el, { analysis: relocation, measure: 'score', savedViews: { store }, onViewChange: (v) => reported.push(v) });
    await settled(() => panel().getAttribute('data-saved-views') === '0');
    panel().querySelector<HTMLInputElement>('input[type="text"]')!.focus();
    await userEvent.keyboard('Cost first{Enter}');
    await settled(() => entry('Cost first'));
    expect(said()).toMatch(/Saved the current arrangement as the personal view “Cost first”/);
    expect(panel().querySelector('[data-shown-view]')!.textContent).toMatch(/Showing “Cost first”, as saved/);
    // The reader moves on: the marker names what changed, and nothing is written until asked.
    await userEvent.click(el.querySelector<HTMLInputElement>('input[type="checkbox"][data-axis="alternatives"]')!);
    expect(panel().querySelector('[data-shown-view]')!.textContent).toMatch(/modified since, in the grouping/);
    expect((await store.list(relocation.id, 'anonymous'))[0]!.snapshot.grouping.alternatives).toEqual([]);
    await userEvent.click(button(panel(), 'Revert to “Cost first”'));
    expect(panel().querySelector('[data-shown-view]')!.textContent).toMatch(/as saved/);
    expect(reported.at(-1)!.grouping.alternatives).toEqual([]);
    await userEvent.click(el.querySelector<HTMLInputElement>('input[type="checkbox"][data-axis="alternatives"]')!);
    await userEvent.click(button(panel(), 'Save over “Cost first”'));
    await settled(() => /as saved/.test(panel().querySelector('[data-shown-view]')!.textContent ?? ''));
    expect((await store.list(relocation.id, 'anonymous'))[0]!.snapshot.grouping.alternatives.length).toBeGreaterThan(0);
  });

  it('shows a saved view whole, through the session overlay, keeping where the reader is', async () => {
    const { store } = standalone();
    const turned = transpose(initialViewState(relocation));
    await store.create({ ...turned, encoding: 'text-only' }, { analysisId: relocation.id, name: 'Turned', ...ana });
    const reported: ViewState[] = [];
    handle = mountMatrix(el, { analysis: relocation, measure: 'score', savedViews: { store }, onViewChange: (v) => reported.push(v) });
    await settled(() => entry('Turned'));
    expect(el.querySelector('.comparanda-matrix')!.getAttribute('data-orientation')).toBe('standard');
    button(entry('Turned')!, 'Show “Turned”').focus();
    await userEvent.keyboard('{Enter}');
    expect(el.querySelector('.comparanda-matrix')!.getAttribute('data-orientation')).toBe('transposed');
    expect(reported.at(-1)!.transposed).toBe(true);
    expect(said()).toBe('Showing the view “Turned”.');
    // Focus stays on the control that was pressed.
    expect(document.activeElement?.textContent).toBe('Show “Turned”');
    // A host that gives a different arrangement takes over from the loaded one.
    handle.update({ view: initialViewState(relocation) });
    expect(el.querySelector('.comparanda-matrix')!.getAttribute('data-orientation')).toBe('standard');
  });

  it('renames and deletes by keyboard, keeping focus in the panel', async () => {
    const { store } = standalone();
    await store.create(initialViewState(relocation), { analysisId: relocation.id, name: 'Cost first', ...ana });
    handle = mountMatrix(el, { analysis: relocation, measure: 'score', savedViews: { store } });
    await settled(() => entry('Cost first'));
    button(entry('Cost first')!, 'Rename').focus();
    await userEvent.keyboard('{Enter}');
    const field = entry('Cost first')!.querySelector<HTMLInputElement>('input')!;
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe('Cost first');
    await userEvent.keyboard('{Escape}');
    expect(document.activeElement?.textContent).toBe('Rename');
    await userEvent.keyboard('{Enter}');
    await userEvent.fill(entry('Cost first')!.querySelector<HTMLInputElement>('input')!, 'Cheapest');
    await userEvent.keyboard('{Enter}');
    await settled(() => entry('Cheapest'));
    expect(document.activeElement?.textContent).toBe('Rename');
    button(entry('Cheapest')!, 'Delete').focus();
    await userEvent.keyboard('{Enter}');
    // The safe answer has focus.
    expect(document.activeElement?.textContent).toBe('Keep it');
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}{Enter}');
    await settled(() => !entry('Cheapest'));
    expect(document.activeElement).toBe(panel().querySelector('[data-panel-heading]'));
    expect(said()).toBe('Deleted the view “Cheapest”.');
    expect(await store.list(relocation.id, 'anonymous')).toEqual([]);
  });

  it('tells the reader, in the panel, when nothing it saves will outlive the tab', async () => {
    const refusing = { getItem: () => null, setItem: (): undefined => { throw Object.assign(new Error('blocked'), { name: 'SecurityError' }); }, removeItem: () => undefined };
    const { store, personal } = standalone(refusing);
    handle = mountMatrix(el, { analysis: relocation, measure: 'score', savedViews: { store, notice: () => personal.status().notice } });
    expect(panel().querySelector('[data-saved-views-notice]')!.textContent).toMatch(/will be lost when this tab closes/);
  });

  it('refuses a malformed savedViews prop, naming it', () => {
    expect(() => mountMatrix(el, { analysis: relocation, measure: 'score', savedViews: {} as never })).toThrow(/props.savedViews must be/);
  });
});
