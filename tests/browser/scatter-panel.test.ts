/**
 * The two-criterion scatter panel (#97, ADR-0026): registered like any analysis
 * panel, closed until opened, labelled "non-dominated on these two criteria",
 * its three tiers and the tier overall told apart by shape, and everything in
 * a table as well.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from '@vitest/browser/context';

import { Analysis } from '../../src/core/schema/analysis.js';
import { initialViewState, setFilter } from '../../src/core/view-state.js';
import { mountMatrix, ScatterPanel, type MatrixHandle } from '../../src/view/index.js';
import languagesJson from '../../examples/languages.json';
import relocationJson from '../../examples/relocation.json';
import videoJson from '../../examples/video-generation.json';

const languages = Analysis.parse(languagesJson);
const relocation = Analysis.parse(relocationJson);
const video = Analysis.parse(videoJson);

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

const panel = () => el.querySelector<HTMLDetailsElement>('details[data-analysis="scatter"]');
const open = async (analysis: Analysis, view = initialViewState(analysis)) => {
  handle = mountMatrix(el, { analysis, measure: 'score', view }, { panels: [ScatterPanel] });
  await userEvent.click(panel()!.querySelector('summary')!);
};
const point = (id: string) => panel()!.querySelector<SVGGElement>(`[data-point="${id}"]`)!;
const row = (id: string) => Array.from(panel()!.querySelectorAll(`tr[data-row="${id}"] td`), (td) => td.textContent);

describe('the scatter panel', () => {
  it('is drawn only when registered, and computes nothing until opened', () => {
    handle = mountMatrix(el, { analysis: languages, measure: 'score' });
    expect(panel()).toBeNull();
    handle.destroy();
    handle = mountMatrix(el, { analysis: languages, measure: 'score' }, { panels: [ScatterPanel] });
    expect(panel()!.open).toBe(false);
    expect(panel()!.querySelector('svg')).toBeNull();
  });

  it('names its front for what it is, and marks what is dominated here and overall by shape', async () => {
    await open(languages);
    expect(panel()!.querySelector('figcaption')!.textContent).toMatch(/^Non-dominated on these two criteria: Go, Rust, Python\. This is not the frontier across every criterion/);
    // TypeScript: a cross here (dominated by Go), and no square overall (non-dominated across every criterion).
    expect([point('typescript').dataset['here'], point('typescript').dataset['overall']]).toEqual(['dominated', 'non-dominated']);
    expect(point('typescript').querySelector('path')).not.toBeNull();
    expect(point('typescript').querySelector('rect')).toBeNull();
    // Go: a filled dot.
    expect(point('go').querySelector('circle')!.getAttribute('fill')).toBe('currentColor');
    expect(row('typescript')).toEqual(['4', '3', 'dominated by Go', 'non-dominated']);
    // Every mark is drawn in the text colour: shape carries the tier, not a hue.
    for (const mark of Array.from(panel()!.querySelectorAll('svg circle, svg path, svg rect'))) {
      expect(mark.getAttribute('stroke')).toBe('currentColor');
    }
  });

  it('draws a possibly dominated alternative as a ring, with a dashed square when it is possibly dominated overall too', async () => {
    await open(relocation);
    // The first two dominance criteria are rent and income tax; Seoul has no rent and stays possibly dominated.
    expect(row('seoul')[2]).toBe('possibly dominated');
    expect(point('lisbon').querySelector('circle')!.getAttribute('fill')).toBe('none');
    // Seoul is not placed (no rent), and says why rather than vanishing: no bare nulls.
    expect(panel()!.querySelector('[data-point="seoul"]')).toBeNull();
    expect(row('seoul')[0]).toBe('We looked; the sources do not settle it.');
    expect(panel()!.textContent).toMatch(/Not on the plot: .*Seoul \(Rent: We looked; the sources do not settle it\.; Income tax burden: /);
    // The legend, and what the comparison across every criterion says of itself.
    expect(panel()!.querySelectorAll('ul[aria-label="What the marks mean"] li')).toHaveLength(3);
    expect(panel()!.textContent).toMatch(/Across every criterion: 2 criteria are excluded/);
  });

  it('marks what is dominated across every criterion with a square, and what may be with a dashed one', async () => {
    await open(video);
    const square = (id: string) => point(id).querySelector('rect')!;
    // Veo is dominated overall; Kling only possibly.
    expect([point('google-veo-3-1').dataset['overall'], square('google-veo-3-1').getAttribute('stroke-dasharray')]).toEqual(['dominated', null]);
    expect([point('kling-3-0-omni').dataset['overall'], square('kling-3-0-omni').getAttribute('stroke-dasharray')]).toEqual(['possibly-dominated', '3 2']);
  });

  it('runs every axis so that better is to the right, flipping a criterion where less is better', async () => {
    await open(relocation);
    await userEvent.selectOptions(Array.from(panel()!.querySelectorAll('select'))[1]!, 'flight-hours');
    const cx = (id: string) => Number(point(id).querySelector('circle')!.getAttribute('cx'));
    // Rent: less is better. Taipei (1100) is right of Berlin (1600).
    expect(cx('taipei')).toBeGreaterThan(cx('berlin'));
    expect(panel()!.querySelector('svg')!.textContent).toContain('Rent (better to the right)');
  });

  it('draws alternatives at the same place side by side under one label, and names the measure', async () => {
    await open(languages);
    await userEvent.selectOptions(Array.from(panel()!.querySelectorAll('select'))[1]!, 'tooling');
    const [go, ts] = ['go', 'typescript'].map((id) => Number(point(id).querySelector('circle, path')!.getAttribute(point(id).querySelector('circle') ? 'cx' : 'd')!.toString().replace(/^M/, '').split(' ')[0]));
    expect(go).not.toBe(ts);
    expect(Array.from(panel()!.querySelectorAll('svg text'), (t) => t.textContent)).toContain('Go, TypeScript');
    expect(panel()!.querySelector('figcaption')!.textContent).toMatch(/Measure: score\.$/);
  });

  it('names on its caption a non-dominated alternative it cannot place', async () => {
    await open(relocation);
    await userEvent.selectOptions(Array.from(panel()!.querySelectorAll('select'))[1]!, 'flight-hours');
    await userEvent.selectOptions(Array.from(panel()!.querySelectorAll('select'))[0]!, 'income-tax');
    expect(panel()!.querySelector('figcaption')!.textContent).toMatch(/^Non-dominated on these two criteria: Berlin \(not placed\)\./);
  });

  it('runs the vertical axis so that better is up, flipping it where less is better', async () => {
    await open(relocation);
    await userEvent.selectOptions(Array.from(panel()!.querySelectorAll('select'))[1]!, 'flight-hours');
    const cy = (id: string) => Number(point(id).querySelector('circle, path')!.getAttribute('cy') ?? point(id).querySelector('path')!.getAttribute('d')!.split(' ')[1]);
    // Flight hours: less is better. Berlin (2 h) sits above Taipei (15.5 h): a smaller y is higher on screen.
    expect(cy('berlin')).toBeLessThan(cy('taipei'));
    expect(panel()!.querySelector('svg')!.getAttribute('aria-label')).toMatch(/^Rent across, Flight hours to family up, better toward the top right/);
    expect(panel()!.querySelector('table caption')!.textContent).toMatch(/\(measure: score\)$/);
  });

  it('puts a label past the middle on the left of its mark, so the plot\'s edge never clips it', async () => {
    await open(languages);
    for (const text of Array.from(panel()!.querySelectorAll<SVGTextElement>('svg g > text'))) {
      const box = text.getBBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(360);
    }
  });

  it('keeps what it can of a choice the document no longer allows', async () => {
    await open(relocation);
    await userEvent.selectOptions(Array.from(panel()!.querySelectorAll('select'))[1]!, 'flight-hours');
    const doc = structuredClone(relocation);
    doc.criteria.find((c) => c.id === 'rent')!.tombstoned = true;
    handle!.update({ analysis: doc });
    const [across, up] = Array.from(panel()!.querySelectorAll('select'));
    expect(up!.value).toBe('flight-hours');
    expect(across!.value).not.toBe('rent');
    expect(panel()!.querySelector('figcaption')).not.toBeNull();
  });

  it('lets the reader choose the two criteria, and swaps them rather than take the same one twice', async () => {
    await open(relocation);
    const [across, up] = Array.from(panel()!.querySelectorAll('select'));
    await userEvent.selectOptions(up!, 'flight-hours');
    expect(panel()!.querySelector('figcaption')!.textContent).toMatch(/^Non-dominated on these two criteria: Lisbon, Berlin, Taipei, Montreal\./);
    await userEvent.selectOptions(across!, 'flight-hours');
    expect([across!.value, up!.value]).toEqual(['flight-hours', 'rent']);
    // And from the other picker.
    await userEvent.selectOptions(up!, 'flight-hours');
    expect([across!.value, up!.value]).toEqual(['rent', 'flight-hours']);
    // Labelled controls, reachable by keyboard.
    for (const s of [across!, up!]) expect(panel()!.querySelector(`label[for="${s.id}"]`)).not.toBeNull();
  });

  describe('what is compared (#286)', () => {
    const scope = () => panel()!.querySelector<HTMLSelectElement>('select[id$="-scope"]');
    const tolerance = () => panel()!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    const basis = () => panel()!.querySelector('[data-basis]')!.textContent;
    const hint = () => panel()!.querySelector('[data-tolerance-hint]')!.textContent;
    const dropped = () => panel()!.querySelector('[data-scope-dropped]')!.textContent;
    const rows = () => Array.from(panel()!.querySelectorAll<HTMLElement>('tbody tr'), (r) => r.dataset['row']);
    const axis = (which: 0 | 1, criterion: string) => userEvent.selectOptions(Array.from(panel()!.querySelectorAll('select'))[which]!, criterion);
    /** Relocation with an indifference threshold on rent: 600 USD/month counts as no difference. */
    const tolerant = () => {
      const doc = structuredClone(relocation);
      doc.criteria.find((c) => c.id === 'rent')!.defaultMeasurement!.thresholds = { indifference: 600 };
      return Analysis.parse(doc);
    };
    const hiding = (...hiddenAlternatives: string[]) => setFilter(initialViewState(relocation), { hiddenAlternatives });

    it('scopes the comparison to a group the reader picks, by keyboard, and the basis sentence names it', async () => {
      await open(relocation);
      expect(basis()).toBe('Compared across every option (5), strictly: any difference counts.');
      expect(Array.from(scope()!.options, (o) => o.textContent)).toEqual(['Every option (5)', 'Europe (2)', 'Asia (2)', 'Americas (1)']);
      expect(panel()!.querySelector(`label[for="${scope()!.id}"]`)!.textContent).toBe('Compare');
      scope()!.focus();
      await userEvent.selectOptions(scope()!, 'g-asia');
      await expect.poll(rows).toEqual(['taipei', 'seoul']);
      expect(basis()).toBe('Compared within the group "Asia": 2 options, strictly: any difference counts.');
      expect(panel()!.textContent).toContain('across 2 options in "Asia"');
      await userEvent.selectOptions(scope()!, '');
      await expect.poll(rows).toHaveLength(5);
    });

    it('names a sub-group\'s parent in its option, and scopes to its members', async () => {
      const doc = structuredClone(relocation);
      doc.groups.push({ id: 'g-iberia', label: 'Iberia', axis: 'alternatives', parentId: 'g-europe' });
      doc.alternatives.find((a) => a.id === 'lisbon')!.groupIds = ['g-iberia'];
      await open(Analysis.parse(doc));
      expect(Array.from(scope()!.options, (o) => o.textContent)).toContain('Iberia, in Europe (1)');
      await userEvent.selectOptions(scope()!, 'g-iberia');
      await expect.poll(rows).toEqual(['lisbon']);
    });

    it('offers only the groups with an alternative the matrix shows, and counts only their own hidden ones', async () => {
      await open(relocation, hiding('montreal', 'seoul'));
      expect(Array.from(scope()!.options, (o) => o.value)).toEqual(['', 'g-europe', 'g-asia']);
      await userEvent.selectOptions(scope()!, 'g-asia');
      // Seoul is hidden, so not listed; it is in the group, so still compared, and counted as hidden. Montreal is out of scope, not hidden.
      await expect.poll(rows).toEqual(['taipei']);
      expect(panel()!.querySelector('[data-hidden-note]')!.textContent).toMatch(/^Hidden in the matrix, so not listed here: 1 option\./);
      expect(basis()).toContain('2 options');
    });

    it('lets go of a group the arrangement withdraws, says so, and does not bring it back when its members reappear', async () => {
      await open(relocation, hiding('montreal'));
      await userEvent.selectOptions(scope()!, 'g-asia');
      await expect.poll(rows).toEqual(['taipei', 'seoul']);
      expect(dropped()).toBe('');
      handle!.update({ view: hiding('montreal', 'seoul', 'taipei') });
      await expect.poll(dropped).toBe('The group "Asia" is no longer offered: the matrix shows none of its options, so every option is compared.');
      expect(panel()!.querySelector('[data-scope-dropped]')!.getAttribute('role')).toBe('status');
      expect(scope()!.value).toBe('');
      handle!.update({ view: hiding() });
      await expect.poll(() => Array.from(scope()!.options, (o) => o.value)).toContain('g-asia');
      expect(scope()!.value).toBe('');
      expect(rows()).toHaveLength(5);
      // Picking again clears what was said.
      await userEvent.selectOptions(scope()!, 'g-europe');
      await expect.poll(dropped).toBe('');
    });

    it('says a group the document tombstoned is no longer in the analysis', async () => {
      await open(relocation);
      await userEvent.selectOptions(scope()!, 'g-asia');
      await expect.poll(rows).toEqual(['taipei', 'seoul']);
      const doc = structuredClone(relocation);
      doc.groups.find((g) => g.id === 'g-asia')!.tombstoned = true;
      handle!.update({ analysis: doc });
      await expect.poll(dropped).toBe('The group "Asia" is no longer in this analysis, so every option is compared.');
    });

    it('says in words why there is no group to pick, where there is none', async () => {
      await open(languages);
      expect(scope()).toBeNull();
      expect(panel()!.querySelector('[data-scope-unavailable]')!.textContent).toMatch(/^Every \w+ is compared: this analysis declares no groups of \w+, so there is no group to compare within\.$/);
    });

    it('applies the practical tolerance when the reader turns it on, and the basis sentence says which thresholds it used', async () => {
      await open(tolerant());
      await axis(1, 'flight-hours');
      await expect.poll(() => row('lisbon')[2]).toBe('non-dominated');
      expect(tolerance().checked).toBe(false);
      expect(panel()!.querySelector(`#${CSS.escape(tolerance().getAttribute('aria-describedby')!)}`)!.textContent).toMatch(/^Counts a difference at or below a criterion's declared indifference threshold as none/);
      tolerance().focus();
      await userEvent.keyboard(' ');
      await expect.poll(() => row('lisbon')[2]).toBe('dominated by Berlin');
      expect(tolerance().checked).toBe(true);
      expect(basis()).toBe(
        'Compared across every option (5), with the practical tolerance: a difference at or below a criterion\'s indifference threshold counts as none ' +
        '(Rent: 600 USD/month; Flight hours to family: none declared, so compared strictly; 1 of the 6 criteria compared across every criterion declares one).',
      );
      await userEvent.click(tolerance());
      await expect.poll(() => row('lisbon')[2]).toBe('non-dominated');
      expect(basis()).toMatch(/strictly: any difference counts\.$/);
    });

    it('applies a group scope and the tolerance together, and names both', async () => {
      await open(tolerant());
      await axis(1, 'flight-hours');
      await userEvent.selectOptions(scope()!, 'g-europe');
      await userEvent.click(tolerance());
      await expect.poll(rows).toEqual(['lisbon', 'berlin']);
      await expect.poll(() => row('lisbon')[2]).toBe('dominated by Berlin');
      expect(basis()).toMatch(/^Compared within the group "Europe": 2 options, with the practical tolerance: .*\(Rent: 600 USD\/month; /);
    });

    it('says the tolerance would change nothing where no criterion declares a threshold, and refuses it rather than do nothing silently', async () => {
      await open(relocation);
      const box = tolerance();
      expect(box.getAttribute('aria-disabled')).toBe('true');
      expect(hint()).toBe('Unavailable: none of the 6 criteria compared declares an indifference threshold, so the practical tolerance would change nothing.');
      // Still focusable, so the reason is heard; a toggle does not land.
      box.focus();
      expect(document.activeElement).toBe(box);
      await userEvent.keyboard(' ');
      expect(box.checked).toBe(false);
      // A pointer's click, dispatched: the test driver itself refuses to click what is marked unavailable.
      box.click();
      expect(box.checked).toBe(false);
      expect(basis()).toMatch(/strictly: any difference counts\.$/);
    });

    it('words a tolerance left on after the document lost its thresholds as on and changing nothing, and lets it be turned off', async () => {
      await open(tolerant());
      await userEvent.click(tolerance());
      await expect.poll(() => tolerance().checked).toBe(true);
      handle!.update({ analysis: relocation });
      await expect.poll(hint).toBe('On, but none of the 6 criteria compared declares an indifference threshold, so it changes nothing: the comparison is strict.');
      expect(tolerance().getAttribute('aria-disabled')).toBeNull();
      await userEvent.click(tolerance());
      await expect.poll(hint).toMatch(/^Unavailable: /);
      expect(tolerance().checked).toBe(false);
    });

    it('says when neither axis declares a threshold, so the tolerance changes only the tier across every criterion', async () => {
      await open(tolerant());
      await axis(0, 'income-tax');
      await axis(1, 'flight-hours');
      await expect.poll(hint).toBe(
        'Neither Income tax burden nor Flight hours to family declares an indifference threshold, so here the tolerance changes only the tier across every criterion (1 of the 6 criteria compared declares one).',
      );
    });
  });
});
