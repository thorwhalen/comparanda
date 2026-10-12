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
  createEncodingRegistry, defineEncoding, mountMatrix, SHIPPED_ENCODINGS, type MatrixHandle, type MountMatrixProps,
} from '../../src/view/index.js';
import { VSUP_PALETTE } from '../../src/view/encodings/vsup-palette.js';
import relocationJson from '../../examples/relocation.json';
import { languagesWithConfidence } from '../fixtures/confidence.js';

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

describe('the value-suppressing blend, painted', () => {
  const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
  for (const theme of ['light', 'dark'] as const) {
    it(`paints the tested table's fill and ink, legible and focusable, ${theme} theme`, () => {
      el.dataset['theme'] = theme;
      mount({ analysis: languagesWithConfidence(), measure: 'score', encoding: 'uncertainty-suppressed' });
      expect(el.querySelector('.comparanda-matrix')!.getAttribute('data-encoding')).toBe('uncertainty-suppressed');
      expect(painted().length).toBeGreaterThan(0);
      const samples = Array.from(legend().querySelectorAll<HTMLElement>('.comparanda-swatch[data-swatch]'));
      expect(samples.length).toBeGreaterThan(0);
      for (const node of [...painted(), ...samples]) {
        const [fill, ink] = VSUP_PALETTE[node.dataset['swatch']!]![theme];
        const style = getComputedStyle(node);
        expect(style.backgroundColor, node.dataset['swatch']).toBe(rgb(fill));
        expect(style.color, node.dataset['swatch']).toBe(rgb(ink));
        expect(contrast(style.color, style.backgroundColor)).toBeGreaterThanOrEqual(4.5);
      }
      for (const td of painted()) {
        td.focus();
        const style = getComputedStyle(td);
        expect(contrast(style.outlineColor, style.backgroundColor), td.dataset['swatch']).toBeGreaterThanOrEqual(3);
      }
    });
  }

  it('on the dark theme a low-confidence cell recedes into the surface instead of brightening', () => {
    el.dataset['theme'] = 'dark';
    mount({ analysis: languagesWithConfidence(), measure: 'score', encoding: 'uncertainty-suppressed' });
    const bg = (swatch: string) => getComputedStyle(el.querySelector<HTMLElement>(`td[data-swatch="${swatch}"]`)!).backgroundColor;
    const surface = getComputedStyle(el.querySelector('.comparanda-matrix')!).backgroundColor;
    // A 5 at high confidence, and any score at low.
    expect(luminance(bg('vsup-5x3-0-0'))).toBeLessThan(luminance(bg('vsup-5x3-2-4')));
    expect(luminance(bg('vsup-5x3-0-0'))).toBeGreaterThan(luminance(surface));
  });

  it('a cell with no confidence is left plain', () => {
    mount({ analysis: languagesWithConfidence(), measure: 'score', encoding: 'uncertainty-suppressed' });
    const go = Array.from(el.querySelectorAll<HTMLElement>('tbody tr')).find((tr) => /Go/.test(tr.querySelector('th')!.textContent!))!;
    expect(go.querySelectorAll('td[data-swatch]')).toHaveLength(0);
  });
});

describe('an encoding\'s own palette', () => {
  const withPalette = (palette: unknown) => defineEncoding({
    id: 'own-palette', label: 'Own palette', texture: { channel: 'none', because: 'a test.' },
    prepare: () => ({ legend: { title: 'Own', entries: [], notes: [] }, mark: () => ({}), palette: palette as never }),
  });
  const cases: [string, unknown][] = [
    ['a static swatch\'s id, which would repaint it page-wide', { 'seq-5': { light: ['#ff0000', '#000000'], dark: ['#ff0000', '#000000'] } }],
    ['a colour that is not #rrggbb', { 'mine-1': { light: ['red; } body { display: none', '#000000'], dark: ['#000000', '#ffffff'] } }],
  ];
  for (const [what, palette] of cases) {
    it(`with ${what} falls back to text, and no stylesheet is written for it`, () => {
      mount({ analysis: relocation, measure: 'score', encoding: 'own-palette' }, createEncodingRegistry([...SHIPPED_ENCODINGS, withPalette(palette)]));
      expect(el.querySelector('.comparanda-matrix')!.getAttribute('data-encoding')).toBe('text-only');
      expect(el.querySelectorAll('.comparanda-matrix style')).toHaveLength(1);
    });
  }
});

describe('an encoding that throws', () => {
  const broken = (where: 'prepare' | 'mark') => defineEncoding({
    id: `broken-${where}`, label: `Broken ${where}`, texture: { channel: 'none', because: 'a test.' },
    prepare: () => {
      if (where === 'prepare') throw new Error('prepare failed');
      return { legend: { title: 'Broken', entries: [], notes: [] }, mark: () => { throw new Error('mark failed'); } };
    },
  });
  for (const [what, entries] of [['a null entry', [null]], ['an entry with no words', [{ swatch: 'seq-5', label: { x: 1 } }]]] as const) {
    it(`with ${what} in its legend falls back rather than blanking the matrix or drawing colour alone`, () => {
      const odd = defineEncoding({
        id: 'odd-legend', label: 'Odd legend', texture: { channel: 'none', because: 'a test.' },
        prepare: () => ({ legend: { title: 'Odd', entries: entries as never, notes: [] }, mark: () => ({}) }),
      });
      mount({ analysis: relocation, measure: 'score', encoding: 'odd-legend' }, createEncodingRegistry([...SHIPPED_ENCODINGS, odd]));
      expect(el.querySelector('.comparanda-degraded')!.textContent).toMatch(/its legend is not/);
      expect(el.querySelectorAll('td').length).toBe(relocation.alternatives.length * relocation.criteria.length);
    });
  }
  for (const where of ['prepare', 'mark'] as const) {
    it(`in ${where} falls back to text and says so, rather than blanking the matrix`, () => {
      const handle = mount({ analysis: relocation, measure: 'score' }, createEncodingRegistry([...SHIPPED_ENCODINGS, broken(where)]));
      handle.update({ encoding: `broken-${where}` });
      expect(el.querySelector('.comparanda-degraded')!.textContent).toMatch(new RegExp(`cannot be shown here: it failed \\(${where} failed\\)`));
      expect(el.querySelectorAll('td').length).toBe(relocation.alternatives.length * relocation.criteria.length);
      expect(legend().dataset['legend']).toBe('text-only');
    });
  }
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

  for (const theme of ['light', 'dark'] as const) {
    it(`a focused painted cell keeps its focus ring at 3:1 on the fill, ${theme} theme`, () => {
      el.dataset['theme'] = theme;
      const handle = mount({ analysis: relocationLatest, measure: 'score' });
      for (const id of ['value', 'categorical', 'missingness', 'datum']) {
        handle.update({ encoding: id });
        for (const td of painted()) {
          td.focus();
          const style = getComputedStyle(td);
          expect(style.outlineStyle, `${id} ${td.dataset['swatch']}`).not.toBe('none');
          expect(contrast(style.outlineColor, style.backgroundColor), `${id} ${td.dataset['swatch']} ${theme}`).toBeGreaterThanOrEqual(3);
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

  it('an empty cell draws the palette\'s ink, not the muted one, so the tested pair is the drawn pair', () => {
    el.dataset['theme'] = 'light';
    mount({ analysis: relocation, measure: 'score', encoding: 'missingness' });
    const deferred = el.querySelector<HTMLElement>('td[data-swatch="miss-deferred"]')!;
    expect(getComputedStyle(deferred).color).toBe('rgb(27, 29, 33)');
    // The glyph is drawn, in that same ink, and the legend keys it in words.
    expect(deferred.querySelector('svg.comparanda-glyph')!.getAttribute('data-glyph')).toBe('deferred');
    expect(legend().querySelector('[data-glyph-key="deferred"]')!.textContent).toMatch(/Deferred \(two bars\)/);
  });

  it('a not-applicable cell keeps its glyph, not a background image, under the missingness colour', () => {
    mount({ analysis: relocation, measure: 'score', encoding: 'missingness' });
    const na = el.querySelector<HTMLElement>('td[data-glyph="not-applicable"]')!;
    expect(na.querySelector('svg.comparanda-glyph')).not.toBeNull();
    expect(getComputedStyle(na).backgroundImage).toBe('none');
  });
});
