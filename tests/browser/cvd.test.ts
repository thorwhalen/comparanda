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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createEncodingRegistry, mountMatrix, SHIPPED_ENCODINGS, type MatrixHandle } from '../../src/view/index.js';
import { vsupTrees } from '../../src/view/encodings/vsup-derive.js';
import { SCORE_LEVELS } from '../../src/view/encodings/vsup.js';
import type { Theme } from '../../src/view/theme.js';
import { treeFailures } from '../support/cvd-browser.js';
import { vsupGrid } from '../fixtures/vsup-grid.js';

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

const THEME_NAMES = ['light', 'dark'] as const satisfies readonly Theme[];

describe.each(THEME_NAMES)('colour-vision deficiency, %s theme', (theme) => {
  it.each(vsupTrees().map((t) => [`${t.scoreLevels} score × ${t.confidenceLevels} confidence levels`, t] as const))(
    '%s: neighbouring groups and the root stay separable in the rendered screenshot', async (_name, tree) => {
      el.dataset['theme'] = theme;
      handle = mountMatrix(el, { analysis: vsupGrid(tree.scoreLevels, tree.confidenceLevels), measure: 'score', encoding: 'uncertainty-suppressed' }, { encodings: registry });
      expect(await treeFailures(el, handle, tree, theme)).toEqual([]);
    },
  );
});

describe('the supported arities', () => {
  it('a column of more score levels than the palette is built for is left uncoloured, and the legend says so', () => {
    el.dataset['theme'] = 'light';
    handle = mountMatrix(el, { analysis: vsupGrid(SCORE_LEVELS[1] + 1, 3), measure: 'score', encoding: 'uncertainty-suppressed' }, { encodings: registry });
    expect(el.querySelectorAll('td[data-swatch]')).toHaveLength(0);
    expect(el.textContent).toContain(`ranked scale of ${SCORE_LEVELS[0]} to ${SCORE_LEVELS[1]} levels`);
  });
});
