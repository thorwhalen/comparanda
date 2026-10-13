/**
 * The detail panel (#94, ADR-0027): a non-modal complementary landmark beside
 * the grid, opened by Enter or a click, following the grid's position, and
 * carrying every piece of a cell's record -- assertions, justifications,
 * absence reasons and notes, focusable evidence links -- so nothing is
 * reachable only by hover.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from '@vitest/browser/context';

import { Analysis, vocabularyOf } from '../../src/core/schema/analysis.js';
import { cellDetail } from '../../src/core/detail.js';
import { initialViewState, setDetailPanel, setFilter, setFocus, type ViewState } from '../../src/core/view-state.js';
import { mountMatrix, type MatrixHandle, type MountMatrixProps } from '../../src/view/index.js';
import relocationJson from '../../examples/relocation.json';

const relocation = Analysis.parse(relocationJson);

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
  document.documentElement.removeAttribute('data-theme');
});

const panel = () => el.querySelector<HTMLElement>('aside.comparanda-panel');
const heading = () => panel()!.querySelector<HTMLElement>('[data-panel-heading]')!;
const cellOf = (alt: string, crit: string) => {
  const r = relocation.alternatives.findIndex((a) => a.id === alt) + 1;
  const c = relocation.criteria.findIndex((x) => x.id === crit) + 1;
  return el.querySelector<HTMLElement>(`[data-cell="${r}:${c}"]`)!;
};
const label = (alt: string, crit: string) =>
  `${relocation.criteria.find((x) => x.id === crit)!.label}, ${relocation.alternatives.find((x) => x.id === alt)!.label}`;

describe('opening and closing', () => {
  it('Enter opens a labelled, non-modal complementary panel and moves focus to its heading', async () => {
    const views: ViewState[] = [];
    mount({ analysis: relocation, measure: 'score', onViewChange: (v) => views.push(v) });
    expect(panel()).toBeNull();
    cellOf('berlin', 'rent').focus();
    await userEvent.keyboard('{Enter}');
    const aside = panel()!;
    expect(aside.getAttribute('role')).toBe('complementary');
    expect(aside.closest('[role="dialog"], [aria-modal]')).toBeNull();
    const labelledBy = document.getElementById(aside.getAttribute('aria-labelledby')!)!;
    expect(labelledBy.textContent).toContain(label('berlin', 'rent'));
    expect(document.activeElement).toBe(heading());
    expect(views.at(-1)?.session.detailPanelOpen).toBe(true);
    // The grid is still there, and still one tab stop.
    expect(el.querySelectorAll('[role="grid"] [tabindex="0"]')).toHaveLength(1);
  });

  it('Escape in the panel returns to the cell it describes and leaves it open', async () => {
    mount({ analysis: relocation, measure: 'score' });
    cellOf('berlin', 'rent').focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('{Escape}');
    expect(document.activeElement).toBe(cellOf('berlin', 'rent'));
    expect(panel()).not.toBeNull();
    // Escape in the grid closes it.
    await userEvent.keyboard('{Escape}');
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(cellOf('berlin', 'rent'));
  });

  it('the close button closes it and puts focus back on the cell', async () => {
    mount({ analysis: relocation, measure: 'score' });
    cellOf('lisbon', 'rent').focus();
    await userEvent.keyboard('{Enter}');
    panel()!.querySelector<HTMLButtonElement>('.comparanda-panel-close')!.focus();
    await userEvent.keyboard('{Enter}');
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(cellOf('lisbon', 'rent'));
  });

  it('a click on a cell opens it and leaves focus on the cell', async () => {
    mount({ analysis: relocation, measure: 'score' });
    await userEvent.click(cellOf('seoul', 'rent'));
    expect(panel()).not.toBeNull();
    expect(document.activeElement).toBe(cellOf('seoul', 'rent'));
    expect(heading().textContent).toContain(label('seoul', 'rent'));
  });

  it('follows the grid position while open, and a view that says it is open restores it', async () => {
    const view = setDetailPanel(setFocus(initialViewState(relocation), { alternativeId: 'berlin', criterionId: 'rent' }), true);
    mount({ analysis: relocation, measure: 'score', view });
    expect(heading().textContent).toContain(label('berlin', 'rent'));
    cellOf('berlin', 'rent').focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(heading().textContent).toContain(label('berlin', relocation.criteria[1]!.id));
  });
});

describe('review findings', () => {
  it('a host that keeps only focus does not close the panel the reader opened', async () => {
    const base = initialViewState(relocation);
    const handle = mount({ analysis: relocation, measure: 'score', view: base, onViewChange: (v) => handle.update({ view: setFocus(base, v.session.focus) }) });
    cellOf('berlin', 'rent').focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('{Escape}');
    await userEvent.keyboard('{ArrowRight}');
    expect(panel()).not.toBeNull();
    // A host that says something new about the panel is obeyed, as with focus.
    handle.update({ view: setDetailPanel(base, true) });
    expect(panel()).not.toBeNull();
    handle.update({ view: base });
    expect(panel()).toBeNull();
  });

  it('describes where the grid stop is, not a hidden id', () => {
    const open = setDetailPanel(setFocus(initialViewState(relocation), { alternativeId: 'berlin', criterionId: 'rent' }), true);
    const handle = mount({ analysis: relocation, measure: 'score', view: open });
    handle.update({ view: setFilter(open, { hiddenAlternatives: ['berlin'] }) });
    expect(panel()!.getAttribute('data-panel')).not.toBe('cell');
    expect(heading().textContent).toContain('Rent');
    expect(heading().textContent).not.toContain('Berlin');
  });

  it('never a bare check verdict, even with no standing given', () => {
    mount({ analysis: relocation, measure: 'score', view: setDetailPanel(setFocus(initialViewState(relocation), { alternativeId: 'berlin', criterionId: 'winter-daylight' }), true) });
    for (const check of Array.from(panel()!.querySelectorAll('.comparanda-check'))) {
      if (/Quote check:/.test(check.textContent!)) expect(check.textContent).toMatch(/not assessed|checker/);
    }
  });

  it('the bar draws counts in proportion, whatever the labels', () => {
    mount({ analysis: relocation, measure: 'score', view: setDetailPanel(setFocus(initialViewState(relocation), { alternativeId: 'berlin', criterionId: 'winter-daylight' }), true) });
    const [two, one] = Array.from(panel()!.querySelectorAll<HTMLElement>('.comparanda-bar span')).map((s) => s.getBoundingClientRect().width);
    expect(two! / one!).toBeCloseTo(2, 1);
  });

  it('a render that throws on opening changes nothing, and a later fix shows the panel', async () => {
    const handle = mount({ analysis: relocation, measure: 'score', standing: () => { throw new Error('boom'); } });
    cellOf('berlin', 'rent').focus();
    const errors: unknown[] = [];
    const onError = (e: ErrorEvent) => { errors.push(e.error); e.preventDefault(); };
    window.addEventListener('error', onError);
    try { await userEvent.keyboard('{Enter}'); } catch (e) { errors.push(e); }
    window.removeEventListener('error', onError);
    expect(panel()).toBeNull();
    expect(el.querySelector('[role="grid"]')).not.toBeNull();
    handle.update({ standing: undefined });
    expect(panel()).toBeNull();
    cellOf('berlin', 'rent').focus();
    await userEvent.keyboard('{Enter}');
    expect(panel()).not.toBeNull();
  });

  it('a superseded assertion says so in words', () => {
    mount({ analysis: relocation, measure: 'score', view: setDetailPanel(setFocus(initialViewState(relocation), { alternativeId: 'seoul', criterionId: 'school-quality' }), true) });
    const old = panel()!.querySelector('[data-superseded="true"]')!;
    expect(old.textContent).toMatch(/^Superseded by /);
  });
});

describe('what it carries', () => {
  /** Every word a cell's record holds that the matrix cell itself does not show. */
  const recordOf = (alt: string, crit: string) => {
    const d = cellDetail(relocation, alt, crit, 'score', { vocabulary: vocabularyOf(relocation) });
    return [
      ...d.assertions.flatMap((x) => [x.assertion.justification, x.absence?.note, x.author?.displayName]),
      ...d.assertions.flatMap((x) => x.evidence.flatMap((e) => [e.label, e.ref.excerpt])),
      d.absence?.note,
    ].filter((t): t is string => typeof t === 'string' && t.length > 0);
  };

  it('every cell of the messy fixture: all its justifications, notes, authors and evidence', () => {
    const handle = mount({ analysis: relocation, measure: 'score' });
    for (const alt of relocation.alternatives) {
      for (const crit of relocation.criteria) {
        handle.update({ view: setDetailPanel(setFocus(initialViewState(relocation), { alternativeId: alt.id, criterionId: crit.id }), true) });
        const text = panel()!.textContent!.replace(/\s+/g, ' ');
        for (const piece of recordOf(alt.id, crit.id)) expect(text, `${alt.id}/${crit.id}`).toContain(piece.replace(/\s+/g, ' '));
        // Never a bare blank: the panel always says what the cell shows.
        expect(panel()!.querySelector('[data-detail="shows"]')!.textContent!.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('evidence links are reachable by Tab from the heading', async () => {
    mount({ analysis: relocation, measure: 'score' });
    cellOf('berlin', 'rent').focus();
    await userEvent.keyboard('{Enter}');
    const links = Array.from(panel()!.querySelectorAll<HTMLAnchorElement>('a[href]'));
    const reached: Element[] = [];
    for (let i = 0; i < links.length + 1; i += 1) {
      await userEvent.tab();
      reached.push(document.activeElement!);
    }
    for (const link of links) expect(reached).toContain(link);
  });

  it('several values: the set described and the levels counted in words', () => {
    mount({ analysis: relocation, measure: 'score', view: setDetailPanel(setFocus(initialViewState(relocation), { alternativeId: 'berlin', criterionId: 'winter-daylight' }), true) });
    const dist = panel()!.querySelector('[data-detail="distribution"]')!;
    expect(dist.querySelector('figcaption')!.textContent).toMatch(/3 values by level, lowest first: 1: 2; 3: 1\./);
    expect(dist.querySelector('.comparanda-bar')!.getAttribute('aria-hidden')).toBe('true');
    expect(panel()!.querySelector('[data-detail="set"]')!.textContent).toMatch(/3/);
  });

  it("an alternative's header names its strongest and weakest criteria", () => {
    mount({ analysis: relocation, measure: 'score', view: setDetailPanel(setFocus(initialViewState(relocation), { alternativeId: 'lisbon' }), true) });
    expect(panel()!.getAttribute('data-panel')).toBe(relocation.aliases?.alternative ?? 'option');
    const standing = panel()!.querySelector('[data-detail="standing"]')!;
    expect(standing.textContent).toMatch(/Strongest|stands out/);
  });

  it("a criterion's header gives its scale and definition", () => {
    mount({ analysis: relocation, measure: 'score', view: setDetailPanel(setFocus(initialViewState(relocation), { criterionId: 'income-tax' }), true) });
    expect(panel()!.textContent).toMatch(/Ordinal, preference increasing, from 1 to 5/);
    expect(panel()!.textContent).toContain('effective rate below 20%');
  });
});

/** WCAG 2 relative luminance of a computed colour. */
function luminance(css: string): number {
  const [r, g, b] = css.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function backgroundOf(node: Element): string {
  for (let n: Element | null = node; n; n = n.parentElement) {
    const bg = getComputedStyle(n).backgroundColor;
    if (!/^rgba\(.*,\s*0\)$/.test(bg) && bg !== 'transparent') return bg;
  }
  return 'rgb(255, 255, 255)';
}

describe('contrast', () => {
  it.each(['light', 'dark'])('every text in the panel clears 4.5:1 against what is behind it (%s)', (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    mount({ analysis: relocation, measure: 'score', view: setDetailPanel(setFocus(initialViewState(relocation), { alternativeId: 'berlin', criterionId: 'winter-daylight' }), true) });
    const texts = Array.from(panel()!.querySelectorAll<HTMLElement>('*')).filter((n) =>
      Array.from(n.childNodes).some((c) => c.nodeType === Node.TEXT_NODE && c.textContent!.trim()));
    expect(texts.length).toBeGreaterThan(5);
    for (const n of texts) {
      const [hi, lo] = [luminance(getComputedStyle(n).color), luminance(backgroundOf(n))].sort((x, y) => y - x);
      expect((hi! + 0.05) / (lo! + 0.05), n.outerHTML.slice(0, 80)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
