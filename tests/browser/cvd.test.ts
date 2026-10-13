/**
 * Colour-vision-deficiency simulation against a rendered screenshot (#104,
 * ADR-0028, A14 of ADR-0029).
 *
 * The matrix is mounted for real, in each theme, with a cell for every colour
 * of every supported value-suppressing tree; a screenshot is taken; the colour
 * each cell painted is read back from its pixels; and *those* are put through
 * the simulation. Checking the palette's tokens instead would be blind to the
 * composite a reader actually sees, which is why this is a browser test.
 *
 * Two things must hold under protanopia, deuteranopia and tritanopia, for
 * every tree and both themes (`CVD_MIN_DELTA_E`): neighbouring groups within a
 * confidence layer are told apart, so a value step is not lost to colour alone,
 * and the least-confident colour is told from the bare surface, so a cell that
 * is merely uncertain never reads as an empty one. The hatch and the numeral
 * carry the same facts in other channels (ADR-0028); this is the colour channel's
 * own floor, and where a tree cannot clear it the fix is fewer value steps,
 * never a different hue.
 */
import { page } from '@vitest/browser/context';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createEncodingRegistry, mountMatrix, SHIPPED_ENCODINGS, type MatrixHandle } from '../../src/view/index.js';
import { nodeFill, VSUP_SPEC, vsupTrees } from '../../src/view/encodings/vsup-derive.js';
import { nodeOf, vsupSwatchId } from '../../src/view/encodings/vsup.js';
import { THEMES, type Theme } from '../../src/view/theme.js';
import { CVD_MIN_DELTA_E, DEFICIENCIES, distance, parseHex, simulate, type Rgb8 } from '../support/cvd.js';
import { gridAlternative, vsupGrid } from '../fixtures/vsup-grid.js';

const registry = createEncodingRegistry(SHIPPED_ENCODINGS);
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

/** Where a cell's own fill shows: this fraction across from its left edge, level with its middle, clear of the border and of the left-aligned numeral and glyph. */
const SAMPLE_FRACTION = 0.9;

/**
 * The colour a cell painted, read from a screenshot of that cell. One screenshot
 * per cell, not one of the table: the test frame is scaled down to fit the
 * runner's window, a tall table is shrunk to a few pixels a row, and cells
 * scrolled out of view are cropped.
 */
async function paintedColour(cell: Element): Promise<Rgb8> {
  const { base64 } = await page.elementLocator(cell).screenshot({ base64: true });
  const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(bitmap, 0, 0);
  const [r, g, b] = context.getImageData(Math.round(bitmap.width * SAMPLE_FRACTION), Math.floor(bitmap.height / 2), 1, 1).data;
  return [r!, g!, b!];
}

const THEME_NAMES = ['light', 'dark'] as const satisfies readonly Theme[];

describe.each(THEME_NAMES)('colour-vision deficiency, %s theme', (theme) => {
  it.each(vsupTrees().map((t) => [`${t.scoreLevels} score × ${t.confidenceLevels} confidence levels`, t] as const))(
    '%s: neighbouring groups and the root stay separable in the rendered screenshot', async (_name, tree) => {
      const { scoreLevels: k, confidenceLevels: m } = tree;
      el.dataset['theme'] = theme;
      handle = mountMatrix(el, { analysis: vsupGrid(k, m), measure: 'score', encoding: 'uncertainty-suppressed' }, { encodings: registry });
      // The fixture labels each alternative with its id; the row is found by its header.
      const cellOf = (alt: string) => Array.from(el.querySelectorAll('tbody th')).find((th) => th.textContent!.trim() === alt)!.closest('tr')!.querySelector('td')!;

      // The screenshot shows the palette. Without this the checks below could pass on a blank page.
      const painted: Rgb8[][] = [];
      for (const [layer, groups] of tree.layers.entries()) {
        painted.push([]);
        for (const [node, [level]] of groups.entries()) {
          const cell = cellOf(gridAlternative(layer, level!));
          const id = vsupSwatchId(k, m, layer, node);
          expect(nodeOf(tree, level!, layer)).toBe(node);
          expect(cell.getAttribute('data-swatch'), `${theme} ${id}`).toBe(id);
          const rendered = await paintedColour(cell);
          const expected = parseHex(nodeFill(VSUP_SPEC, theme, tree, layer, node));
          rendered.forEach((c, i) => expect(Math.abs(c - expected[i]!), `${theme} ${id} channel ${i}`).toBeLessThanOrEqual(1));
          painted[layer]!.push(rendered);
        }
      }
      // The surface the root is suppressed toward, as painted: the same cell with no encoding on it.
      handle.update({ encoding: 'text-only' });
      const surface = await paintedColour(cellOf(gridAlternative(0, 0)));
      expect(distance(surface, parseHex(THEMES[theme].surface)), `${theme} bare cell`).toBeLessThan(1);

      const failures: string[] = [];
      for (const deficiency of DEFICIENCIES) {
        const seen = (c: Rgb8) => simulate(deficiency, c);
        painted.forEach((nodes, layer) => {
          for (let node = 0; node + 1 < nodes.length; node++) {
            const d = distance(seen(nodes[node]!), seen(nodes[node + 1]!));
            if (d < CVD_MIN_DELTA_E) failures.push(`${deficiency}: layer ${layer}, groups ${node} and ${node + 1} are ΔE ${d.toFixed(1)} apart`);
          }
        });
        const root = distance(seen(painted[0]![0]!), seen(surface));
        if (root < CVD_MIN_DELTA_E) failures.push(`${deficiency}: the root is ΔE ${root.toFixed(1)} from the surface`);
      }
      expect(failures, `at least ΔE ${CVD_MIN_DELTA_E} is required`).toEqual([]);
    },
  );
});
