/**
 * The rank-flow panel (#98, ADR-0026): absent unless weighted aggregation is
 * opted into, captioned as a stability finding and never as a winner, ranks the
 * selection only and refuses above thirty, tells movement and missingness by
 * shape rather than colour, and offers every control to the keyboard.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from '@vitest/browser/context';

import { Analysis } from '../../src/core/schema/analysis.js';
import { sensitivity } from '../../src/core/analyses/sensitivity.js';
import { weightedSum } from '../../src/core/analyses/weighted-sum.js';
import { initialViewState, setFilter } from '../../src/core/view-state.js';
import { mountMatrix, rankFlowPanel, type MatrixHandle, type WeightingOptIn } from '../../src/view/index.js';
import relocationJson from '../../examples/relocation.json';
import { reversal, weighted } from '../support/weighted.js';

const relocation = Analysis.parse(relocationJson);
const weightedRelocation = weighted(relocation);
const RankFlow = rankFlowPanel({ weightedSum, sensitivity });

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

const panel = () => el.querySelector<HTMLDetailsElement>('details[data-analysis="rank-flow"]');
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const open = async (analysis: Analysis, view = initialViewState(analysis)) => {
  handle = mountMatrix(el, { analysis, measure: 'score', view }, { panels: [RankFlow] });
  await userEvent.click(panel()!.querySelector('summary')!);
};
const caption = () => panel()!.querySelector('figcaption')!.textContent!;
const row = (id: string) => Array.from(panel()!.querySelectorAll(`tr[data-row="${id}"] td`), (td) => td.textContent);
/** Endorsement words a caption must never use (ADR-0026). */
const ENDORSEMENT = /\b(best|winner|wins|top|recommend\w*|choose|first place)\b/i;
/** The sensitivity caption's disclaimer, which names those words to disown them: matched whole, then set aside. */
const DISCLAIMER = 'it does not say which alternative to choose, and no number here is a recommendation.';
/** The caption without its disclaimer, which must be there. */
const endorsable = () => {
  expect(caption()).toContain(DISCLAIMER);
  return caption().replace(DISCLAIMER, '');
};

/** `n` alternatives, one weighted criterion: enough rows to exceed the limit. */
function many(n: number): Analysis {
  return Analysis.parse({
    id: 'many', subject: { question: 'Which bench?' }, authors: [{ id: 'a', displayName: 'A', kind: 'human' }],
    alternatives: Array.from({ length: n }, (_, i) => ({ id: `b${i}`, label: `Bench ${i}` })),
    criteria: [{ id: 'grip', label: 'Grip', defaultMeasurement: { level: 'ratio', preference: 'increasing', range: { min: 0, max: 100 } }, weights: { substitution: 1 } }],
    cells: Array.from({ length: n }, (_, i) => ({
      alternativeId: `b${i}`, criterionId: 'grip', measure: 'score',
      assertions: [{ id: `s${i}`, authorId: 'a', at: '2026-01-01T00:00:00Z', version: 1, evidence: [], value: i, justification: 'measured' }],
    })),
  });
}

describe('gated behind the weighted-aggregation opt-in', () => {
  it('cannot be made without the weighted sum and its sensitivity, and says why', () => {
    expect(() => rankFlowPanel(undefined as unknown as WeightingOptIn)).toThrow(/presupposes a weighted aggregation, which is opt-in/);
    expect(() => rankFlowPanel({ weightedSum } as unknown as WeightingOptIn)).toThrow(/rankFlowPanel\(\{ weightedSum, sensitivity \}\)/);
  });

  it('is absent where the document declares no weight, and closed and uncomputed where it does', () => {
    handle = mountMatrix(el, { analysis: relocation, measure: 'score' }, { panels: [RankFlow] });
    expect(panel()).toBeNull();
    handle.destroy();
    handle = mountMatrix(el, { analysis: weightedRelocation, measure: 'score' }, { panels: [RankFlow] });
    expect(panel()!.open).toBe(false);
    expect(panel()!.querySelector('svg')).toBeNull();
  });
});

describe('captioned as a stability finding, never a winner', () => {
  it('leads with the sensitivity analysis\'s own caption, counts what moved, and inherits the ordinal warning', async () => {
    await open(weightedRelocation);
    expect(caption()).toMatch(/^Stability of the reported order under a change of weights/);
    // The first change here is separability lost, not a pass: the order of the rows ranked in both holds.
    expect(caption()).toMatch(/From "As declared" to "Winter daylight at [\d.]+, declared 1", the order of the 3 options ranked in both holds; the data no longer separate 2 options from their neighbours\.$/);
    expect(endorsable()).not.toMatch(ENDORSEMENT);
    const warnings = Array.from(panel()!.querySelectorAll('[data-warning]'), (p) => p.textContent);
    expect(warnings.some((w) => /^Ordinal criteria are in this sum/.test(w!))).toBe(true);
    expect(panel()!.querySelector('[data-finding]')!.textContent).toMatch(/^As declared: Weights: the order first changes when "winter-daylight" moves down/);
  });
});

describe('drawn by shape, labelled at both ends, and said in words', () => {
  const lines = () => Array.from(panel()!.querySelectorAll<SVGPathElement>('path[data-flow]'));
  const dashed = (l: Element) => l.getAttribute('stroke-dasharray') !== null;

  it('dashes a line that changes place, and only that', async () => {
    await open(reversal());
    expect(lines().map((l) => [l.dataset['flow'], l.dataset['move'], dashed(l)])).toEqual([['oak', 'fell', true], ['pine', 'rose', true], ['steel', 'held', false]]);
    for (const l of lines()) expect(l.getAttribute('stroke')).toBe('currentColor');
    expect(caption()).toMatch(/2 of the 3 options ranked in both change place and 1 pair passes each other: the order is not stable/);
    expect(endorsable()).not.toMatch(ENDORSEMENT);
    expect(panel()!.querySelector('[data-passed]')!.textContent).toBe('Pass each other: Oak and Pine.');
  });

  it('draws separability lost as a solid line to a ring, never as a move, and names every ranked row at both ends', async () => {
    await open(weightedRelocation);
    expect(lines().map((l) => [l.dataset['flow'], l.dataset['move'], dashed(l)])).toEqual([['lisbon', 'unsettled', false], ['berlin', 'held', false], ['montreal', 'unsettled', false]]);
    const ends = (column: string) => Array.from(panel()!.querySelectorAll(`[data-column="${column}"] [data-end-label]`), (t) => t.textContent);
    expect(ends('declared')).toEqual(['Lisbon (1)', 'Berlin, Montreal (2 to 3)']);
    expect(ends('changed')).toEqual(['Lisbon, Montreal (1 to 3)', 'Berlin (2 to 3)']);
    // A settled rank is a dot, one the data leave open a ring.
    const mark = (column: string, rank: number) => panel()!.querySelector(`[data-column="${column}"] [data-rank="${rank}"] circle`)!.getAttribute('fill');
    expect([mark('declared', 1), mark('declared', 2), mark('changed', 1)]).toEqual(['currentColor', 'none', 'none']);
  });

  it('draws at its natural size in a scroller the keyboard reaches, so a narrow screen scrolls rather than shrinks it', async () => {
    el.style.width = '320px';
    await open(weightedRelocation);
    const svg = panel()!.querySelector('svg')!;
    const scroller = svg.parentElement!;
    expect(svg.getBoundingClientRect().width).toBeCloseTo(Number(svg.getAttribute('width')), 1);
    expect(svg.getBoundingClientRect().width).toBeGreaterThan(320);
    expect(getComputedStyle(scroller).overflowX).toBe('auto');
    expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth);
    expect([scroller.tabIndex, scroller.getAttribute('role'), scroller.getAttribute('aria-label')]).toEqual([0, 'region', expect.stringMatching(/scrolls sideways/)]);
  });

  it('puts what the gate did not score below a rule as a cross, never as a rank, and says why', async () => {
    await open(weightedRelocation);
    expect(panel()!.querySelectorAll('[data-column="declared"] [data-unranked]')).toHaveLength(2);
    expect(panel()!.querySelector('[data-unranked-rule]')).not.toBeNull();
    expect(row('taipei')).toEqual([
      'not ranked: not scored -- insufficient coverage', 'not ranked: not scored -- insufficient coverage', 'ranked under neither',
    ]);
    expect(row('berlin')).toEqual(['2, not separable from Montreal on the data', '2 to 3, not settled by the data', 'keeps 2 to 3']);
    expect(row('lisbon')).toEqual(['1', '1, not separable from Montreal on the data', 'keeps its place; the data no longer separate it from a neighbour (1, then 1 to 2)']);
  });
});

describe('ranks only the current selection', () => {
  it('ranks the alternatives the matrix shows, in the analysis\'s words, and says hiding changes ranks, not scores', async () => {
    await open(weightedRelocation, setFilter(initialViewState(weightedRelocation), { hiddenAlternatives: ['montreal'] }));
    expect(panel()!.querySelector('tr[data-row="montreal"]')).toBeNull();
    expect(row('berlin')[0]).toBe('2');
    // Not "hiding changes none of the figures": here it changes the ranks.
    expect(panel()!.querySelector('[data-hidden-note]')!.textContent).toBe('Hidden in the matrix, so not listed here: 1 option.');
    expect(panel()!.textContent).toMatch(/Ranked among the 4 options the matrix shows: hiding one changes the ranks below it, never a score/);
  });

  it('refuses above thirty with the reason, and ranks once enough are hidden', async () => {
    const a = many(31);
    await open(a);
    expect(panel()!.querySelector('svg')).toBeNull();
    expect(panel()!.querySelector('[role="note"][data-refused]')!.textContent).toMatch(/at most 30 options, and 31 are selected/);
    handle!.update({ view: setFilter(initialViewState(a), { hiddenAlternatives: ['b0'] }) });
    await tick();
    expect(panel()!.querySelector('svg')).not.toBeNull();
    // One weighted criterion: its only order change is to nothing at all, so it opens on the fragile share, and says so.
    expect(panel()!.textContent).toMatch(/No change of this weight alone alters the order, short of leaving nothing to rank; opens at a raise of 5% of the total weight \(1\.05\)/);
    expect(caption()).toMatch(/every one of the 30 options ranked in both keeps its place/);
  });
});

describe('a keyboard path for every control', () => {
  it('changes the weight from the keyboard, and a draft that is no number gives way to the weight in force', async () => {
    await open(weightedRelocation);
    const weight = panel()!.querySelector<HTMLInputElement>('input[type="number"]')!;
    // Typed, and committed by leaving the field with Tab: nothing is applied per keystroke.
    await userEvent.fill(weight, '1');
    expect(caption()).toMatch(/"Winter daylight at 0\.1/);
    await userEvent.keyboard('{Tab}');
    expect(caption()).toMatch(/"Winter daylight at 1, declared 1", every one of the 3 options ranked in both keeps its place: the order holds/);
    await userEvent.clear(weight);
    expect(weight.value).toBe('');
    await userEvent.keyboard('{Tab}');
    expect(weight.value).toBe('1');
    // A negative weight is the weighted sum's to refuse, in words, not the field's to swallow.
    await userEvent.fill(weight, '-1');
    await userEvent.keyboard('{Tab}');
    expect(panel()!.querySelector('[data-refused]')!.textContent).toMatch(/^The changed weighting is refused: .*negative substitution weight/);
  });

  it('picks the criterion and the mode from the keyboard, and draws two raters with the same component', async () => {
    await open(weightedRelocation);
    const criterion = panel()!.querySelector<HTMLSelectElement>('select')!;
    await userEvent.selectOptions(criterion, 'rent');
    expect(caption()).toMatch(/to "Rent at [\d.]+, declared 2"/);
    panel()!.querySelector<HTMLInputElement>('input[type="radio"][value="weighting"]')!.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(panel()!.querySelector<HTMLInputElement>('input[type="radio"][value="raters"]')!.checked).toBe(true);
    expect(caption()).toMatch(/^From "Ana Ruiz[^"]*" to "Ben Okafor[^"]*", /);
    expect(caption()).not.toMatch(ENDORSEMENT);
    expect(panel()!.querySelectorAll('path[data-flow]').length).toBeGreaterThan(0);
    // Picking the other side's rater swaps the two.
    const [, left, right] = Array.from(panel()!.querySelectorAll<HTMLSelectElement>('select'));
    await userEvent.selectOptions(left!, 'ben');
    expect([left!.value, right!.value]).toEqual(['ben', 'ana']);
  });
});
