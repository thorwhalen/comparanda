/**
 * The two-criterion scatter panel (#97, ADR-0026): registered like any analysis
 * panel, closed until opened, labelled "non-dominated on these two criteria",
 * its three tiers and the tier overall told apart by shape, and everything in
 * a table as well.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from '@vitest/browser/context';

import { Analysis } from '../../src/core/schema/analysis.js';
import { mountMatrix, ScatterPanel, type MatrixHandle } from '../../src/view/index.js';
import languagesJson from '../../examples/languages.json';
import relocationJson from '../../examples/relocation.json';

const languages = Analysis.parse(languagesJson);
const relocation = Analysis.parse(relocationJson);

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
const open = async (analysis: Analysis) => {
  handle = mountMatrix(el, { analysis, measure: 'score' }, { panels: [ScatterPanel] });
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
    // Seoul is not placed (no rent), and says so rather than vanishing.
    expect(panel()!.querySelector('[data-point="seoul"]')).toBeNull();
    expect(panel()!.textContent).toMatch(/Not on the plot, for want of a value on one of the two: .*Seoul/);
  });

  it('lets the reader choose the two criteria, and refuses the same one twice with its reason', async () => {
    await open(relocation);
    const [across, up] = Array.from(panel()!.querySelectorAll('select'));
    await userEvent.selectOptions(up!, 'flight-hours');
    expect(panel()!.querySelector('figcaption')!.textContent).toMatch(/^Non-dominated on these two criteria: Lisbon, Berlin, Taipei, Montreal\./);
    await userEvent.selectOptions(across!, 'flight-hours');
    expect(panel()!.querySelector('[role="note"]')!.textContent).toMatch(/two different criteria/);
    // Labelled controls, reachable by keyboard.
    for (const s of [across!, up!]) expect(panel()!.querySelector(`label[for="${s.id}"]`)).not.toBeNull();
  });
});
