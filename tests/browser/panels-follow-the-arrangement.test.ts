/**
 * The analysis panels follow the reader's arrangement (#292): each lists its
 * alternatives and criteria in the matrix's order, leaves out what the reader
 * hid and says so, follows a new arrangement as it arrives, and still computes
 * over the whole document.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from '@vitest/browser/context';

import { Analysis } from '../../src/core/schema/analysis.js';
import { agreement } from '../../src/core/analyses/agreement.js';
import { applyOrder, initialViewState, setFilter, transpose, type ViewState } from '../../src/core/view-state.js';
import { AgreementPanel, DotPlotsPanel, mountMatrix, ScatterPanel, type MatrixHandle } from '../../src/view/index.js';
import languagesJson from '../../examples/languages.json';
import relocationJson from '../../examples/relocation.json';

const relocation = Analysis.parse(relocationJson);
const languages = Analysis.parse(languagesJson);

let el: HTMLElement;
let handle: MatrixHandle | undefined;
beforeEach(() => { el = document.createElement('div'); document.body.append(el); });
afterEach(() => { handle?.destroy(); handle = undefined; el.remove(); });

const by = { kind: 'manual', by: 'ana' } as const;
/** Alternatives and criteria reversed, one of each hidden. */
const arranged = (a: Analysis, hide: { alternative: string; criterion: string }): ViewState => {
  const v = initialViewState(a);
  const reversed = applyOrder(applyOrder(v, 'alternatives', [...v.alternativeOrder.order].reverse(), by), 'criteria', [...v.criterionOrder.order].reverse(), by);
  return setFilter(reversed, { hiddenAlternatives: [hide.alternative], hiddenCriteria: [hide.criterion] });
};
/** The ids a view shows, in its order. */
const order = (ids: readonly string[], hidden: string) => ids.filter((id) => id !== hidden);
const opened = async (kind: string) => {
  const details = el.querySelector<HTMLDetailsElement>(`details[data-analysis="${kind}"]`)!;
  await userEvent.click(details.querySelector('summary')!);
  return details;
};
const note = (panel: Element) => panel.querySelector('[data-hidden-note]')?.textContent;

describe('the agreement panel follows the arrangement', () => {
  const view = arranged(relocation, { alternative: 'seoul', criterion: 'rent' });

  it('lists criteria in the matrix\'s order without the hidden one, says so, and computes over every one', async () => {
    handle = mountMatrix(el, { analysis: relocation, measure: 'score', view }, { panels: [AgreementPanel] });
    const panel = await opened('agreement');
    const rows = Array.from(panel.querySelectorAll('table[data-agreement] tbody tr'), (r) => r.getAttribute('data-criterion'));
    const computed = agreement(relocation, { measure: 'score' }).criteria.map((c) => c.criterionId);
    expect(rows).toEqual(order(view.criterionOrder.order, 'rent').filter((id) => computed.includes(id)));
    expect(note(panel)).toBe('Hidden in the matrix, so not listed here: 1 option and 1 criterion. They are still counted in every figure.');
    // Still counted: each row's alpha is the one computed over the whole document.
    const expected = new Map(agreement(relocation, { measure: 'score' }).criteria.map((c) => [c.criterionId, c.alpha === undefined ? 'undefined' : c.alpha.toFixed(2)]));
    for (const r of Array.from(panel.querySelectorAll('table[data-agreement] tbody tr'))) {
      expect(r.querySelector('td')!.textContent).toBe(expected.get(r.getAttribute('data-criterion')!));
    }
  });

  it('lists the camps\' common ground and divisions only for cells the matrix shows, alternative by alternative in its order', async () => {
    handle = mountMatrix(el, { analysis: relocation, measure: 'score', view }, { panels: [AgreementPanel] });
    const panel = await opened('agreement');
    const select = (author: string) => Array.from(panel.querySelectorAll<HTMLSelectElement>('fieldset select')).find((s) => s.id.endsWith(`-in-${author}`))!;
    await userEvent.selectOptions(select('ana'), '0');
    await userEvent.selectOptions(select('ben'), '1');
    const said = Array.from(panel.querySelectorAll('[data-consensus-status] li'), (li) => li.textContent!);
    expect(said.length).toBeGreaterThan(0);
    const labelOf = new Map(relocation.alternatives.map((a) => [a.id, a.label]));
    const ranks = said.map((s) => order(view.alternativeOrder.order, 'seoul').findIndex((id) => s.startsWith(`${labelOf.get(id)} on `)));
    // Every line is about a shown alternative, and within each status they come in the matrix's order.
    expect(ranks.every((r) => r >= 0)).toBe(true);
    for (const section of Array.from(panel.querySelectorAll('[data-consensus-status]'))) {
      const within = Array.from(section.querySelectorAll('li'), (li) => order(view.alternativeOrder.order, 'seoul').findIndex((id) => li.textContent!.startsWith(`${labelOf.get(id)} on `)));
      expect(within).toEqual([...within].sort((a, b) => a - b));
    }
    expect(said.some((s) => s.includes(' on Rent:'))).toBe(false);
  });

  it('follows a new arrangement as it arrives, and lists everything again once nothing is hidden', async () => {
    handle = mountMatrix(el, { analysis: relocation, measure: 'score', view }, { panels: [AgreementPanel] });
    const panel = await opened('agreement');
    handle.update({ view: initialViewState(relocation) });
    const rows = Array.from(panel.querySelectorAll('table[data-agreement] tbody tr'), (r) => r.getAttribute('data-criterion'));
    expect(rows).toEqual(agreement(relocation, { measure: 'score' }).criteria.map((c) => c.criterionId));
    expect(note(panel)).toBeUndefined();
  });
});

describe('the dot plots panel follows the arrangement', () => {
  const view = arranged(relocation, { alternative: 'seoul', criterion: 'rent' });

  it('draws a plot per shown criterion and a row per shown alternative, in the matrix\'s order, and says what it left out', async () => {
    handle = mountMatrix(el, { analysis: relocation, measure: 'score', view }, { panels: [DotPlotsPanel] });
    const panel = await opened('dot-plots');
    expect(Array.from(panel.querySelectorAll('[data-dot-plot]'), (p) => p.getAttribute('data-dot-plot'))).toEqual(order(view.criterionOrder.order, 'rent'));
    for (const table of Array.from(panel.querySelectorAll('table.comparanda-dot-plot'))) {
      expect(Array.from(table.querySelectorAll('tbody tr'), (r) => r.getAttribute('data-row'))).toEqual(order(view.alternativeOrder.order, 'seoul'));
    }
    // Nothing here is a figure over the rows: the hidden ones are only not listed.
    expect(note(panel)).toBe('Hidden in the matrix, so not listed here: 1 option and 1 criterion.');
  });

  it('follows the matrix transposed: the arrangement is by axis, not by rows and columns', async () => {
    handle = mountMatrix(el, { analysis: relocation, measure: 'score', view: transpose(view) }, { panels: [DotPlotsPanel] });
    const panel = await opened('dot-plots');
    expect(Array.from(panel.querySelectorAll('[data-dot-plot]'), (p) => p.getAttribute('data-dot-plot'))).toEqual(order(view.criterionOrder.order, 'rent'));
  });
});

describe('the scatter panel follows the arrangement', () => {
  const point = (panel: Element, id: string) => panel.querySelector(`[data-point="${id}"]`);

  it('draws and lists only the shown alternatives, in order, and offers only the shown criteria as axes', async () => {
    const view = arranged(languages, { alternative: 'rust', criterion: 'hiring' });
    handle = mountMatrix(el, { analysis: languages, measure: 'score', view }, { panels: [ScatterPanel] });
    const panel = await opened('scatter');
    expect(point(panel, 'rust')).toBeNull();
    expect(point(panel, 'go')).not.toBeNull();
    expect(Array.from(panel.querySelectorAll('table tbody tr'), (r) => r.getAttribute('data-row'))).toEqual(order(view.alternativeOrder.order, 'rust'));
    const offered = Array.from(panel.querySelectorAll<HTMLOptionElement>('fieldset select')[0]!.options, (o) => o.value);
    expect(offered).not.toContain('hiring');
    expect(offered).toEqual(view.criterionOrder.order.filter((id) => offered.includes(id)));
    expect(note(panel)).toBe('Hidden in the matrix, so not listed here: 1 option and 1 criterion. They are still counted in every figure.');
  });

  it('says why there is no plot when the matrix shows fewer than two comparable criteria', async () => {
    const v = initialViewState(languages);
    const view = setFilter(v, { hiddenCriteria: v.criterionOrder.order.slice(1) });
    handle = mountMatrix(el, { analysis: languages, measure: 'score', view }, { panels: [ScatterPanel] });
    const panel = await opened('scatter');
    expect(panel.querySelector('svg')).toBeNull();
    expect(panel.querySelector('[role="note"]')!.textContent).toMatch(/and the matrix shows [01] of them: show another to compare\.$/);
  });
});
