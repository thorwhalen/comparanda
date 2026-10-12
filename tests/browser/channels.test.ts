/**
 * The non-colour channels survive the modes that strip colour (#102, ADR-0028).
 *
 * Under `forced-colors: active` a `background-image` computes to `none` and
 * every fill is replaced; a printer drops backgrounds. So: nothing in the
 * matrix may carry meaning in a background image, the glyph and the hatch are
 * foreground strokes that forced colors recolours rather than deletes, the
 * forced-colors borders keep each cell's `terminal` style, and print is the
 * light theme with no fills, legible with `print-color-adjust` ignored.
 *
 * Forced colors and print are emulated by Playwright (`emulateMedia`, a
 * command in `vitest.browser.config.ts`); Chromium applies its forced palette
 * under that emulation, so what is read here is what such a reader sees.
 */
import { commands } from '@vitest/browser/context';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Analysis, coreReasonOf, vocabularyOf } from '../../src/index.js';
import { createEncodingRegistry, mountMatrix, SHIPPED_ENCODINGS, type MatrixHandle, type MountMatrixProps } from '../../src/view/index.js';
import languagesJson from '../../examples/languages.json';
import relocationJson from '../../examples/relocation.json';
import videoJson from '../../examples/video-generation.json';
import { languagesWithConfidence } from '../fixtures/confidence.js';

declare module '@vitest/browser/context' {
  interface BrowserCommands {
    emulateMedia(options: { forcedColors?: 'active' | 'none'; media?: 'print' | 'screen' | null }): Promise<void>;
  }
}

const all = createEncodingRegistry(SHIPPED_ENCODINGS);
const relocation = Analysis.parse(relocationJson);
const confident = languagesWithConfidence();
const FIXTURES: Record<string, Analysis> = {
  languages: Analysis.parse(languagesJson), relocation, 'video-generation': Analysis.parse(videoJson), 'languages with confidence': confident,
};

let el: HTMLElement;
const handles: MatrixHandle[] = [];
const mount = (props: MountMatrixProps) => {
  const handle = mountMatrix(el, props, { encodings: all });
  handles.push(handle);
  return handle;
};
beforeEach(() => {
  el = document.createElement('div');
  document.body.append(el);
});
afterEach(async () => {
  for (const handle of handles.splice(0)) handle.destroy();
  el.remove();
  await commands.emulateMedia({ forcedColors: 'none', media: null });
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
const TRANSPARENT = 'rgba(0, 0, 0, 0)';
/** The colour a cell is painted on: its own fill, else the matrix's, else the page's. */
function backdrop(node: Element): string {
  for (let n: Element | null = node; n; n = n.parentElement) {
    const bg = getComputedStyle(n).backgroundColor;
    if (bg !== TRANSPARENT) return bg;
  }
  return 'rgb(255, 255, 255)';
}
const cells = () => Array.from(el.querySelectorAll<HTMLElement>('td[data-cell]'));
const visible = (node: Element) => {
  const box = node.getBoundingClientRect();
  return box.width > 0 && box.height > 0 && getComputedStyle(node).visibility !== 'hidden';
};

/** Every channel a cell carries is in its foreground, drawn in a colour that clears 3:1 on what is behind it. */
function expectForegroundChannels() {
  for (const td of cells()) {
    const bg = backdrop(td);
    const shown = td.querySelector('.comparanda-shown')!;
    expect(shown.textContent!.trim(), 'a cell says something').not.toBe('');
    expect(contrast(getComputedStyle(shown).color, bg), shown.textContent!).toBeGreaterThanOrEqual(4.5);
    for (const svg of Array.from(td.querySelectorAll('svg.comparanda-glyph, svg.comparanda-hatch'))) {
      expect(visible(svg), svg.outerHTML).toBe(true);
      expect(contrast(getComputedStyle(svg).stroke, bg), svg.outerHTML).toBeGreaterThanOrEqual(3);
    }
  }
}

describe('no meaning rides on a background image (ADR-0028)', () => {
  for (const [name, analysis] of Object.entries(FIXTURES)) {
    it(`no element of the matrix has one, under any shipped encoding, either theme: ${name}`, () => {
      const handle = mount({ analysis, measure: analysis.measures[0]!.name });
      for (const theme of ['light', 'dark']) {
        el.dataset['theme'] = theme;
        for (const encoding of all.ids) {
          handle.update({ encoding });
          for (const node of Array.from(el.querySelectorAll('*'))) {
            expect(getComputedStyle(node).backgroundImage, `${encoding} ${theme} <${node.localName} class="${node.getAttribute('class') ?? ''}">`).toBe('none');
          }
        }
      }
    });
  }
});

describe('the channels are drawn', () => {
  it('every missing cell carries its core reason\'s glyph, under any encoding', () => {
    const vocabulary = vocabularyOf(relocation);
    const handle = mount({ analysis: relocation, measure: 'score' });
    for (const encoding of all.ids) {
      handle.update({ encoding });
      const missing = cells().filter((td) => td.dataset['absence'] !== undefined);
      expect(missing.length).toBeGreaterThan(0);
      for (const td of missing) {
        const glyph = td.querySelector('svg.comparanda-glyph')!;
        expect(glyph, `${encoding}: ${td.textContent}`).not.toBeNull();
        expect(glyph.getAttribute('stroke')).toBe('currentColor');
        expect(glyph.getAttribute('aria-hidden')).toBe('true');
      }
      // Valued and refused cells carry no glyph: the channel belongs to absence alone.
      for (const td of cells().filter((x) => x.dataset['absence'] === undefined)) expect(td.querySelector('svg.comparanda-glyph')).toBeNull();
    }
    // A deployment's own code shows its broader core reason's glyph.
    const custom = relocation.cells.find((c) => c.assertions.some((a) => a.missing?.code === 'not-yet-negotiated'))!;
    expect(coreReasonOf(vocabulary, 'not-yet-negotiated', custom.criterionId)).toBe('deferred');
    expect(cells().some((td) => td.dataset['glyph'] === 'deferred' && /negotiat/i.test(td.textContent!))).toBe(true);
  });

  it('the value-suppressing blend hatches its less certain cells beside the value, at the level it marks', () => {
    mount({ analysis: confident, measure: 'score', encoding: 'uncertainty-suppressed' });
    const hatched = cells().filter((td) => td.dataset['hatch'] !== undefined);
    expect(hatched.length).toBeGreaterThan(0);
    for (const td of hatched) {
      const tile = td.querySelector('svg.comparanda-hatch')!;
      expect(tile.getAttribute('data-hatch')).toBe(td.dataset['hatch']);
      expect(tile.getAttribute('stroke')).toBe('currentColor');
      // Beside the text, not under it: the text's contrast is the ink on the fill alone.
      const text = td.querySelector('.comparanda-shown')!.getBoundingClientRect();
      const box = tile.getBoundingClientRect();
      expect(box.left >= text.right - 0.5 || box.right <= text.left + 0.5 || box.top >= text.bottom - 0.5).toBe(true);
    }
    // Denser is less sure, and more lines are drawn.
    const lines = (level: string) => el.querySelector(`svg.comparanda-hatch[data-hatch="${level}"] path`)?.getAttribute('d')?.split('M').length;
    const levels = [...new Set(hatched.map((td) => td.dataset['hatch']!))].sort();
    for (let i = 1; i < levels.length; i += 1) expect(lines(levels[i]!)!).toBeGreaterThan(lines(levels[i - 1]!)!);
    // The legend keys each density shown, in words.
    const key = el.querySelector('.comparanda-legend [aria-label="Hatch key"]')!;
    expect(key.querySelectorAll('svg.comparanda-hatch')).toHaveLength(levels.length);
    expect(key.textContent).toMatch(/confident/);
    expectForegroundChannels();
  });

  it('an encoding without a hatch texture draws none, whatever its marks say', () => {
    mount({ analysis: confident, measure: 'score', encoding: 'value' });
    expect(el.querySelector('svg.comparanda-hatch')).toBeNull();
  });
});

describe('forced colors (ADR-0028)', () => {
  for (const [encoding, analysis] of [['missingness', relocation], ['uncertainty-suppressed', confident], ['text-only', relocation]] as const) {
    it(`numeral, glyph and hatch survive, and the cells keep their frame: ${encoding}`, async () => {
      await commands.emulateMedia({ forcedColors: 'active' });
      expect(matchMedia('(forced-colors: active)').matches).toBe(true);
      mount({ analysis, measure: 'score', encoding });
      // The palette really was replaced, not merely the media query matched: every fill is the one system colour.
      expect(new Set(cells().map((td) => getComputedStyle(td).backgroundColor)).size).toBe(1);
      expectForegroundChannels();
      expect(cells().some((td) => td.querySelector('svg.comparanda-glyph') || td.querySelector('svg.comparanda-hatch'))).toBe(true);
      for (const td of cells()) {
        const style = getComputedStyle(td);
        expect(style.backgroundImage).toBe('none');
        expect(style.borderTopWidth).toBe('1px');
        expect(contrast(style.borderTopColor, backdrop(td))).toBeGreaterThanOrEqual(3);
        // Width and colour restored; the style is still the cell's terminal channel.
        const outstanding = td.dataset['absence'] === 'outstanding' || td.dataset['absence'] === 'undeclared';
        expect(style.borderTopStyle, td.textContent!).toBe(outstanding ? 'dashed' : 'solid');
      }
      const note = el.querySelector('.comparanda-forced-only');
      if (encoding === 'text-only') expect(note).toBeNull();
      else expect(visible(note!)).toBe(true);
    });
  }

  it('the legend\'s samples keep the palette; nothing else opts out of the forced colours', async () => {
    await commands.emulateMedia({ forcedColors: 'active' });
    mount({ analysis: relocation, measure: 'score', encoding: 'missingness' });
    const opted = Array.from(el.querySelectorAll('*')).filter((n) => getComputedStyle(n).forcedColorAdjust === 'none');
    expect(opted.length).toBeGreaterThan(0);
    for (const n of opted) expect(n.classList.contains('comparanda-swatch'), n.outerHTML).toBe(true);
  });
});

describe('print (ADR-0028)', () => {
  for (const theme of ['light', 'dark']) {
    it(`prints the light theme with no fills, legible without print-color-adjust: ${theme} theme on screen`, async () => {
      el.dataset['theme'] = theme;
      await commands.emulateMedia({ media: 'print' });
      expect(matchMedia('print').matches).toBe(true);
      for (const [encoding, analysis] of [['missingness', relocation], ['uncertainty-suppressed', confident]] as const) {
        const handle = mountMatrix(el, { analysis, measure: 'score', encoding }, { encodings: all });
        for (const node of Array.from(el.querySelectorAll('th, td'))) {
          const style = getComputedStyle(node);
          // A printer may drop backgrounds: none is drawn, so the paper is what the text is on.
          expect(style.backgroundColor, `${encoding} ${node.textContent}`).toBe(TRANSPARENT);
          expect(style.backgroundImage).toBe('none');
          expect(style.borderTopWidth).toBe('1px');
          expect(contrast(style.color, 'rgb(255, 255, 255)'), `${encoding} ${node.textContent}`).toBeGreaterThanOrEqual(4.5);
        }
        for (const svg of Array.from(el.querySelectorAll('td svg'))) {
          expect(contrast(getComputedStyle(svg).stroke, 'rgb(255, 255, 255)')).toBeGreaterThanOrEqual(3);
        }
        expect(el.querySelectorAll('td svg').length).toBeGreaterThan(0);
        expect(visible(el.querySelector('.comparanda-print-only')!)).toBe(true);
        handle.destroy();
      }
    });
  }
});
