/**
 * Grid semantics (#99, ADR-0027): a real `<table role="grid">`, the whole
 * matrix one tab stop, arrow navigation in both axes with a roving `tabindex`,
 * the position kept in view state by id so it survives a reorder and a reload,
 * and each cell's measures announced through visually-hidden text inside it.
 *
 * Real key presses through Playwright, because the keyboard model is the point.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from '@vitest/browser/context';

import { Analysis } from '../../src/core/schema/analysis.js';
import {
  applyOrder, initialViewState, parseViewState, serializeViewState, setGrouping, transpose, type ViewState,
} from '../../src/core/view-state.js';
import { mountMatrix, type MatrixHandle, type MountMatrixProps } from '../../src/view/index.js';
import languagesJson from '../../examples/languages.json';
import relocationJson from '../../examples/relocation.json';

const languages = Analysis.parse(languagesJson);
const relocation = Analysis.parse(relocationJson);

let el: HTMLElement;
let after: HTMLButtonElement;
const handles: MatrixHandle[] = [];
const mount = (props: MountMatrixProps) => {
  const handle = mountMatrix(el, props);
  handles.push(handle);
  return handle;
};

beforeEach(() => {
  el = document.createElement('div');
  after = document.createElement('button');
  after.textContent = 'after the matrix';
  document.body.append(el, after);
});
afterEach(() => {
  for (const handle of handles.splice(0)) handle.destroy();
  el.remove();
  after.remove();
});

const table = () => el.querySelector('table')!;
const stops = () => Array.from(table().querySelectorAll<HTMLElement>('[tabindex="0"]'));
const active = () => (document.activeElement as HTMLElement | null)?.getAttribute('data-cell');
const cellAt = (pos: string) => table().querySelector<HTMLElement>(`[data-cell="${pos}"]`)!;
/** Every element a Tab press would stop on, in the matrix. */
const tabbable = () => Array.from(el.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]'))
  .filter((n) => n.tabIndex >= 0 && !(n as HTMLButtonElement).disabled);

describe('the grid', () => {
  it('is a real table with role="grid", and the whole grid is one tab stop', () => {
    mount({ analysis: languages, measure: 'score' });
    expect(table().getAttribute('role')).toBe('grid');
    expect(el.querySelector('[role="grid"]')!.tagName).toBe('TABLE');
    const { alternatives, criteria } = languages;
    expect(table().querySelectorAll('[data-cell]')).toHaveLength((alternatives.length + 1) * (criteria.length + 1));
    expect(stops()).toHaveLength(1);
    expect(stops()[0]!.getAttribute('data-cell')).toBe('0:0');
    // Nothing else inside the scroll region takes a tab stop: not the region, not a cell.
    expect(tabbable().filter((n) => el.querySelector('.comparanda-scroll')!.contains(n))).toEqual(stops());
    expect(el.querySelector('[aria-activedescendant]')).toBeNull();
  });

  it('Tab enters on the roving stop and the next Tab leaves the grid', async () => {
    mount({ analysis: languages, measure: 'score' });
    cellAt('2:3').focus();
    expect(stops().map((s) => s.getAttribute('data-cell'))).toEqual(['2:3']);
    await userEvent.tab();
    expect(document.activeElement).toBe(after);
    await userEvent.tab({ shift: true });
    expect(active()).toBe('2:3');
  });

  it('arrows move in both axes; Home/End within the row; Ctrl+Home/End to the corners', async () => {
    mount({ analysis: languages, measure: 'score' });
    const [rows, cols] = [languages.alternatives.length, languages.criteria.length];
    cellAt('0:0').focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(active()).toBe('1:0');
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    expect(active()).toBe('1:2');
    await userEvent.keyboard('{ArrowDown}{ArrowLeft}');
    expect(active()).toBe('2:1');
    await userEvent.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}');
    expect(active()).toBe('0:1'); // stops at the edge
    await userEvent.keyboard('{End}');
    expect(active()).toBe(`0:${cols}`);
    await userEvent.keyboard('{Home}');
    expect(active()).toBe('0:0');
    await userEvent.keyboard('{Control>}{End}{/Control}');
    expect(active()).toBe(`${rows}:${cols}`);
    await userEvent.keyboard('{Control>}{Home}{/Control}');
    expect(active()).toBe('0:0');
    // The tab stop followed every move.
    expect(stops().map((s) => s.getAttribute('data-cell'))).toEqual(['0:0']);
  });

  it('leaves Alt+Arrow to the browser', async () => {
    mount({ analysis: languages, measure: 'score' });
    cellAt('1:1').focus();
    await userEvent.keyboard('{Alt>}{ArrowRight}{/Alt}');
    expect(active()).toBe('1:1');
  });

  it('in a right-to-left page, the arrow that points forward moves forward', async () => {
    el.dir = 'rtl';
    mount({ analysis: languages, measure: 'score' });
    cellAt('1:1').focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(active()).toBe('1:2');
  });

  it('skips group bands, which are labels rather than stops, and works transposed', async () => {
    const grouped = setGrouping(initialViewState(relocation), 'alternatives', ['g-europe', 'g-asia']);
    const handle = mount({ analysis: relocation, measure: 'score', view: grouped });
    cellAt('0:1').focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(active()).toBe('1:1');
    expect(document.activeElement!.closest('tr')!.classList.contains('comparanda-band')).toBe(false);
    handle.update({ view: transpose(grouped) });
    cellAt('0:0').focus();
    await userEvent.keyboard('{ArrowRight}{ArrowDown}');
    expect(active()).toBe('1:1');
  });
});

describe('the roving position', () => {
  it('is reported as view state by id, and survives a reload', async () => {
    const reported: ViewState[] = [];
    const first = mount({ analysis: languages, measure: 'score', onViewChange: (v) => reported.push(v) });
    cellAt('0:0').focus();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowRight}{ArrowRight}{ArrowRight}');
    const last = reported.at(-1)!;
    expect(last.session.focus).toEqual({ alternativeId: languages.alternatives[1]!.id, criterionId: languages.criteria[2]!.id });

    // A reload: the host persisted the string, the page is gone, a new matrix reads it back.
    const saved = serializeViewState(last);
    first.destroy();
    mount({ analysis: languages, measure: 'score', view: parseViewState(saved).state });
    expect(stops().map((s) => s.getAttribute('data-cell'))).toEqual(['2:3']);
    // Restoring the position does not steal focus on load.
    expect(el.contains(document.activeElement)).toBe(false);
  });

  it('stays on the same cell when the order changes under it', async () => {
    const view = initialViewState(languages);
    const handle = mount({ analysis: languages, measure: 'score', view });
    cellAt('1:1').focus();
    const reversed = [...view.alternativeOrder.order].reverse();
    let moved: ViewState | undefined;
    handle.update({ onViewChange: (v) => { moved = v; } });
    await userEvent.keyboard('{ArrowRight}');
    handle.update({ view: applyOrder(moved!, 'alternatives', reversed, { kind: 'manual', by: 'reader' }) });
    const stop = stops()[0]!;
    expect(stop.getAttribute('data-cell')).toBe(`${languages.alternatives.length}:2`);
    expect(stop.closest('tr')!.querySelector('th')!.textContent).toBe(languages.alternatives[0]!.label);
    // The moved row took DOM focus with it, or focus was put back on the stop.
    expect(document.activeElement).toBe(stop);
  });

  it('a host view that says nothing new about focus keeps the reader\'s place; one that does replaces it', async () => {
    const view = initialViewState(languages);
    const handle = mount({ analysis: languages, measure: 'score', view });
    cellAt('2:2').focus();
    // A wrapper re-passing the same view on every render.
    handle.update({ analysis: languages, measure: 'score', view }, { replace: true });
    expect(stops().map((s) => s.getAttribute('data-cell'))).toEqual(['2:2']);
    // A host transposing without listening: same cell, swapped axes, and focus stays in the grid.
    handle.update({ view: transpose(view) });
    expect(stops().map((s) => s.getAttribute('data-cell'))).toEqual(['2:2']);
    expect(document.activeElement).toBe(stops()[0]);
    // A host that places the reader.
    handle.update({ view: { ...view, session: { focus: { criterionId: languages.criteria[0]!.id } } } });
    expect(stops().map((s) => s.getAttribute('data-cell'))).toEqual(['0:1']);
  });

  it('a position naming something no longer shown falls back to that axis\'s header', () => {
    const view = initialViewState(languages);
    const [alt, crit] = [languages.alternatives[1]!.id, languages.criteria[1]!.id];
    const hidden: ViewState = {
      ...view,
      filter: { hiddenAlternatives: [alt], hiddenCriteria: [] },
      session: { focus: { alternativeId: alt, criterionId: crit } },
    };
    mount({ analysis: languages, measure: 'score', view: hidden });
    expect(stops().map((s) => s.getAttribute('data-cell'))).toEqual(['0:2']);
  });
});

describe('what a cell announces', () => {
  it('names the criterion and the alternative in hidden text inside the cell, never an aria-label', () => {
    mount({ analysis: languages, measure: 'score' });
    const td = cellAt('1:1');
    const hidden = Array.from(td.querySelectorAll('.comparanda-sr')).map((s) => s.textContent).join('|');
    expect(hidden.startsWith(`${languages.criteria[0]!.label}, ${languages.alternatives[0]!.label}, `)).toBe(true);
    expect(table().querySelector('[aria-label]')).toBeNull();
    // Hidden from the eye, not from the accessibility tree.
    const sr = td.querySelector<HTMLElement>('.comparanda-sr')!;
    expect(getComputedStyle(sr).display).not.toBe('none');
    expect(sr.getBoundingClientRect().width).toBeLessThanOrEqual(1);
  });

  it('a rating says what it is out of, and a confidence beside it when the analysis records one', () => {
    const withConfidence = Analysis.parse({
      ...languagesJson,
      measures: [{ name: 'score' }, { name: 'confidence' }],
      cells: [
        ...languagesJson.cells,
        ...languagesJson.cells
          .filter((c) => c.measure === 'score')
          .map((c) => ({ ...c, measure: 'confidence', assertions: c.assertions.map((x) => ({ ...x, id: `${x.id}-conf`, value: 'low' })) })),
      ],
    });
    mount({ analysis: withConfidence, measure: 'score' });
    const valued = Array.from(table().querySelectorAll<HTMLElement>('td[data-state="value"]'));
    expect(valued.length).toBeGreaterThan(0);
    const said = valued[0]!.textContent!;
    expect(said).toMatch(/ of 5, confidence low$/);
  });

  it('a missing cell says its reason, never a bare blank', () => {
    mount({ analysis: relocation, measure: 'score' });
    for (const td of Array.from(table().querySelectorAll<HTMLElement>('td:not([data-state="value"])'))) {
      const shown = td.querySelector('.comparanda-shown')!.textContent!.trim();
      expect(shown).not.toBe('');
      expect(shown.toLowerCase()).not.toBe('blank');
    }
  });

  it('carries a visible keyboard help line the grid is described by', () => {
    mount({ analysis: languages, measure: 'score' });
    const help = document.getElementById(table().getAttribute('aria-describedby')!)!;
    expect(help.textContent).toMatch(/Arrow keys/);
    expect(help.getBoundingClientRect().height).toBeGreaterThan(0);
  });
});
