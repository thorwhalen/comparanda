/**
 * The matrix component (#89): the messy fixture renders completely, in both
 * themes and both orientations, with no cell an ambiguous blank; group bands;
 * and every write the view would offer gated on `editAffordances`, refused
 * with its reason over a source that refuses updates.
 *
 * In a real browser because themes and contrast are about rendered colours.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Analysis, vocabularyOf } from '../../src/core/schema/analysis.js';
import { initialViewState, setGrouping, transpose, type ViewState } from '../../src/core/view-state.js';
import { WRITE_AFFORDANCES } from '../../src/core/affordances.js';
import { editAffordances, inMemoryAnalysisSource } from '../../src/store/index.js';
import { mountMatrix, type MatrixHandle, type MountMatrixProps } from '../../src/view/index.js';
import relocationJson from '../../examples/relocation.json';

const relocation = Analysis.parse(relocationJson);
const alternatives = relocation.alternatives.length;
const criteria = relocation.criteria.length;

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

/** WCAG 2 relative luminance of an `rgb()`/`rgba()` computed colour, with the sRGB curve, not a lightness threshold. */
function luminance(css: string): number {
  const [r, g, b] = css.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function contrast(fg: string, bg: string): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** The colour actually behind an element: its own, or the nearest painted ancestor's. */
function backgroundOf(node: Element): string {
  for (let n: Element | null = node; n; n = n.parentElement) {
    const bg = getComputedStyle(n).backgroundColor;
    if (!/^rgba\(.*,\s*0\)$/.test(bg) && bg !== 'transparent') return bg;
  }
  return 'rgb(255, 255, 255)';
}

const table = () => el.querySelector('table')!;
const dataCells = () => Array.from(table().querySelectorAll('tbody td'));

describe('the messy fixture, both themes, both orientations', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const transposed of [false, true]) {
      it(`${theme}, ${transposed ? 'transposed' : 'standard'}: every cell says something, legibly`, () => {
        el.dataset.theme = theme;
        const view = transposed ? transpose(initialViewState(relocation)) : initialViewState(relocation);
        mount({ analysis: relocation, measure: 'score', view });
        const [rows, cols] = transposed ? [criteria, alternatives] : [alternatives, criteria];
        expect(el.querySelector('.comparanda-matrix')!.getAttribute('data-orientation'))
          .toBe(transposed ? 'transposed' : 'standard');
        expect(table().querySelectorAll('thead th[scope="col"]')).toHaveLength(cols + 1);
        expect(table().querySelectorAll('tbody th[scope="row"]')).toHaveLength(rows);
        const cells = dataCells();
        expect(cells).toHaveLength(rows * cols);
        for (const td of cells) {
          expect(td.textContent!.trim()).not.toBe('');
          expect(td.getAttribute('data-state')).toMatch(/^(value|missing|not-applicable|not-assessed|refused)$/);
        }
        // Measured from what was painted, in this theme: every header and cell.
        const text = el.querySelectorAll('th, td, caption, .comparanda-also, .comparanda-edits button, .comparanda-reason');
        expect(el.querySelectorAll('.comparanda-reason').length).toBeGreaterThan(0);
        for (const node of Array.from(text)) {
          expect(contrast(getComputedStyle(node).color, backgroundOf(node)), node.textContent!).toBeGreaterThanOrEqual(4.5);
        }
      });
    }
  }

  it('the themes really differ, so the contrast test above measured two palettes', () => {
    el.dataset.theme = 'light';
    mount({ analysis: relocation, measure: 'score' });
    const light = getComputedStyle(table().querySelector('td')!).backgroundColor;
    el.dataset.theme = 'dark';
    const dark = getComputedStyle(table().querySelector('td')!).backgroundColor;
    expect(luminance(light)).toBeGreaterThan(0.8);
    expect(luminance(dark)).toBeLessThan(0.05);
  });

  it('the theme is the mount element\'s, whatever an outer element says', () => {
    const outer = document.createElement('div');
    outer.dataset.theme = 'dark';
    document.body.append(outer);
    outer.append(el);
    el.dataset.theme = 'light';
    mount({ analysis: relocation, measure: 'score' });
    expect(luminance(getComputedStyle(table().querySelector('td')!).backgroundColor)).toBeGreaterThan(0.8);
    outer.remove();
  });

  it('falls back to a theme on <html> when the mount element names none', () => {
    document.documentElement.dataset.theme = 'dark';
    try {
      mount({ analysis: relocation, measure: 'score' });
      expect(luminance(getComputedStyle(table().querySelector('td')!).backgroundColor)).toBeLessThan(0.05);
      el.dataset.theme = 'light';
      expect(luminance(getComputedStyle(table().querySelector('td')!).backgroundColor)).toBeGreaterThan(0.8);
    } finally {
      delete document.documentElement.dataset.theme;
    }
  });

  it('says so when every criterion is hidden, rather than drawing an empty table', () => {
    const v = initialViewState(relocation);
    mount({ analysis: relocation, measure: 'score', view: { ...v, filter: { hiddenAlternatives: [], hiddenCriteria: relocation.criteria.map((c) => c.id) } } });
    expect(el.querySelector('.comparanda-empty')!.textContent).toMatch(/^No .* are shown/);
    expect(dataCells()).toHaveLength(0);
  });

  it('transposing shows the same cell under the swapped headers', () => {
    const handle = mount({ analysis: relocation, measure: 'score' });
    const at = (row: string, col: string) => {
      const r = Array.from(table().querySelectorAll('tbody tr')).find((tr) => tr.querySelector('th')?.textContent === row)!;
      const heads = Array.from(table().querySelectorAll('thead th')).map((th) => th.textContent);
      return r.children[heads.indexOf(col)]!.textContent;
    };
    const [alt, crit] = [relocation.alternatives[2]!, relocation.criteria[4]!];
    const before = at(alt.label, crit.label);
    handle.update({ view: transpose(initialViewState(relocation)) });
    expect(at(crit.label, alt.label)).toBe(before);
  });

  it('an inapplicable block reads as not applicable, and a gap as not assessed, without colour', () => {
    mount({ analysis: relocation, measure: 'score' });
    const vocab = vocabularyOf(relocation);
    const states = new Set(dataCells().map((td) => td.getAttribute('data-state')));
    expect(states).toContain('not-applicable');
    const na = dataCells().find((td) => td.getAttribute('data-state') === 'not-applicable')!;
    expect(na.querySelector('.comparanda-shown')!.textContent).toBe(vocab.means('not-applicable', 'eu-residency-path') ?? 'not-applicable');
    // A shape, not only a colour: each carries its own glyph, in the foreground.
    expect(na.querySelector('svg.comparanda-glyph')!.getAttribute('data-glyph')).toBe('not-applicable');
    const gap = dataCells().find((td) => td.getAttribute('data-state') === 'not-assessed')!;
    expect(gap.querySelector('svg.comparanda-glyph')!.getAttribute('data-glyph')).toBe('not-assessed');
  });

  it('refuses a view state that is not one, by name', () => {
    expect(() => mountMatrix(el, { analysis: relocation, measure: 'score', view: { transposed: true } as unknown as ViewState }))
      .toThrow(/props\.view must be a ViewState/);
  });
});

describe('group bands', () => {
  it('rows: one tbody per chosen group, headed by its label, then the rest, worded', () => {
    const view = setGrouping(initialViewState(relocation), 'alternatives', ['g-asia', 'g-europe']);
    mount({ analysis: relocation, measure: 'score', view });
    const bodies = Array.from(table().querySelectorAll('tbody'));
    expect(bodies.map((b) => b.querySelector('th[scope="rowgroup"]')!.textContent)).toEqual([
      relocation.groups.find((g) => g.id === 'g-asia')!.label,
      relocation.groups.find((g) => g.id === 'g-europe')!.label,
      expect.stringMatching(/^Not in /),
    ]);
    expect(dataCells()).toHaveLength(alternatives * criteria);
  });

  it('columns: a colgroup band row whose spans add up to the criteria', () => {
    const view = setGrouping(initialViewState(relocation), 'criteria', ['g-cost', 'g-climate']);
    mount({ analysis: relocation, measure: 'score', view });
    const bands = Array.from(table().querySelectorAll('thead th[scope="colgroup"]'));
    expect(bands.length).toBe(3);
    expect(bands.reduce((n, th) => n + Number(th.getAttribute('colspan')), 0)).toBe(criteria);
    expect(table().querySelectorAll('colgroup')).toHaveLength(4);
    for (const td of dataCells()) expect(td.textContent!.trim()).not.toBe('');
  });
});

describe('edits are offered only through editAffordances', () => {
  it('over a source that refuses updates, every write control is disabled and shows its reason', () => {
    const source = inMemoryAnalysisSource(relocation, { canUpdate: false });
    mount({ analysis: relocation, measure: 'score', source });
    const affordances = editAffordances(source, relocation);
    const shown = new Map(Array.from(el.querySelectorAll('.comparanda-edits li')).map((li) => [li.getAttribute('data-edit'), li]));
    const keyOf: Record<(typeof WRITE_AFFORDANCES)[number], string> = {
      assert: 'assert', suggest: 'suggest', comment: 'comment', revise: 'revise',
      changeLock: 'change-lock', decideSuggestion: 'decide-suggestion',
    };
    const reasons = {
      assert: affordances.assert('lisbon', 'rent', 'score').reason,
      suggest: affordances.suggest('lisbon', 'rent', 'score').reason,
      comment: affordances.comment().reason,
      revise: affordances.revise('revising the analysis').reason,
      changeLock: affordances.changeLock().reason,
      decideSuggestion: affordances.decideSuggestion('sg-day-tai', 'accept').reason,
    };
    for (const action of WRITE_AFFORDANCES) {
      const li = shown.get(keyOf[action]);
      expect(li, action).toBeTruthy();
      const button = li!.querySelector('button')!;
      expect(button.getAttribute('aria-disabled')).toBe('true');
      const described = document.getElementById(button.getAttribute('aria-describedby')!)!;
      expect(described.textContent!.toLowerCase()).toContain(reasons[action]!.toLowerCase());
    }
  });

  it('without a source, the same: read-only, and says why in words about the matrix', () => {
    mount({ analysis: relocation, measure: 'score' });
    expect(el.querySelectorAll('.comparanda-edits button[aria-disabled="true"]')).toHaveLength(WRITE_AFFORDANCES.length);
    for (const reason of Array.from(el.querySelectorAll('.comparanda-reason'))) {
      expect(reason.textContent).toBe('There is no source behind this matrix, so it does not accept updates; it is read-only.');
    }
  });

  it('asks only the shown cells: a value writable only in a hidden row is refused', () => {
    const source = inMemoryAnalysisSource(relocation);
    const authorize = (r: { action?: string; alternativeId?: string }) => r.action !== 'assert' || r.alternativeId === 'lisbon';
    const handle = mount({ analysis: relocation, measure: 'score', source, authorize: authorize as never });
    const listed = () => Array.from(el.querySelectorAll('.comparanda-edits li')).map((li) => li.getAttribute('data-edit'));
    expect(listed()).not.toContain('assert');
    const v = initialViewState(relocation);
    handle.update({ view: { ...v, filter: { hiddenAlternatives: ['lisbon'], hiddenCriteria: [] } } });
    expect(listed()).toContain('assert');
  });

  it('over a writable source, nothing is refused, so no inert control is shown', () => {
    mount({ analysis: relocation, measure: 'score', source: inMemoryAnalysisSource(relocation) });
    expect(el.querySelector('.comparanda-edits')).toBeNull();
  });

  it('a lock refuses direct values but not suggestions, and the control list follows the document as the source writes', async () => {
    const source = inMemoryAnalysisSource(relocation);
    mount({ analysis: relocation, measure: 'score', source });
    await source.update(relocation.id, { locked: true });
    const edits = Array.from(el.querySelectorAll('.comparanda-edits li')).map((li) => li.getAttribute('data-edit'));
    expect(edits).toEqual(['assert', 'revise']);
    // The lock's reason, once: not every inapplicable cell's own refusal after it.
    const lock = editAffordances(source, { ...relocation, locked: true }).revise('revising the analysis').reason!;
    const assertReason = el.querySelector('.comparanda-edits li[data-edit="assert"] .comparanda-reason')!.textContent!;
    expect(assertReason).not.toMatch(/does not apply/);
    expect(assertReason.toLowerCase()).toContain(lock.split(';')[0]!.toLowerCase().slice(0, 20));
  });
});
