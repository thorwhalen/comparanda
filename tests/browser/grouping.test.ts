/**
 * Grouping in the matrix (#93): the reader bands an axis by its groups with a
 * control, and once both axes are banded a block whose every cell is declared
 * structurally inapplicable is drawn as one cell saying why, never as a
 * rectangle of the same blank. The keyboard treats that cell as one stop.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from '@vitest/browser/context';

import { Analysis } from '../../src/core/schema/analysis.js';
import { startThread } from '../../src/core/threads.js';
import { initialViewState, setEncoding, setFocus, setGrouping, transpose, type ViewState } from '../../src/core/view-state.js';
import { inMemoryAnalysisSource } from '../../src/store/index.js';
import { createEncodingRegistry, mountMatrix, SHIPPED_ENCODINGS, type MatrixHandle, type MountMatrixProps } from '../../src/view/index.js';
import relocationJson from '../../examples/relocation.json';

const relocation = Analysis.parse(relocationJson);
const REASON = 'not an EU destination, so EU residency rules do not apply';

let el: HTMLElement;
const handles: MatrixHandle[] = [];
const mount = (props: MountMatrixProps, encodings = createEncodingRegistry(SHIPPED_ENCODINGS)) => {
  const handle = mountMatrix(el, props, { encodings });
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

const both = (v: ViewState = initialViewState(relocation)) =>
  setGrouping(setGrouping(v, 'alternatives', ['g-europe', 'g-asia', 'g-americas']), 'criteria', ['g-cost', 'g-climate', 'g-logistics', 'g-eu']);
const toggle = (name: RegExp) => el.querySelector<HTMLInputElement>(`.comparanda-grouping input[data-axis="${/options/.test(name.source) ? 'alternatives' : 'criteria'}"]`)!;
const button = (name: RegExp) => Array.from(el.querySelectorAll<HTMLButtonElement>('.comparanda-grouping button')).find((b) => name.test(b.textContent!))!;
const pick = (axis: 'alternatives' | 'criteria') => el.querySelector<HTMLSelectElement>(`.comparanda-grouping select[id$="-g-${axis}"]`)!;
const selectedHeaders = () => Array.from(el.querySelectorAll('th[aria-selected="true"]'), (th) => th.getAttribute('data-entry'));
const shownRows = () => Array.from(el.querySelectorAll('th[data-axis="alternatives"][data-entry]'), (th) => th.getAttribute('data-entry'));
const said = () => el.querySelector('[data-announce]')!.textContent!.trim();
const blockCells = () => el.querySelectorAll<HTMLTableCellElement>('td[data-block]');

describe('the grouping control', () => {
  it('bands each axis by its top-level groups, says so, reports the view, and leaves the document alone', async () => {
    const source = inMemoryAnalysisSource(relocation);
    const views: ViewState[] = [];
    mount({ analysis: relocation, measure: 'score', source, onViewChange: (v) => views.push(v) });
    expect(el.querySelectorAll('tbody[data-group]')).toHaveLength(0);

    await userEvent.click(toggle(/options/i));
    expect(Array.from(el.querySelectorAll('tbody[data-group]'), (b) => b.getAttribute('data-group'))).toEqual(['g-europe', 'g-asia', 'g-americas']);
    expect(said()).toMatch(/^Showing the options in their groups: Europe/);
    expect(views.at(-1)!.grouping.alternatives).toEqual(['g-europe', 'g-asia', 'g-americas']);

    await userEvent.click(toggle(/criteria/i));
    // A tombstoned group is not offered as a band.
    expect(views.at(-1)!.grouping.criteria).toEqual(['g-cost', 'g-climate', 'g-logistics', 'g-eu']);

    await userEvent.click(toggle(/options/i));
    expect(el.querySelectorAll('tbody[data-group]')).toHaveLength(0);
    expect(said()).toBe('Showing the options ungrouped.');
    // Grouping is the reader's: nothing about it reaches the analysis (ADR-0008).
    expect(await source.getOne(relocation.id)).toEqual(relocation);
  });

  it('is not offered on an axis with no groups', () => {
    const plain = Analysis.parse({ ...relocationJson, groups: [], inapplicable: [], alternatives: relocationJson.alternatives.map((a) => ({ ...a, groupIds: [] })), criteria: relocationJson.criteria.map((c) => ({ ...c, groupIds: [] })) });
    mount({ analysis: plain, measure: 'score' });
    expect(el.querySelector('.comparanda-grouping')).toBeNull();
  });

  it('yields to a host that gives a new grouping, and keeps the reader\'s against the same view passed again', async () => {
    const view = initialViewState(relocation);
    const handle = mount({ analysis: relocation, measure: 'score', view });
    await userEvent.click(toggle(/options/i));
    handle.update({ view });
    expect(el.querySelectorAll('tbody[data-group]')).toHaveLength(3);
    handle.update({ view: setGrouping(view, 'alternatives', ['g-asia']) });
    expect(Array.from(el.querySelectorAll('tbody[data-group]'), (b) => b.getAttribute('data-group'))).toEqual(['g-asia']);
  });

  it('shows the box unchecked when the view names only groups this document lacks', () => {
    mount({ analysis: relocation, measure: 'score', view: setGrouping(initialViewState(relocation), 'alternatives', ['g-gone']) });
    expect(toggle(/options/i).checked).toBe(false);
  });
});

describe('an inapplicable block is omitted, not blank-filled', () => {
  it('draws a wholly inapplicable block as one cell spanning it, with its bands, its size and its reason', () => {
    mount({ analysis: relocation, measure: 'score', view: both() });
    const [block, ...rest] = Array.from(blockCells());
    // Asia x EU: Taipei and Seoul on the EU residency path. Montreal records its own absence there, so its block is drawn cell by cell.
    expect(rest).toHaveLength(0);
    expect([block!.rowSpan, block!.colSpan, block!.getAttribute('data-block')]).toEqual([2, 1, '2']);
    expect(block!.textContent).toContain(`All 2 cells: ${REASON}.`);
    // Its standing is said, as on any absent cell.
    expect(block!.textContent).toContain('Nothing to record here.');
    expect(block!.querySelector('.comparanda-sr')!.textContent).toMatch(/^EU\b.*, Asia\b.*, $/);
    expect(block!.getAttribute('data-state')).toBe('not-applicable');
    // Matched by attribute value: a NUL in a selector string matches nothing at all.
    const pairs = Array.from(el.querySelectorAll('td[data-pair]'), (td) => td.getAttribute('data-pair'));
    expect(pairs).not.toContain('taipei\u0000eu-residency-path');
    expect(pairs).not.toContain('seoul\u0000eu-residency-path');
    expect(pairs).toContain('montreal\u0000eu-residency-path');
    // The table stays rectangular: Taipei's row carries the block, Seoul's leaves its column to the span above.
    const width = relocation.criteria.filter((c) => !c.tombstoned).length;
    const cellsIn = (alt: string) => Array.from(el.querySelector(`th[data-entry="${alt}"]`)!.closest('tr')!.querySelectorAll('td'))
      .reduce((n, td) => n + td.colSpan, 0);
    expect([cellsIn('taipei'), cellsIn('seoul'), cellsIn('montreal')]).toEqual([width, width - 1, width]);
  });

  it('is painted as its cells would be: under the missingness encoding, the swatch of a not-applicable cell', () => {
    mount({ analysis: relocation, measure: 'score', view: setEncoding(both(), 'missingness') });
    const montreal = Array.from(el.querySelectorAll('td[data-pair]')).find((td) => td.getAttribute('data-pair') === 'montreal\u0000eu-residency-path')!;
    expect(blockCells()[0]!.getAttribute('data-swatch')).toBeTruthy();
    expect(blockCells()[0]!.getAttribute('data-swatch')).toBe(montreal.getAttribute('data-swatch'));
  });

  it('says what the encoding says of its cells, and is not drawn where a cell carries a mark of its own (the datum)', () => {
    // The datum is the first alternative shown. Europe first: Lisbon, outside the block, is the datum.
    mount({ analysis: relocation, measure: 'score', view: setEncoding(both(), 'datum') });
    expect(blockCells()[0]!.textContent).toMatch(/Not comparable with Lisbon\./);
    handles.splice(0).forEach((h) => h.destroy());
    // Asia first: Taipei is the datum, its cells carry the datum's badge, so the Asia block is drawn cell by cell.
    mount({ analysis: relocation, measure: 'score', view: setEncoding(setGrouping(both(), 'alternatives', ['g-asia', 'g-europe']), 'datum') });
    expect(blockCells()).toHaveLength(0);
  });

  it('keeps a block drawn cell by cell when one of its cells has a thread', () => {
    const discussed = startThread(relocation, {
      threadId: 't-eu', anchor: { scope: 'cell', alternativeId: 'seoul', criterionId: 'eu-residency-path', measure: 'score' },
      comment: { id: 'c', at: '2026-10-27', body: 'is a Korean residency path worth a column?', author: { id: 'dana', displayName: 'Dana', kind: 'human' } },
    });
    mount({ analysis: discussed, measure: 'score', view: both() });
    expect(blockCells()).toHaveLength(0);
  });

  it('is not omitted unless both axes are banded, and is read the same transposed', () => {
    mount({ analysis: relocation, measure: 'score', view: setGrouping(initialViewState(relocation), 'alternatives', ['g-asia']) });
    expect(blockCells()).toHaveLength(0);
    handles.splice(0).forEach((h) => h.destroy());
    mount({ analysis: relocation, measure: 'score', view: transpose(both()) });
    expect(Array.from(blockCells(), (b) => [b.rowSpan, b.colSpan])).toEqual([[1, 2]]);
  });

  it('transposed, the arrows go into a two-wide block at its first cell and leave from its far side', async () => {
    mount({ analysis: relocation, measure: 'score', view: setFocus(transpose(both()), { alternativeId: 'berlin', criterionId: 'eu-residency-path' }) });
    const block = blockCells()[0]!;
    el.querySelector<HTMLElement>('[role="grid"] [tabindex="0"]')!.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(block);
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement!.getAttribute('data-pair')).toBe('montreal\u0000eu-residency-path');
    await userEvent.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(block);
    await userEvent.keyboard('{ArrowLeft}');
    expect(document.activeElement!.getAttribute('data-pair')).toBe('berlin\u0000eu-residency-path');
  });

  it('is one stop for the keyboard: arrows go in at its first cell and leave from its far edge', async () => {
    // Focus on Taipei's cell to the left of the block (school quality), then into the block and out past it.
    const view = setFocus(both(), { alternativeId: 'taipei', criterionId: 'school-quality' });
    mount({ analysis: relocation, measure: 'score', view });
    const block = blockCells()[0]!;
    el.querySelector<HTMLElement>('[role="grid"] [tabindex="0"]')!.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(block);
    // Down leaves from its last row (Seoul) to the next row, Montreal.
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement!.getAttribute('data-pair')).toBe('montreal\u0000eu-residency-path');
    // Up from Montreal goes into the block, at its first position.
    await userEvent.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(block);
    // A host focus on any cell inside the block lands on the block.
    handles[0]!.update({ view: setFocus(both(), { alternativeId: 'seoul', criterionId: 'eu-residency-path' }) });
    expect(block.getAttribute('tabindex')).toBe('0');
    expect(el.querySelectorAll('[role="grid"] [tabindex="0"]')).toHaveLength(1);
  });
});

describe('selection and filter by group (#93)', () => {
  it('selects a group\'s members in one click: marked on their headers, said, reported, and the document untouched', async () => {
    const source = inMemoryAnalysisSource(relocation);
    const views: ViewState[] = [];
    mount({ analysis: relocation, measure: 'score', source, onViewChange: (v) => views.push(v) });
    await userEvent.selectOptions(pick('alternatives'), 'g-asia');
    await userEvent.click(button(/Select its options/));
    expect(selectedHeaders()).toEqual(['taipei', 'seoul']);
    // Unselected headers say nothing about it: no "not selected" on every header.
    expect(el.querySelector('th[aria-selected="false"]')).toBeNull();
    // A tick, not a colour: the mark survives forced colours and print.
    // Its alternative text is empty, so it is not read into the header's name.
    expect(getComputedStyle(el.querySelector('th[aria-selected="true"]')!, '::before').content).toMatch(/\u2713.*\/ ""/);
    expect(said()).toBe('Selected the 2 options in Asia.');
    expect(views.at(-1)!.selection.alternatives).toEqual(['taipei', 'seoul']);
    // Selection is view state; the bridge never writes the group into it, nor anything into the analysis (ADR-0008).
    expect(await source.getOne(relocation.id)).toEqual(relocation);

    await userEvent.click(button(/Clear the selection \(2\)/));
    expect(selectedHeaders()).toEqual([]);
    expect(said()).toBe('Nothing is selected now.');
  });

  it('hides a group\'s members and shows them again', async () => {
    mount({ analysis: relocation, measure: 'score' });
    await userEvent.selectOptions(pick('alternatives'), 'g-europe');
    await userEvent.click(button(/Hide its options/));
    expect(shownRows()).toEqual(['taipei', 'seoul', 'montreal']);
    expect(said()).toBe('Hid the options in Europe.');
    await userEvent.click(button(/Show the 2 hidden/));
    expect(shownRows()).toEqual(['lisbon', 'berlin', 'taipei', 'seoul', 'montreal']);
  });

  it('each part and each axis keeps the others: group then select, two hides, both axes, with no host echoing them', async () => {
    const views: ViewState[] = [];
    mount({ analysis: relocation, measure: 'score', onViewChange: (v) => views.push(v) });
    await userEvent.click(toggle(/options/i));
    await userEvent.selectOptions(pick('alternatives'), 'g-asia');
    await userEvent.click(button(/Select its options/));
    await userEvent.selectOptions(pick('criteria'), 'g-cost');
    await userEvent.click(button(/Select its criteria/));
    await userEvent.click(button(/Hide its criteria/));
    await userEvent.selectOptions(pick('criteria'), 'g-climate');
    await userEvent.click(button(/Hide its criteria/));
    await userEvent.selectOptions(pick('alternatives'), 'g-americas');
    await userEvent.click(button(/Hide its options/));
    const last = views.at(-1)!;
    expect(last.grouping.alternatives).toEqual(['g-europe', 'g-asia', 'g-americas']);
    expect(last.selection).toMatchObject({ alternatives: ['taipei', 'seoul'], criteria: ['rent', 'income-tax'] });
    expect(last.filter).toEqual({ hiddenAlternatives: ['montreal'], hiddenCriteria: ['rent', 'income-tax', 'climate-type', 'winter-daylight'] });
    await userEvent.click(button(/Show the 5 hidden/));
    expect(views.at(-1)!.filter).toEqual({ hiddenAlternatives: [], hiddenCriteria: [] });
  });

  it('yields per part: a host that changes only the selection keeps the reader\'s grouping', async () => {
    const view = initialViewState(relocation);
    const handle = mount({ analysis: relocation, measure: 'score', view });
    await userEvent.click(toggle(/options/i));
    handle.update({ view: { ...view, selection: { alternatives: ['lisbon'], criteria: [], cells: [] } } });
    expect(el.querySelectorAll('tbody[data-group]')).toHaveLength(3);
    expect(selectedHeaders()).toEqual(['lisbon']);
  });

  it('takes members by closure, and counts only what the document holds alive', async () => {
    // Lisbon moved into a sub-group of Europe; Berlin tombstoned; the host's view names ids the document lacks.
    const doc = structuredClone(relocationJson);
    doc.groups.push({ id: 'g-iberia', axis: 'alternatives', label: 'Iberia', parentId: 'g-europe' } as (typeof doc.groups)[number]);
    for (const a of doc.alternatives) {
      if (a.id === 'lisbon') a.groupIds = ['g-iberia'];
      if (a.id === 'berlin') (a as { tombstoned?: boolean }).tombstoned = true;
    }
    const nested = Analysis.parse(doc);
    const view = { ...initialViewState(nested), filter: { hiddenAlternatives: ['ghost'], hiddenCriteria: [] }, selection: { alternatives: ['ghost2'], criteria: [], cells: [] } };
    mount({ analysis: nested, measure: 'score', view });
    // Nothing alive is hidden or selected, so neither undo is offered.
    expect(el.querySelectorAll('.comparanda-grouping p:not(:has(select)) button')).toHaveLength(0);
    await userEvent.click(button(/Select its options/));
    expect(selectedHeaders()).toEqual(['lisbon']);
    expect(said()).toBe('Selected the 1 options in Europe.');
    expect(button(/Clear the selection \(1\)/)).toBeDefined();
  });

  it('clears the headers\' selection only, leaving a host\'s cell selection', async () => {
    const cells = [{ alternativeId: 'lisbon', criterionId: 'rent' }];
    const views: ViewState[] = [];
    const view = { ...initialViewState(relocation), selection: { alternatives: ['lisbon'], criteria: [], cells } };
    mount({ analysis: relocation, measure: 'score', view, onViewChange: (v) => views.push(v) });
    await userEvent.click(button(/Clear the selection/));
    expect(views.at(-1)!.selection).toEqual({ alternatives: [], criteria: [], cells });
  });

  it('every control is a native, labelled form control the keyboard reaches outside the grid\'s one stop', () => {
    mount({ analysis: relocation, measure: 'score' });
    const controls = Array.from(el.querySelectorAll<HTMLElement>('.comparanda-grouping input, .comparanda-grouping select, .comparanda-grouping button'));
    expect(controls.length).toBeGreaterThan(0);
    for (const c of controls) {
      expect(c.tabIndex).toBe(0);
      expect(c.closest('[role="grid"]')).toBeNull();
    }
    // Several headers may be selected at once, and the grid says so.
    expect(el.querySelector('[role="grid"]')!.getAttribute('aria-multiselectable')).toBe('true');
    expect(el.querySelector(`label[for="${pick('criteria').id}"]`)!.textContent).toBe('Group of criteria');
  });
});
