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

  it('lets the reader choose the two criteria, and swaps them rather than take the same one twice', async () => {
    await open(relocation);
    const [across, up] = Array.from(panel()!.querySelectorAll('select'));
    await userEvent.selectOptions(up!, 'flight-hours');
    expect(panel()!.querySelector('figcaption')!.textContent).toMatch(/^Non-dominated on these two criteria: Lisbon, Berlin, Taipei, Montreal\./);
    await userEvent.selectOptions(across!, 'flight-hours');
    expect([across!.value, up!.value]).toEqual(['flight-hours', 'rent']);
    // Labelled controls, reachable by keyboard.
    for (const s of [across!, up!]) expect(panel()!.querySelector(`label[for="${s.id}"]`)).not.toBeNull();
  });
});
