/**
 * The matrix's group select and the scatter's scope offer the same groups
 * (#342): both read `pickableGroups`, the matrix keeping only the top level
 * (ADR-0008). A group left with no live member is offered by neither, and the
 * "Show in their groups" control does not band by it or name it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from '@vitest/browser/context';

import { Analysis } from '../../src/core/schema/analysis.js';
import { initialViewState, type ViewState } from '../../src/core/view-state.js';
import { mountMatrix, ScatterPanel, type MatrixHandle } from '../../src/view/index.js';
import relocationJson from '../../examples/relocation.json';

/** Relocation with Montreal tombstoned (the Americas left with no live member), Iberia under Europe, and a criteria group with nothing in it. */
const edited = () => {
  const doc = structuredClone(Analysis.parse(relocationJson));
  doc.alternatives.find((a) => a.id === 'montreal')!.tombstoned = true;
  doc.groups.push({ id: 'g-iberia', label: 'Iberia', axis: 'alternatives', parentId: 'g-europe' });
  doc.alternatives.find((a) => a.id === 'lisbon')!.groupIds = ['g-iberia'];
  doc.groups.push({ id: 'g-paperwork', label: 'Paperwork', axis: 'criteria' });
  return Analysis.parse(doc);
};

let el: HTMLElement;
let handle: MatrixHandle | undefined;
beforeEach(() => {
  el = document.createElement('div');
  document.body.append(el);
});
afterEach(() => {
  handle?.destroy();
  handle = undefined;
  el.remove();
});

const options = (select: HTMLSelectElement | null) => Array.from(select!.options, (o) => o.value);
const pick = (axis: 'alternatives' | 'criteria') => el.querySelector<HTMLSelectElement>(`.comparanda-grouping select[id$="-g-${axis}"]`);
const scope = () => el.querySelector<HTMLSelectElement>('details[data-analysis="scatter"] select[id$="-scope"]');
const said = () => el.querySelector('[data-announce]')!.textContent!.trim();

describe('the matrix\'s group select and the scatter\'s scope (#342)', () => {
  it('offer the same groups, the matrix only the top level, and neither a group with no live member', async () => {
    const doc = edited();
    handle = mountMatrix(el, { analysis: doc, measure: 'score', view: initialViewState(doc) }, { panels: [ScatterPanel] });
    await userEvent.click(el.querySelector('details[data-analysis="scatter"] summary')!);

    // The scatter: every alternative, then each pickable group, sub-groups included.
    expect(options(scope())).toEqual(['', 'g-europe', 'g-asia', 'g-iberia']);
    // The matrix: the same groups, top level only; the Americas, with no live member, are not offered.
    expect(options(pick('alternatives'))).toEqual(['g-europe', 'g-asia']);
    expect(options(pick('alternatives'))).toEqual(options(scope()).filter((id) => id !== '' && id !== 'g-iberia'));
    // An empty criteria group is not offered either.
    expect(options(pick('criteria'))).toEqual(['g-cost', 'g-climate', 'g-logistics', 'g-eu']);
  });

  it('lets go of a picked group that stops being offered, so its return does not bring the pick back', async () => {
    const doc = edited();
    handle = mountMatrix(el, { analysis: doc, measure: 'score' });
    await userEvent.selectOptions(pick('alternatives')!, 'g-asia');
    expect(pick('alternatives')!.value).toBe('g-asia');
    const withoutAsia = structuredClone(doc);
    for (const a of withoutAsia.alternatives) if (a.groupIds.includes('g-asia')) a.tombstoned = true;
    handle.update({ analysis: Analysis.parse(withoutAsia) });
    await expect.poll(() => pick('alternatives')!.value).toBe('g-europe');
    handle.update({ analysis: doc });
    await expect.poll(() => options(pick('alternatives'))).toEqual(['g-europe', 'g-asia']);
    expect(pick('alternatives')!.value).toBe('g-europe');
  });

  it('bands only by the groups it offers, and names only those', async () => {
    const doc = edited();
    const views: ViewState[] = [];
    handle = mountMatrix(el, { analysis: doc, measure: 'score', onViewChange: (v) => views.push(v) });
    await userEvent.click(el.querySelector<HTMLInputElement>('.comparanda-grouping input[data-axis="alternatives"]')!);
    expect(views.at(-1)!.grouping.alternatives).toEqual(['g-europe', 'g-asia']);
    expect(said()).toBe('Showing the options in their groups: Europe, Asia.');
    expect(Array.from(el.querySelectorAll('tbody[data-group]'), (b) => b.getAttribute('data-group'))).toEqual(['g-europe', 'g-asia']);
  });
});
