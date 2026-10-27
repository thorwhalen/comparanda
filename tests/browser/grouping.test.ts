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
import { initialViewState, setFocus, setGrouping, transpose, type ViewState } from '../../src/core/view-state.js';
import { inMemoryAnalysisSource } from '../../src/store/index.js';
import { mountMatrix, type MatrixHandle, type MountMatrixProps } from '../../src/view/index.js';
import relocationJson from '../../examples/relocation.json';

const relocation = Analysis.parse(relocationJson);
const REASON = 'not an EU destination, so EU residency rules do not apply';

let el: HTMLElement;
const handles: MatrixHandle[] = [];
const mount = (props: MountMatrixProps) => {
  const handle = mountMatrix(el, props);
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
const toggle = (name: RegExp) => Array.from(el.querySelectorAll<HTMLLabelElement>('.comparanda-grouping label')).find((l) => name.test(l.textContent!))!.querySelector('input')!;
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
    expect(el.querySelector('.comparanda-grouping')!.querySelectorAll('input')).toHaveLength(0);
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
    expect(block!.querySelector('.comparanda-sr')!.textContent).toMatch(/^EU\b.*, Asia\b.*, all 2 cells: $/);
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
