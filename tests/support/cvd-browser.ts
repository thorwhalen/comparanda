/**
 * The colour-vision-deficiency check on a rendered matrix (A14, ADR-0028):
 * read what each cell painted off a screenshot of it, put those colours through
 * the simulations, and say which neighbouring groups are no longer told apart.
 *
 * Shared by `tests/browser/cvd.test.ts`, which runs every supported tree, and
 * the accessibility gate (#105), which runs the hardest one and also runs it
 * against a deliberately broken palette.
 */
import { page } from '@vitest/browser/context';

import type { MatrixHandle } from '../../src/view/index.js';
import { nodeFill, VSUP_SPEC } from '../../src/view/encodings/vsup-derive.js';
import { nodeOf, vsupSwatchId, type MergeTree } from '../../src/view/encodings/vsup.js';
import { THEMES, type Theme } from '../../src/view/theme.js';
import { gridAlternative } from '../fixtures/vsup-grid.js';
import { CVD_MIN_DELTA_E, DEFICIENCIES, distance, parseHex, simulate, type Rgb8 } from './cvd.js';

/** Where a cell's own fill shows: this fraction across from its left edge, level with its middle, clear of the border and of the left-aligned numeral and glyph. */
const SAMPLE_FRACTION = 0.9;

/** The rule that keeps a tooltip out of a screenshot of a cell (#95). */
const NO_TOOLTIP = '[role="tooltip"] { display: none !important; }';

/**
 * The colour a cell painted, read from a screenshot of that cell. One screenshot
 * per cell, not one of the table: the test frame is scaled down to fit the
 * runner's window, a tall table is shrunk to a few pixels a row, and cells
 * scrolled out of view are cropped.
 */
export async function paintedColour(cell: Element): Promise<Rgb8> {
  // A tooltip shown for wherever the pointer rests can sit over the cell, and is not its fill. A rule for the
  // length of the screenshot, since the pointer can bring one in after any one-off hide.
  const style = document.createElement('style');
  style.textContent = NO_TOOLTIP;
  document.head.append(style);
  let base64: string;
  try {
    ({ base64 } = await page.elementLocator(cell).screenshot({ base64: true }));
  } finally {
    style.remove();
  }
  const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(bitmap, 0, 0);
  const [r, g, b] = context.getImageData(Math.round(bitmap.width * SAMPLE_FRACTION), Math.floor(bitmap.height / 2), 1, 1).data;
  return [r!, g!, b!];
}

/**
 * What is wrong with the palette `handle` drew for `tree` in `theme`, as
 * sentences; empty when every neighbouring pair and the root-to-surface step stay
 * at least `CVD_MIN_DELTA_E` apart under every simulation. `el` holds the matrix
 * built from `vsupGrid(tree.scoreLevels, tree.confidenceLevels)`.
 */
export async function treeFailures(el: HTMLElement, handle: MatrixHandle, tree: MergeTree, theme: Theme): Promise<string[]> {
  const { scoreLevels: k, confidenceLevels: m } = tree;
  const failures: string[] = [];
  // The fixture labels each alternative with its id; the row is found by its header.
  const cellOf = (alt: string) => Array.from(el.querySelectorAll('tbody th')).find((th) => th.textContent!.trim() === alt)!.closest('tr')!.querySelector('td')!;

  // The screenshot shows the palette. Without this the checks below could pass on a blank page.
  const painted: Rgb8[][] = [];
  for (const [layer, groups] of tree.layers.entries()) {
    painted.push([]);
    for (const [node, [level]] of groups.entries()) {
      const cell = cellOf(gridAlternative(layer, level!));
      const id = vsupSwatchId(k, m, layer, node);
      if (nodeOf(tree, level!, layer) !== node) failures.push(`${theme} ${id}: the tree places level ${level} in another group`);
      if (cell.getAttribute('data-swatch') !== id) failures.push(`${theme} ${id}: the cell carries swatch ${cell.getAttribute('data-swatch')}`);
      const rendered = await paintedColour(cell);
      const expected = parseHex(nodeFill(VSUP_SPEC, theme, tree, layer, node));
      if (rendered.some((c, i) => Math.abs(c - expected[i]!) > 1)) failures.push(`${theme} ${id}: painted ${rendered} where the palette says ${expected}`);
      painted[layer]!.push(rendered);
    }
  }
  // The surface the root is suppressed toward, as painted: the same cell with no encoding on it.
  handle.update({ encoding: 'text-only' });
  const surface = await paintedColour(cellOf(gridAlternative(0, 0)));
  if (distance(surface, parseHex(THEMES[theme].surface)) >= 1) failures.push(`${theme}: the bare cell is not the theme's surface`);

  for (const deficiency of DEFICIENCIES) {
    const seen = (c: Rgb8) => simulate(deficiency, c);
    painted.forEach((nodes, layer) => {
      for (let node = 0; node + 1 < nodes.length; node++) {
        const d = distance(seen(nodes[node]!), seen(nodes[node + 1]!));
        if (d < CVD_MIN_DELTA_E) failures.push(`${deficiency}: layer ${layer}, groups ${node} and ${node + 1} are ΔE ${d.toFixed(1)} apart; at least ${CVD_MIN_DELTA_E} is required`);
      }
    });
    const root = distance(seen(painted[0]![0]!), seen(surface));
    if (root < CVD_MIN_DELTA_E) failures.push(`${deficiency}: the root is ΔE ${root.toFixed(1)} from the surface; at least ${CVD_MIN_DELTA_E} is required`);
  }
  return failures;
}
