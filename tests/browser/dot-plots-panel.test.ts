/**
 * The small-multiple dot plots panel (#96, ADR-0026): registered like any
 * analysis panel, closed until opened, a table per criterion with its own
 * levels as columns, one dot per rater, and a missing lane keyed by reason.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commands, userEvent } from '@vitest/browser/context';

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
afterEach(async () => {
  await commands.emulateMedia({ forcedColors: 'none', media: null });
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
    // Its column header names the lane, in words, beside the reason's glyph.
    const head = tax.querySelector('th[data-lane="not-assessed"]')!;
    expect(head.textContent).toBe(' Missing: not assessed');
    expect(head.querySelector('svg')).not.toBeNull();
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
    // Seen as two filled dots, which a screen reader skips for the words naming who put them there.
    expect(berlin[0]!.querySelector('[aria-hidden="true"]')!.textContent).toBe('●●');
    expect(berlin[0]!.querySelector('.comparanda-sr')!.textContent).toMatch(/^2 raters: Ana .*, Cleo /);
    // A nominal criterion's own level names are its columns.
    expect(Array.from(plot('climate-type').querySelectorAll('thead th[data-tick]'), (th) => th.textContent)).toEqual(['Mediterranean', 'Continental', 'Subtropical']);
  });

  for (const medium of [{}, { forcedColors: 'active' as const }, { media: 'print' as const }]) {
    it(`draws nothing between the levels, on screen, in forced colours and in print: no rule through a row, nothing sticky (${JSON.stringify(medium)})`, async () => {
      await commands.emulateMedia({ forcedColors: 'none', media: null, ...medium });
      await open();
      for (const cell of Array.from(plot('winter-daylight').querySelectorAll<HTMLElement>('th, td'))) {
        const style = getComputedStyle(cell);
        expect([style.boxShadow, style.position, style.borderTopWidth, style.borderBottomWidth]).toEqual(['none', 'static', '0px', '0px']);
      }
      // A row's name reads from its start, the levels are centred under their ticks.
      expect(getComputedStyle(plot('winter-daylight').querySelector('tbody th')!).textAlign).toBe('start');
    });
  }

  it('draws an unnamed hand as a ring, says so, and counts what it may not show', async () => {
    const rounds = (feedback: string) => Analysis.parse({
      ...relocationJson,
      rounds: [{ id: 'r1', index: 1, attribution: 'anonymous', feedback }],
      cells: relocation.cells.map((c) => ({ ...c, assertions: c.assertions.map((s) => ({ ...s, roundId: 'r1' })) })),
    });
    const viewer = { viewerId: 'ben', now: '2026-01-01T00:00:00Z' };
    handle = mountMatrix(el, { analysis: rounds('anonymous-summary'), measure: 'score', viewer }, { panels: [DotPlotsPanel] });
    await userEvent.click(panel()!.querySelector('summary')!);
    const first = plot('winter-daylight').querySelector('tr[data-row="berlin"] td[data-dots]')!;
    expect(first.querySelector('[aria-hidden="true"]')!.textContent).toBe('○○');
    expect(first.querySelector('.comparanda-sr')!.textContent).toBe('2 raters: 2 raters not named to you');
    handle.destroy();
    handle = mountMatrix(el, { analysis: rounds('none'), measure: 'score', viewer }, { panels: [DotPlotsPanel] });
    await userEvent.click(panel()!.querySelector('summary')!);
    const daylight = plot('winter-daylight');
    expect(Array.from(daylight.querySelectorAll('thead th')).at(-1)!.textContent).toBe('Not drawn');
    expect(Array.from(daylight.querySelectorAll('tr[data-row="berlin"] td')).at(-1)!.textContent).toBe('2 not shown to you');
  });

  it('gives a declared block\'s own reason in the lane', async () => {
    await open();
    const lane = plot('eu-residency-path').querySelector('tr[data-row="taipei"] td[data-lane="not-applicable"]')!;
    expect(lane.textContent).toContain('1 mark: This criterion does not apply to this alternative. Not an EU destination, so EU residency rules do not apply.');
    expect(plot('eu-residency-path').querySelector('caption')!.textContent).toBe('Path to EU residency: one dot per rater, by level, then the missing lane');
  });

  it('says why a criterion on a continuous range has no dot plot', async () => {
    await open();
    expect(plot('rent').querySelector('[role="note"]')!.textContent).toMatch(/continuous range/);
    expect(plot('rent').querySelector('table')).toBeNull();
  });
});
