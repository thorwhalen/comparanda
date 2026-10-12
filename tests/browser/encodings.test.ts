/**
 * Encodings in the matrix (#90): switching the encoding switches the legend,
 * painted cells keep their text legible on the colour actually rendered, in
 * both themes, and an encoding that cannot draw says so instead of drawing
 * something else.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Analysis } from '../../src/core/schema/analysis.js';
import { initialViewState, setEncoding } from '../../src/core/view-state.js';
import {
  createEncodingRegistry, mountMatrix, SHIPPED_ENCODINGS, type MatrixHandle, type MountMatrixProps,
} from '../../src/view/index.js';
import relocationJson from '../../examples/relocation.json';

const relocation = Analysis.parse(relocationJson);
/** The fixture reduces by lower-median, which refuses a nominal cell; categories need a reduction that keeps one. */
const relocationLatest = Analysis.parse({ ...relocationJson, defaultReduction: 'latest' });
const all = createEncodingRegistry(SHIPPED_ENCODINGS);

let el: HTMLElement;
const handles: MatrixHandle[] = [];
const mount = (props: MountMatrixProps, encodings = all) => {
  const handle = mountMatrix(el, props, { encodings });
  handles.push(handle);
  return handle;
};
beforeEach(() => {
  el = document.createElement('div');
  document.body.append(el);
});
afterEach(() => {
  for (const handle of handles.splice(0)) handle.destroy();
  el.remove();
});

function luminance(css: string): number {
  const [r, g, b] = css.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const contrast = (fg: string, bg: string) => {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};
const legend = () => el.querySelector<HTMLElement>('.comparanda-legend')!;
const painted = () => Array.from(el.querySelectorAll<HTMLElement>('td[data-swatch]'));

describe('switching encodings', () => {
  it('changes the legend, and the cells, with each encoding', () => {
    const handle = mount({ analysis: relocationLatest, measure: 'score' });
    expect(legend().dataset['legend']).toBe('text-only');
    expect(painted()).toHaveLength(0);
    const seen = new Set<string>();
    for (const id of ['value', 'categorical', 'missingness', 'datum']) {
      handle.update({ encoding: id });
      expect(el.querySelector('.comparanda-matrix')!.getAttribute('data-encoding')).toBe(id);
      expect(legend().dataset['legend']).toBe(id);
      expect(painted().length, id).toBeGreaterThan(0);
      seen.add(legend().textContent!);
      expect(el.querySelector('.comparanda-degraded')).toBeNull();
    }
    expect(seen.size).toBe(4);
  });

  it('follows the view state\'s encoding when no prop names one', () => {
    mount({ analysis: relocation, measure: 'score', view: setEncoding(initialViewState(relocation), 'missingness') });
    expect(legend().dataset['legend']).toBe('missingness');
  });

  it('every legend says what its texture channel does', () => {
    const handle = mount({ analysis: relocation, measure: 'score' });
    for (const id of ['text-only', 'value', 'missingness']) {
      handle.update({ encoding: id });
      expect(legend().textContent).toMatch(/texture|glyph/i);
    }
  });

  it('an encoding this build did not register falls back to text, and says so', () => {
    mount({ analysis: relocation, measure: 'score', encoding: 'value' }, createEncodingRegistry(SHIPPED_ENCODINGS.slice(0, 1)));
    expect(el.querySelector('.comparanda-degraded')!.textContent).toMatch(/"value" encoding is not available in this build/);
    expect(legend().dataset['legend']).toBe('text-only');
  });

  it('an encoding that cannot draw this analysis says why, and shows text', () => {
    mount({ analysis: relocation, measure: 'score', encoding: 'uncertainty-suppressed' });
    expect(el.querySelector('.comparanda-degraded')!.textContent).toMatch(/cannot be shown here: .*Showing values as text\./);
    expect(el.querySelector('.comparanda-matrix')!.getAttribute('data-encoding')).toBe('text-only');
    expect(painted()).toHaveLength(0);
  });
});

describe('painted cells', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`keep their text at 4.5:1 on the rendered fill, ${theme} theme`, () => {
      el.dataset['theme'] = theme;
      const handle = mount({ analysis: relocationLatest, measure: 'score' });
      for (const id of ['value', 'categorical', 'missingness', 'datum']) {
        handle.update({ encoding: id });
        expect(painted().length, id).toBeGreaterThan(0);
        for (const td of painted()) {
          const bg = getComputedStyle(td).backgroundColor;
          for (const node of [td, ...Array.from(td.querySelectorAll<HTMLElement>('.comparanda-shown, .comparanda-badge'))]) {
            expect(contrast(getComputedStyle(node).color, bg), `${id} ${td.dataset['swatch']} ${theme}`).toBeGreaterThanOrEqual(4.5);
          }
        }
        // The legend's samples are painted the same way.
        for (const sample of Array.from(legend().querySelectorAll<HTMLElement>('.comparanda-swatch[data-swatch]'))) {
          expect(contrast(getComputedStyle(sample).color, getComputedStyle(sample).backgroundColor)).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  }

  it('the datum mark is seen as a badge and heard as words', () => {
    mount({ analysis: relocation, measure: 'score', encoding: 'datum' });
    const better = el.querySelector<HTMLElement>('td[data-swatch="datum-better"]')!;
    expect(better.querySelector('.comparanda-badge')!.getAttribute('aria-hidden')).toBe('true');
    expect(better.querySelector('.comparanda-badge')!.textContent).toBe('+');
    expect(Array.from(better.querySelectorAll('.comparanda-sr')).map((s) => s.textContent).join('')).toMatch(/better than /);
  });

  it('a not-applicable cell keeps its hatch under the missingness colour', () => {
    mount({ analysis: relocation, measure: 'score', encoding: 'missingness' });
    const na = el.querySelector<HTMLElement>('td[data-glyph="not-applicable"]')!;
    expect(getComputedStyle(na).backgroundImage).toMatch(/gradient/);
  });
});
