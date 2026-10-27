/**
 * The reader's focus follows what the matrix shows (#283): when the focused
 * alternative or criterion leaves the layout (hidden by group, hidden by the
 * host, tombstoned in the document), `session.focus` settles on the stop the
 * grid actually shows, and is reported once.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from '@vitest/browser/context';

import { Analysis } from '../../src/core/schema/analysis.js';
import { initialViewState, setFilter, setFocus, type ViewState } from '../../src/core/view-state.js';
import { inMemoryAnalysisSource } from '../../src/store/index.js';
import { h } from 'preact';
import { mountMatrix, type MatrixHandle, type MatrixViewProps, type MountMatrixProps } from '../../src/view/index.js';
import relocationJson from '../../examples/relocation.json';

const relocation = Analysis.parse(relocationJson);
let el: HTMLElement;
let handle: MatrixHandle | undefined;
const views: ViewState[] = [];
const mount = (props: Omit<MountMatrixProps, 'onViewChange'>) => {
  handle = mountMatrix(el, { ...props, onViewChange: (v) => views.push(v) });
  return handle;
};
beforeEach(() => {
  el = document.createElement('div');
  document.body.append(el);
  views.length = 0;
});
afterEach(() => {
  handle?.destroy();
  el.remove();
});

const stop = () => el.querySelector<HTMLElement>('[role="grid"] [tabindex="0"]')!;
const focusAt = (focus: ViewState['session']['focus']) => setFocus(initialViewState(relocation), focus);

describe('focus that loses its place settles where the stop is', () => {
  it('after the reader hides the focused row by group: on its column\'s header, reported', async () => {
    mount({ analysis: relocation, measure: 'score', view: focusAt({ alternativeId: 'seoul', criterionId: 'income-tax' }) });
    const pick = el.querySelector<HTMLSelectElement>('.comparanda-grouping select[id$="-g-alternatives"]')!;
    await userEvent.selectOptions(pick, 'g-asia');
    await userEvent.click(Array.from(el.querySelectorAll('.comparanda-grouping button')).find((b) => /Hide its options/.test(b.textContent!))!);
    expect(views.at(-1)!.session.focus).toEqual({ criterionId: 'income-tax' });
    expect(stop().getAttribute('data-entry')).toBe('income-tax');
  });

  it('after the host hides it: reported once', () => {
    const view = focusAt({ alternativeId: 'seoul', criterionId: 'income-tax' });
    const h = mount({ analysis: relocation, measure: 'score', view });
    h.update({ view: setFilter(view, { hiddenAlternatives: ['seoul'] }) });
    expect(views).toHaveLength(1);
    expect(views[0]!.session.focus).toEqual({ criterionId: 'income-tax' });
    // Passed again, it changes nothing more: nothing more is reported.
    h.update({ view: setFilter(view, { hiddenAlternatives: ['seoul'] }) });
    expect(views).toHaveLength(1);
  });

  it('after the document tombstones it: reported once', async () => {
    const source = inMemoryAnalysisSource(relocation);
    mount({ analysis: relocation, measure: 'score', source, view: focusAt({ alternativeId: 'seoul' }) });
    const doc = structuredClone(relocation);
    doc.alternatives.find((a) => a.id === 'seoul')!.tombstoned = true;
    await source.update(relocation.id, doc);
    expect(views).toHaveLength(1);
    expect(views[0]!.session.focus).toBeUndefined();
    expect(stop().classList.contains('comparanda-corner')).toBe(true);
  });

  it('keeps no settled focus from a render that failed: the document and the focus roll back together', async () => {
    const seen: unknown[] = [];
    const component = (p: MatrixViewProps) => {
      seen.push(p.view.session.focus);
      if (p.analysis.alternatives.find((a) => a.id === 'seoul')?.tombstoned) throw new Error('render failed');
      return h('p', null, 'ok');
    };
    // The render's error is the test's to expect, not an unhandled one.
    const errors: unknown[] = [];
    const source = inMemoryAnalysisSource(relocation, { onSubscriberError: (e) => errors.push(e) });
    handle = mountMatrix(el, { analysis: relocation, measure: 'score', source, view: focusAt({ alternativeId: 'seoul' }) }, { component });
    const doc = structuredClone(relocation);
    doc.alternatives.find((a) => a.id === 'seoul')!.tombstoned = true;
    await source.update(relocation.id, doc).catch(() => undefined);
    expect(errors).toHaveLength(1);
    handle.update({ encoding: 'text-only' });
    expect(seen.at(-1)).toEqual({ alternativeId: 'seoul' });
  });

  it('reports nothing when the focus is still shown', () => {
    const view = focusAt({ alternativeId: 'lisbon', criterionId: 'income-tax' });
    const h = mount({ analysis: relocation, measure: 'score', view });
    h.update({ view: setFilter(view, { hiddenAlternatives: ['seoul'] }) });
    expect(views).toHaveLength(0);
  });
});
