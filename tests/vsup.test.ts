/**
 * The value-suppressing palette and the build-time contrast test (#91,
 * ADR-0010 clauses 2, 3, 6 and 9).
 *
 * In plain Node, because the palette is finite and known before the app
 * starts: every colour either theme can paint, intermediate blends included,
 * is enumerated here and held to WCAG 2.x, with APCA breaking ties. A failure
 * is a palette bug, repaired by moving the fill (`VSUP_SPEC`), never the
 * threshold and never at render time.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { makeCellReader, vocabularyOf, type Analysis } from '../src/core/schema/analysis.js';
import { wcagContrastRatio } from '../src/view/encodings/contrast.js';
import {
  apcaLc, assertPaletteLegible, deltaE, hexToLab, interpolateLab, labToHex, pickInk, type Overlay, type PaintedSwatch,
} from '../src/view/encodings/colour.js';
import { PALETTE } from '../src/view/encodings/palette.js';
import { uncertaintySuppressed } from '../src/view/encodings/shipped.js';
import {
  deriveVsupPalette, nodeFill, renderVsupPaletteModule, sampleRamp, VSUP_SPEC, vsupTrees,
} from '../src/view/encodings/vsup-derive.js';
import { VSUP_PALETTE } from '../src/view/encodings/vsup-palette.js';
import { groupMidpoint, layerFor, layerUncertainty, mergeTree } from '../src/view/encodings/vsup.js';
import type { PreparedEncoding } from '../src/view/index.js';
import { THEMES, type Theme } from '../src/view/theme.js';
import { languagesWithConfidence } from './fixtures/confidence.js';

const THEME_NAMES = ['light', 'dark'] as const satisfies readonly Theme[];
/**
 * The translucent layers painted over a fill, where they are painted: the
 * structural-absence hatch (the theme's ink) over a missingness swatch, and the
 * confidence hatch (#102, the cell's own ink, `currentColor`) over every
 * value-suppressing node but the leaves, which are the most confident and carry
 * none. #102 draws its strokes no denser than this, or updates it.
 */
function overlays(theme: Theme) {
  return ({ id, ink }: PaintedSwatch): Overlay[] => {
    if (id.startsWith('miss-')) return [{ name: 'the absence hatch', colour: THEMES[theme].ink, alpha: THEMES[theme].hatchAlpha }];
    const node = /^vsup-\d+x(\d+)-(\d+)-\d+$/.exec(id);
    if (node && Number(node[2]) < Number(node[1]) - 1) return [{ name: 'the confidence hatch', colour: ink, alpha: THEMES[theme].hatchAlpha }];
    return [];
  };
}

describe('the ordinal merge tree', () => {
  it('for five scores and three confidences is {1}{2}{3}{4}{5} → {1,2}{3}{4,5} → {1..5}: nine colours', () => {
    const tree = mergeTree(5, 3);
    expect(tree.layers).toEqual([[[0, 4]], [[0, 1], [2, 2], [3, 4]], [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]]]);
    expect(tree.layers.flat()).toHaveLength(9);
  });

  it('every supported tree is a tree: one root, singleton leaves, each group a union of the layer below\'s', () => {
    for (const tree of vsupTrees()) {
      const { scoreLevels: k, layers } = tree;
      expect(layers[0]).toEqual([[0, k - 1]]);
      expect(layers.at(-1)).toEqual(Array.from({ length: k }, (_, i) => [i, i]));
      layers.forEach((groups, i) => {
        // A partition: contiguous, in order, covering every level once.
        expect(groups.map(([f]) => f)).toEqual([0, ...groups.slice(0, -1).map(([, l]) => l + 1)]);
        expect(groups.at(-1)![1]).toBe(k - 1);
        if (i + 1 < layers.length) {
          const edges = new Set(layers[i + 1]!.map(([, l]) => l));
          for (const [, last] of groups) expect(edges.has(last), `${k}x${tree.confidenceLevels} layer ${i}`).toBe(true);
        }
      });
    }
  });

  it('a parent sits at the midpoint of its children', () => {
    expect(groupMidpoint([0, 1], 5)).toBeCloseTo((groupMidpoint([0, 0], 5) + groupMidpoint([1, 1], 5)) / 2);
    expect(groupMidpoint([0, 4], 5)).toBe(0.5);
  });

  it('refuses a tree with fewer than two levels on either side', () => {
    expect(() => mergeTree(1, 3)).toThrow(RangeError);
    expect(() => mergeTree(5, 1)).toThrow(RangeError);
  });
});

describe('confidence, not uncertainty', () => {
  it('the least confident reading is the root, and the most confident a leaf', () => {
    // û = 1 − normalise(confidence): û = 1 is no confidence at all.
    expect(layerFor(1, 3)).toBe(0);
    expect(layerFor(0, 3)).toBe(2);
    expect(layerFor(0.5, 3)).toBe(1);
    expect(layerFor(0, 2)).toBe(1);
  });

  it('does not "fix" the root: the most uncertain colour sits (L−1)/L of the way to the surface, not at it', () => {
    expect(layerUncertainty(0, 3)).toBeCloseTo(2 / 3);
    expect(layerUncertainty(2, 3)).toBe(0);
    for (const theme of THEME_NAMES) {
      for (const tree of vsupTrees()) {
        const root = nodeFill(VSUP_SPEC, theme, tree, 0, 0);
        expect(root).not.toBe(THEMES[theme].surface);
        expect(deltaE(root, THEMES[theme].surface), `${tree.scoreLevels}x${tree.confidenceLevels} ${theme}`)
          .toBeGreaterThanOrEqual(VSUP_SPEC.rootDistinctFromSurface);
      }
    }
  });
});

describe('suppression targets the theme surface, not white', () => {
  it('the surface it moves toward is the one the stylesheet paints', () => {
    for (const theme of THEME_NAMES) expect(VSUP_SPEC.surface[theme]).toBe(THEMES[theme].surface);
  });

  it('on the dark theme a less confident cell is darker, never brighter; on the light theme lighter', () => {
    const tree = mergeTree(5, 3);
    const lightness = (theme: Theme, layer: number) => hexToLab(nodeFill(VSUP_SPEC, theme, tree, layer, tree.layers[layer]!.length - 1))[0];
    expect(lightness('dark', 0)).toBeLessThan(lightness('dark', 1));
    expect(lightness('dark', 1)).toBeLessThan(lightness('dark', 2));
    expect(lightness('light', 0)).toBeGreaterThan(lightness('light', 1));
    expect(lightness('light', 1)).toBeGreaterThan(lightness('light', 2));
  });

  it('the ramps reserve lightness headroom: neither starts or ends near black or white', () => {
    for (const theme of THEME_NAMES) {
      for (const t of [0, 1]) {
        const l = hexToLab(sampleRamp(VSUP_SPEC.ramp[theme], t))[0];
        expect(l).toBeGreaterThan(15);
        expect(l).toBeLessThan(95);
      }
    }
  });
});

describe('the build-time palette test', () => {
  it('vsup-palette.ts is the derivation, unedited (regenerate with `npx tsx scripts/emit-vsup-palette.ts`)', () => {
    const file = readFileSync(new URL('../src/view/encodings/vsup-palette.ts', import.meta.url), 'utf8');
    expect(file).toBe(renderVsupPaletteModule());
    expect(VSUP_PALETTE).toEqual(deriveVsupPalette());
  });

  for (const theme of THEME_NAMES) {
    it(`every value-suppressing swatch clears 4.5:1, under the hatch too, ${theme} theme`, () => {
      const swatches = Object.entries(VSUP_PALETTE).map(([id, s]) => ({ id, fill: s[theme][0], ink: s[theme][1] }));
      expect(swatches.length).toBeGreaterThan(9);
      expect(() => assertPaletteLegible(swatches, { theme, overlays: overlays(theme) })).not.toThrow();
    });

    it(`every static swatch clears 4.5:1, under the hatch too, ${theme} theme`, () => {
      const swatches = Object.entries(PALETTE).map(([id, s]) => ({ id, fill: s[theme][0], ink: s[theme][1] }));
      expect(() => assertPaletteLegible(swatches, { theme, overlays: overlays(theme) })).not.toThrow();
    });

    it(`every listed ink is the one the gate and the tie-break pick, ${theme} theme`, () => {
      const inks = [THEMES[theme].ink, THEMES[theme].inkInverse];
      for (const [id, s] of [...Object.entries(PALETTE), ...Object.entries(VSUP_PALETTE)]) {
        expect(pickInk(s[theme][0], inks)?.colour, `${id} ${theme}`).toBe(s[theme][1]);
      }
    });
  }

  it('tests an intermediate blend, not only the ramp\'s endpoints', () => {
    // A medium-confidence node: a ramp sample at a group midpoint, a third of the way to the surface.
    const tree = mergeTree(5, 3);
    for (const theme of THEME_NAMES) {
      const blend = interpolateLab(sampleRamp(VSUP_SPEC.ramp[theme], groupMidpoint([0, 1], 5)), THEMES[theme].surface, 1 / 3);
      expect(VSUP_PALETTE['vsup-5x3-1-0']![theme][0]).toBe(blend);
      expect(nodeFill(VSUP_SPEC, theme, tree, 1, 0)).toBe(blend);
      const ends = [0, 1].map((t) => sampleRamp(VSUP_SPEC.ramp[theme], t));
      expect([...ends, THEMES[theme].surface]).not.toContain(blend);
    }
  });

  it('an illegible palette fails, naming the swatch and the repair', () => {
    expect(() => assertPaletteLegible([{ id: 'grey', fill: '#777777', ink: '#ffffff' }], { theme: 'light' }))
      .toThrow(/grey \(light\): ink #ffffff on #777777 is 4\.48:1[\s\S]*|move the fill/);
    // A ramp with no lightness headroom crosses the band where neither ink passes.
    const crossing = { ...VSUP_SPEC, ramp: { ...VSUP_SPEC.ramp, light: [[95, 0, 0], [20, 0, 0]] as const } };
    expect(() => deriveVsupPalette(crossing)).toThrow(/no ink clears 4\.5:1/);
  });

  it('a root that has faded into the surface fails, so it can never pass for an empty cell', () => {
    const faded = { ...VSUP_SPEC, rootDistinctFromSurface: 60 };
    expect(() => deriveVsupPalette(faded)).toThrow(/within ΔE 60 of the surface/);
  });
});

describe('the contrast functions', () => {
  it('WCAG gates first and APCA only breaks ties among the inks that pass', () => {
    // The worked example: WCAG prefers dark ink here, APCA light. The gate wins.
    const inks = ['#000000', '#1a1a1a', '#ffffff', '#f5f5f5'];
    expect(Math.abs(apcaLc('#ffffff', '#6a8f7a'))).toBeGreaterThan(Math.abs(apcaLc('#000000', '#6a8f7a')));
    expect(pickInk('#6a8f7a', inks)?.colour).toBe('#000000');
    // Two passing inks: the larger |Lc| wins.
    expect(pickInk('#ffffff', ['#1a1a1a', '#000000'])?.colour).toBe('#000000');
  });

  it('an empty passing set is reported, never resolved with the least-bad ink', () => {
    expect(pickInk('#777777', ['#ffffff', '#1b1d21'])).toBeUndefined();
  });

  it('APCA keeps its polarity and its published values', () => {
    expect(apcaLc('#000000', '#ffffff')).toBeCloseTo(106.04, 1);
    expect(apcaLc('#ffffff', '#000000')).toBeCloseTo(-107.88, 1);
    expect(wcagContrastRatio('#777777', '#ffffff')).toBeCloseTo(4.478, 3);
  });

  it('Lab round-trips, and clamps out-of-gamut colours rather than measuring them', () => {
    for (const hex of ['#000000', '#ffffff', '#1d4ed8', '#6a8f7a']) expect(labToHex(hexToLab(hex))).toBe(hex);
    expect(labToHex([50, 120, -120])).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('uncertainty-suppressed', () => {
  function prepare(a: Analysis, measure = 'score') {
    const reader = makeCellReader(a, measure);
    return uncertaintySuppressed.prepare({
      analysis: a, measure, vocabulary: vocabularyOf(a),
      alternatives: a.alternatives.map((x) => x.id), criteria: a.criteria.map((x) => x.id),
      read: (alt, crit) => reader.read(alt, crit),
      readMeasure: (other, alt, crit) => makeCellReader(a, other).read(alt, crit),
      inapplicable: () => false,
    });
  }
  const ready = (a: Analysis) => {
    const p = prepare(a);
    if ('unavailable' in p) throw new Error(p.unavailable);
    return p as PreparedEncoding;
  };

  it('a high score held with high confidence is a leaf; held with low confidence, the root', () => {
    const p = ready(languagesWithConfidence());
    // rust: performance 5 at high confidence; python: ecosystem 5 at low.
    expect(p.mark('rust', 'performance')).toEqual({ swatch: 'vsup-5x3-2-4' });
    expect(p.mark('python', 'ecosystem')).toEqual({ swatch: 'vsup-5x3-0-0', hatch: 2 });
    // rust: learning-curve 1 at medium joins 2 in one colour.
    expect(p.mark('rust', 'learning-curve')).toEqual({ swatch: 'vsup-5x3-1-0', hatch: 1 });
  });

  it('carries only the swatches it uses, straight from the tested table', () => {
    const p = ready(languagesWithConfidence());
    const used = new Set(['go', 'rust', 'python', 'typescript'].flatMap((a) =>
      ['ecosystem', 'performance', 'hiring', 'learning-curve', 'tooling'].map((c) => p.mark(a, c).swatch)).filter(Boolean));
    expect(new Set(Object.keys(p.palette!))).toEqual(used);
    for (const id of used) expect(p.palette![id!]).toBe(VSUP_PALETTE[id!]);
  });

  it('a cell with no confidence recorded is left uncoloured, and the legend says so', () => {
    const p = ready(languagesWithConfidence());
    expect(p.mark('go', 'ecosystem')).toEqual({});
    expect(p.legend.notes.join(' ')).toMatch(/no confidence recorded.*left uncoloured/);
  });

  it('the legend names each colour\'s levels in words and states the aliasing', () => {
    const { legend } = ready(languagesWithConfidence());
    const labels = legend.entries.map((e) => e.label);
    expect(labels).toContain('1 or 2, medium confidence');
    expect(labels).toContain('Any score, low confidence');
    expect(legend.notes).toContain('At low confidence, every score is shown as one colour.');
    expect(legend.notes.join(' ')).toMatch(/At medium confidence, each of these is shown as one colour: 1 or 2; 4 or 5\./);
    // Clause 9: what the blend buys is a change in choices, not in reading accuracy.
    expect(legend.notes.join(' ')).toMatch(/changed which options readers chose.*not how accurately they read values/);
  });

  it('a decreasing confidence scale is read the right way round', () => {
    const p = ready(languagesWithConfidence({ measurement: { level: 'ordinal', preference: 'decreasing', levels: ['high', 'medium', 'low'] } }));
    expect(p.mark('rust', 'performance')).toEqual({ swatch: 'vsup-5x3-2-4' });
    expect(p.mark('python', 'ecosystem')).toEqual({ swatch: 'vsup-5x3-0-0', hatch: 2 });
  });

  it('cannot draw without a confidence measure, or over the confidence itself, and says why', () => {
    const plain = languagesWithConfidence();
    const without = { ...plain, measures: plain.measures.filter((m) => m.name !== 'confidence') } as Analysis;
    expect(prepare(without)).toEqual({ unavailable: expect.stringMatching(/no confidence measure/) });
    expect(prepare(plain, 'confidence')).toEqual({ unavailable: expect.stringMatching(/confidence itself/) });
  });

  it('a confidence with no ranked scale leaves the matrix to text, and says why', () => {
    const p = prepare(languagesWithConfidence({ measurement: { level: 'nominal', preference: 'none', levels: ['low', 'medium', 'high'] } }));
    expect(p).toEqual({ unavailable: expect.stringMatching(/ranked confidence/) });
  });
});
