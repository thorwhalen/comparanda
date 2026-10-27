/**
 * The small-multiple dot plots panel (#96, ADR-0026): registered like any
 * analysis panel, closed until opened, a table per criterion with its own
 * levels as columns, one dot per rater, and a missing lane keyed by reason.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from '@vitest/browser/context';

import { Analysis } from '../../src/core/schema/analysis.js';
import { DotPlotsPanel, mountMatrix, type MatrixHandle } from '../../src/view/index.js';
import relocationJson from '../../examples/relocation.json';

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

const panel = () => el.querySelector<HTMLDetailsElement>('details[data-analysis="dot-plots"]');
const plot = (crit: string) => panel()!.querySelector<HTMLElement>(`[data-dot-plot="${crit}"]`)!;
const open = async () => {
  handle = mountMatrix(el, { analysis: relocation, measure: 'score' }, { panels: [DotPlotsPanel] });
  await userEvent.click(panel()!.querySelector('summary')!);
};

describe('the dot plots panel', () => {
  it('is drawn only when registered, and computes nothing until opened', () => {
    handle = mountMatrix(el, { analysis: relocation, measure: 'score' });
    expect(panel()).toBeNull();
    handle.destroy();
    handle = mountMatrix(el, { analysis: relocation, measure: 'score' }, { panels: [DotPlotsPanel] });
    expect(panel()!.open).toBe(false);
    expect(panel()!.querySelector('table')).toBeNull();
  });

  it('shows an alternative with no value in that panel\'s missing lane, with its reason\'s glyph and words', async () => {
    await open();
    const tax = plot('income-tax');
    const montreal = tax.querySelector('tr[data-row="montreal"]')!;
    const lane = montreal.querySelector('td[data-lane="not-assessed"]')!;
    expect(lane.querySelector('svg')).not.toBeNull();
    expect(lane.textContent).toContain('1 mark: Nobody has looked yet.');
    // Its column header names the lane, in words.
    expect(tax.querySelector('th[data-lane="not-assessed"]')!.textContent).toBe(' Missing: not assessed');
    // No dot anywhere on Montreal's levels.
    expect(montreal.querySelectorAll('td[data-dots]')).toHaveLength(0);
  });

  it('puts one dot per rater on the criterion\'s own levels, each said with who put it there', async () => {
    await open();
    const daylight = plot('winter-daylight');
    expect(Array.from(daylight.querySelectorAll('thead th[data-tick]'), (th) => th.textContent)).toEqual(['1', '2', '3', '4', '5']);
    // The level columns only: the missing lane follows them in every row.
    const berlin = Array.from(daylight.querySelectorAll('tr[data-row="berlin"] td:not([data-lane])'));
    expect(berlin.map((td) => td.getAttribute('data-dots'))).toEqual(['2', null, '1', null, null]);
    expect(berlin[0]!.textContent).toMatch(/^●●2 raters: /);
    // A nominal criterion's own level names are its columns.
    expect(Array.from(plot('climate-type').querySelectorAll('thead th[data-tick]'), (th) => th.textContent)).toEqual(['Mediterranean', 'Continental', 'Subtropical']);
  });

  it('says why a criterion on a continuous range has no dot plot', async () => {
    await open();
    expect(plot('rent').querySelector('[role="note"]')!.textContent).toMatch(/continuous range/);
    expect(plot('rent').querySelector('table')).toBeNull();
  });
});
