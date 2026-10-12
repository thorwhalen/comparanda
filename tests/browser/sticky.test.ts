/**
 * Sticky headers without breaking focus geometry (#103, ADR-0027, SC 2.4.11):
 * walking the grid with the arrow keys, no focused cell ever ends up under the
 * sticky header row or the sticky header column, in either axis, with column
 * bands, transposed, and right to left.
 *
 * Real key presses in a small scroll container, so every press near an edge
 * scrolls; geometry from the rendered boxes, not from the stylesheet.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from '@vitest/browser/context';

import { Analysis } from '../../src/core/schema/analysis.js';
import { initialViewState, setFocus, setGrouping, transpose, type ViewState } from '../../src/core/view-state.js';
import { mountMatrix, type MatrixHandle } from '../../src/view/index.js';
import videoJson from '../../examples/video-generation.json';

const video = Analysis.parse(videoJson);

let el: HTMLElement;
let handle: MatrixHandle | undefined;
beforeEach(() => {
  el = document.createElement('div');
  // Small enough that the grid scrolls both ways.
  el.style.width = '480px';
  el.style.setProperty('--comparanda-max-height', '320px');
  document.body.append(el);
});
afterEach(() => {
  handle?.destroy();
  handle = undefined;
  el.remove();
  document.documentElement.removeAttribute('dir');
});

const scroller = () => el.querySelector<HTMLElement>('.comparanda-scroll')!;
const active = () => document.activeElement as HTMLElement;

/**
 * How far the focused element is covered by the sticky header row and column;
 * 0 when clear. Measured from the sticky `<th>`s, where they are painted -- a
 * `<thead>` or `<tr>` box scrolls away with the content while its cells stick.
 */
function obscured(): { block: number; inline: number; cut: number } {
  const cell = active().getBoundingClientRect();
  const headBottom = Math.max(...Array.from(el.querySelectorAll('thead th')).map((th) => th.getBoundingClientRect().bottom));
  const rtl = getComputedStyle(scroller()).direction === 'rtl';
  const inHead = active().closest('thead') !== null;
  const isRowHeader = active().matches('th[scope="row"]');
  // A header is sticky along its own axis: only the other axis's chrome can cover it.
  const block = inHead ? 0 : Math.max(0, headBottom - cell.top);
  let inline = 0;
  if (!isRowHeader && !active().matches('.comparanda-corner')) {
    const corner = el.querySelector('.comparanda-corner')!.getBoundingClientRect();
    inline = rtl ? Math.max(0, cell.right - corner.left) : Math.max(0, corner.right - cell.left);
  }
  // And a cell that fits in the clear area is wholly in it: its far edges inside the scrollport too.
  // In screen pixels, as the boxes are: the scroller's own lengths are CSS pixels, scaled by a host.
  const s = scroller();
  const box = s.getBoundingClientRect();
  const [kx, ky] = [s.offsetWidth / box.width, s.offsetHeight / box.height];
  const clearHeight = (s.clientHeight - parseFloat(getComputedStyle(s).scrollPaddingBlockStart)) / ky;
  const clearWidth = (s.clientWidth - parseFloat(getComputedStyle(s).scrollPaddingInlineStart)) / kx;
  const bottom = box.top + (s.clientTop + s.clientHeight) / ky;
  const [lo, hi] = [box.left + s.clientLeft / kx, box.left + (s.clientLeft + s.clientWidth) / kx];
  const cut = Math.max(
    !inHead && cell.height <= clearHeight ? cell.bottom - bottom : 0,
    !isRowHeader && cell.width <= clearWidth ? Math.max(cell.right - hi, lo - cell.left) : 0,
    0,
  );
  return { block, inline, cut };
}

/** Press `key` `times` times, checking after each press that the focused cell is clear. */
async function walk(key: string, times: number, where: string) {
  for (let i = 0; i < times; i++) {
    await userEvent.keyboard(`{${key}}`);
    const { block, inline, cut } = obscured();
    const at = active().getAttribute('data-cell');
    // A pixel: layout is subpixel, scroll offsets are whole pixels.
    expect(block, `${where}: ${key} #${i + 1} to ${at} is under the header row`).toBeLessThanOrEqual(1);
    expect(inline, `${where}: ${key} #${i + 1} to ${at} is under the header column`).toBeLessThanOrEqual(1);
    expect(cut, `${where}: ${key} #${i + 1} to ${at} fits but is cut off`).toBeLessThanOrEqual(1);
  }
}

/** Into the grid at its far corner, then back to the near edges along both axes, through headers too. */
async function tour(view: ViewState | undefined, where: string) {
  handle = mountMatrix(el, { analysis: video, measure: 'score', ...(view ? { view } : {}) });
  const s = scroller();
  expect(s.scrollHeight, 'the grid scrolls vertically').toBeGreaterThan(s.clientHeight);
  expect(s.scrollWidth, 'the grid scrolls horizontally').toBeGreaterThan(s.clientWidth);
  el.querySelector<HTMLElement>('[role="grid"] [tabindex="0"]')!.focus();
  await userEvent.keyboard('{Control>}{End}{/Control}');
  const [rows, cols] = active().getAttribute('data-cell')!.split(':').map(Number) as [number, number];
  const [back, forth] = getComputedStyle(s).direction === 'rtl' ? ['ArrowRight', 'ArrowLeft'] : ['ArrowLeft', 'ArrowRight'];
  // Up the last column to its header, then back down; left along the bottom row to its header, then right.
  await walk('ArrowUp', rows, `${where}, last column`);
  await walk('ArrowDown', rows, `${where}, last column`);
  await walk(back, cols, `${where}, last row`);
  await walk(forth, cols, `${where}, last row`);
  // The first data row and column, straight after a jump to the far end.
  await userEvent.keyboard('{Control>}{End}{/Control}');
  await walk(back, cols - 1, `${where}, to the first column`);
  await walk('ArrowUp', rows - 1, `${where}, to the first row`);
}

describe('a focused cell is never under the sticky headers (#103)', () => {
  it('standard orientation', async () => {
    await tour(undefined, 'standard');
  });

  it('transposed', async () => {
    await tour(transpose(initialViewState(video)), 'transposed');
  });

  it('with a column band row above the header row', async () => {
    const view = setGrouping(initialViewState(video), 'criteria', video.groups.filter((g) => g.axis === 'criteria').map((g) => g.id));
    await tour(view, 'banded');
    // The header row sticks below the band row, at its measured height, wherever the grid is scrolled.
    const band = el.querySelector('thead tr.comparanda-band th:not(.comparanda-corner)')!.getBoundingClientRect();
    const header = el.querySelector('thead tr:not(.comparanda-band) th')!.getBoundingClientRect();
    expect(Math.abs(header.top - band.bottom)).toBeLessThanOrEqual(1);
  });

  it('right to left', async () => {
    document.documentElement.setAttribute('dir', 'rtl');
    await tour(undefined, 'rtl');
  });

  // A host that scales the widget: boxes are measured on screen, scrolled in CSS pixels.
  for (const [how, scale] of [['transform: scale(0.5)', (n: HTMLElement) => { n.style.transform = 'scale(0.5)'; n.style.transformOrigin = '0 0'; }],
    ['zoom: 2', (n: HTMLElement) => { n.style.zoom = '2'; }]] as const) {
    it(`a host scales the matrix (${how})`, async () => {
      scale(el);
      await tour(undefined, how);
    });
  }

  it('a focus the host moves through the view is clear too', async () => {
    handle = mountMatrix(el, { analysis: video, measure: 'score' });
    el.querySelector<HTMLElement>('[role="grid"] [tabindex="0"]')!.focus();
    await userEvent.keyboard('{Control>}{End}{/Control}');
    const alts = video.alternatives.map((a) => a.id);
    const crits = video.criteria.map((c) => c.id);
    for (const [a, c] of [[0, 0], [alts.length - 1, 1], [1, crits.length - 2], [alts.length - 2, crits.length - 1]] as const) {
      handle.update({ view: setFocus(initialViewState(video), { alternativeId: alts[a]!, criterionId: crits[c]! }) });
      const { block, inline, cut } = obscured();
      expect([block, inline, cut].every((n) => n <= 1), `host focus ${alts[a]} / ${crits[c]}: ${block}, ${inline}, ${cut}`).toBe(true);
    }
  });

  it('after a click, a focus the host moves is still revealed, and a key reveals the clicked cell', async () => {
    handle = mountMatrix(el, { analysis: video, measure: 'score' });
    const s = scroller();
    const corner = el.querySelector('.comparanda-corner')!.getBoundingClientRect();
    // Click a cell clear of the chrome, so the browser is in pointer mode.
    const clicked = el.querySelector<HTMLElement>('tbody tr:nth-of-type(2) td:nth-of-type(5)')!;
    await userEvent.click(clicked);
    // Then a cell half under the header column, focused by the host.
    const td = el.querySelector<HTMLElement>('tbody tr:nth-of-type(3) td:nth-of-type(3)')!;
    s.scrollLeft += td.getBoundingClientRect().left - corner.right + td.getBoundingClientRect().width / 2;
    expect(td.getBoundingClientRect().left).toBeLessThan(corner.right);
    const alts = video.alternatives.map((a) => a.id);
    const crits = video.criteria.map((c) => c.id);
    handle.update({ view: setFocus(initialViewState(video), { alternativeId: alts[2]!, criterionId: crits[2]! }) });
    expect(document.activeElement).toBe(td);
    expect(obscured().inline).toBeLessThanOrEqual(1);
    // A clicked, half-covered cell is uncovered by the first key the reader presses there.
    s.scrollLeft += td.getBoundingClientRect().left - corner.right + td.getBoundingClientRect().width / 2;
    await userEvent.click(td, { position: { x: td.getBoundingClientRect().width - 4, y: 4 } });
    expect(obscured().inline).toBeGreaterThan(1);
    await userEvent.keyboard('{Shift}');
    expect(obscured().inline).toBeLessThanOrEqual(1);
  });

  it('a click does not scroll the cell out from under the pointer', async () => {
    handle = mountMatrix(el, { analysis: video, measure: 'score' });
    const s = scroller();
    // A cell half under the sticky header column, its visible half under the pointer.
    const corner = el.querySelector('.comparanda-corner')!.getBoundingClientRect();
    const td = el.querySelector<HTMLElement>('tbody tr td:nth-of-type(3)')!;
    s.scrollLeft += td.getBoundingClientRect().left - corner.right + td.getBoundingClientRect().width / 2;
    const before = s.scrollLeft;
    expect(td.getBoundingClientRect().left).toBeLessThan(corner.right);
    await userEvent.click(td, { position: { x: td.getBoundingClientRect().width - 4, y: 4 } });
    expect(document.activeElement).toBe(td);
    expect(s.scrollLeft).toBe(before);
  });

  it('the padding follows the header when its size changes', async () => {
    handle = mountMatrix(el, { analysis: video, measure: 'score' });
    const before = scroller().style.getPropertyValue('--cmp-sticky-block');
    el.querySelector<HTMLElement>('thead')!.style.fontSize = '2em';
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const after = scroller().style.getPropertyValue('--cmp-sticky-block');
    expect(parseFloat(after)).toBeGreaterThan(parseFloat(before));
    expect(parseFloat(getComputedStyle(scroller()).scrollPaddingTop)).toBeCloseTo(parseFloat(after), 0);
  });
});
