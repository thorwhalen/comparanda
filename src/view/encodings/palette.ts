/**
 * The encodings' swatches: a fill and the ink drawn on it, per theme.
 *
 * Finite and known before the app starts, so legibility is a test over this
 * table, not colour maths in the render path (ADR-0010 clause 6): every ink
 * clears `TEXT_CONTRAST_MIN` on its fill in both themes, which
 * `tests/encodings.test.ts` asserts. The browser suite then measures the
 * rendered cells, which is where a stylesheet mistake would show.
 *
 * Sequential steps run light to dark on the light theme and invert on the dark
 * one, each validated against its own surface (ADR-0010). Missing cells never
 * take a step of the value ramp (ADR-0010 clause 7). The value-suppressing
 * palette is not here: it is derived from a scale's arity, not listed (#91).
 */

/** A light-theme and a dark-theme `[fill, ink]` pair. */
type Pair = readonly [fill: string, ink: string];
interface Swatch { readonly light: Pair; readonly dark: Pair }

const INK_LIGHT = '#1b1d21'; // --cmp-ink, light theme
const INK_DARK = '#e6e8eb'; // --cmp-ink, dark theme
const ON_DARK_LIGHT = '#ffffff';
const ON_LIGHT_DARK = '#15171b';

export const PALETTE = /* @__PURE__ */ Object.freeze({
  // value: one hue, five steps; darker is better on the light theme, lighter on the dark.
  'seq-1': { light: ['#eef4fb', INK_LIGHT], dark: ['#1c2a3b', INK_DARK] },
  'seq-2': { light: ['#c9dcf0', INK_LIGHT], dark: ['#22406a', INK_DARK] },
  'seq-3': { light: ['#94bce3', INK_LIGHT], dark: ['#2f5f9c', INK_DARK] },
  'seq-4': { light: ['#5a92cc', INK_LIGHT], dark: ['#5b8fd1', ON_LIGHT_DARK] },
  'seq-5': { light: ['#2a64a8', ON_DARK_LIGHT], dark: ['#a9c8ee', ON_LIGHT_DARK] },
  // categorical: fixed-order hues, none of them a step of the ramp.
  'cat-1': { light: ['#fde2b8', INK_LIGHT], dark: ['#6b4a14', INK_DARK] },
  'cat-2': { light: ['#cfe6f7', INK_LIGHT], dark: ['#1f4e6e', INK_DARK] },
  'cat-3': { light: ['#c8ead9', INK_LIGHT], dark: ['#1e5a42', INK_DARK] },
  'cat-4': { light: ['#f9f1a5', INK_LIGHT], dark: ['#5c5418', INK_DARK] },
  'cat-5': { light: ['#d9cdf0', INK_LIGHT], dark: ['#3f3466', INK_DARK] },
  'cat-6': { light: ['#f6d0bf', INK_LIGHT], dark: ['#6e3523', INK_DARK] },
  'cat-7': { light: ['#ecd3e6', INK_LIGHT], dark: ['#563a54', INK_DARK] },
  'cat-8': { light: ['#e3e3e3', INK_LIGHT], dark: ['#44474d', INK_DARK] },
  // missingness: one per core reason; "not applicable" recedes toward the surface.
  'miss-not-applicable': { light: ['#f3f4f6', INK_LIGHT], dark: ['#1b1d21', INK_DARK] },
  'miss-not-assessed': { light: ['#fff1c9', INK_LIGHT], dark: ['#4a3d14', INK_DARK] },
  'miss-deferred': { light: ['#fde0c2', INK_LIGHT], dark: ['#4d3418', INK_DARK] },
  'miss-not-evidenced': { light: ['#f8d6d6', INK_LIGHT], dark: ['#4f2626', INK_DARK] },
  'miss-indeterminate': { light: ['#e4daf5', INK_LIGHT], dark: ['#3b3055', INK_DARK] },
  'miss-withheld': { light: ['#d8e0ea', INK_LIGHT], dark: ['#2c333c', INK_DARK] },
  // datum: better / same / worse than the datum, and the datum itself.
  'datum-better': { light: ['#cdeccf', INK_LIGHT], dark: ['#1f4d2a', INK_DARK] },
  'datum-same': { light: ['#e6e7ea', INK_LIGHT], dark: ['#3a3d43', INK_DARK] },
  'datum-worse': { light: ['#f6d2cc', INK_LIGHT], dark: ['#5a2620', INK_DARK] },
  'datum-self': { light: ['#d6e2f5', INK_LIGHT], dark: ['#263a57', INK_DARK] },
} as const satisfies Record<string, Swatch>);

export type SwatchId = keyof typeof PALETTE;
export type Theme = 'light' | 'dark';

export const SWATCH_IDS = /* @__PURE__ */ Object.freeze(Object.keys(PALETTE) as SwatchId[]);

/** The custom properties a theme block declares: `--cmp-sw-<id>` and `--cmp-sw-<id>-ink`. */
export function paletteVars(theme: Theme): string {
  return SWATCH_IDS.map((id) => {
    const [fill, ink] = PALETTE[id][theme];
    return `--cmp-sw-${id}: ${fill}; --cmp-sw-${id}-ink: ${ink};`;
  }).join(' ');
}

/**
 * One rule per swatch, painting a cell or a legend sample. `background-color`,
 * not `background`, so a not-applicable cell keeps its hatch beneath.
 */
export function paletteRules(scope: string): string {
  return SWATCH_IDS.map((id) =>
    // `td[...]` outranks the `td[data-state]` rules that mute an empty cell's ink, so the ink tested is the ink drawn.
    `${scope} td[data-swatch="${id}"], ${scope} .comparanda-swatch[data-swatch="${id}"] { background-color: var(--cmp-sw-${id}); color: var(--cmp-sw-${id}-ink); }`,
  ).join('\n');
}
