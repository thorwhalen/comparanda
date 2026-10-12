/**
 * The matrix's stylesheet, rendered inside the component so a mounted matrix is
 * styled with no CSS import, in a page, a shadow root or the standalone file.
 *
 * Everything is scoped under `.comparanda-matrix`. Colours are tokens. The
 * theme is read from the mount element, then the root: `data-theme="dark"`
 * or `"light"` on the mount element forces one; else the same attribute on
 * `<html>`; else `prefers-color-scheme` decides. Not "any ancestor": with
 * nested settings a descendant selector cannot tell which is nearest, so the
 * two places a theme is said are the ones a host actually uses. Every ink/surface pair clears 4.5:1, which the
 * browser suite measures from the rendered colours in both themes, text over
 * an inherited background included, rather than trusting this comment.
 *
 * Sticky headers follow ADR-0027: `border-collapse: separate` with rules drawn
 * as inset `box-shadow`, because collapsed borders do not travel with a sticky
 * cell. The scroll container's `scroll-padding-*` equals their extents
 * (SC 2.4.11), measured after each render by `sticky.ts` (#103), so a focused
 * cell is never scrolled under them; the header row under a band row sticks at
 * the band's measured height.
 * A cell's announced measures are visually hidden with the clip pattern, not
 * `display: none`, which would hide them from the screen reader too.
 *
 * The kinds of absence differ in shape, not only in colour (ADR-0009): a
 * structural `not-applicable` is hatched, a `not-assessed` gap has a dashed
 * frame, and every one of them also says what it is in words.
 */
import { paletteRules, paletteVars, PALETTE, type Swatch } from './encodings/palette.js';
import { THEMES, type Theme } from './theme.js';

/** `#rrggbb` at an opacity, as `rgba()`. */
function rgba(hex: string, alpha: number): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function tokens(theme: Theme): string {
  const t = THEMES[theme];
  return `
  --cmp-surface: ${t.surface}; --cmp-ink: ${t.ink}; --cmp-muted: ${t.muted};
  --cmp-header: ${t.header}; --cmp-band: ${t.band}; --cmp-rule: ${t.rule};
  --cmp-hatch: ${rgba(t.ink, t.hatchAlpha)}; --cmp-focus: ${t.focus};
  ${paletteVars(PALETTE, theme)}`;
}

/**
 * Declarations per theme, under the selectors that choose a theme: the light
 * ones on the matrix, the dark ones where a dark theme is asked for. Used for
 * the tokens below and for the swatches an encoding derives per render.
 */
export function themed(light: string, dark: string): string {
  return `
.comparanda-matrix {${light}
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) :not([data-theme="light"]) > .comparanda-matrix {${dark}
  }
}
:root[data-theme="dark"] :not([data-theme="light"]) > .comparanda-matrix,
[data-theme="dark"] > .comparanda-matrix {${dark}
}`;
}

/** The stylesheet for swatches an encoding adds to the static palette: their variables per theme, and their rules. */
export function derivedPaletteCss(palette: Readonly<Record<string, Swatch>>): string {
  return `${themed(paletteVars(palette, 'light'), paletteVars(palette, 'dark'))}
${paletteRules(palette, '.comparanda-matrix')}`;
}

export const MATRIX_CSS = `${themed(tokens('light'), tokens('dark'))}
.comparanda-matrix { color: var(--cmp-ink); background: var(--cmp-surface); }
.comparanda-matrix .comparanda-scroll {
  overflow: auto; max-height: var(--comparanda-max-height, 80vh);
  /* Focus scrolls clear of the sticky chrome (SC 2.4.11): the extents are measured by mount (sticky.ts). */
  scroll-padding-block-start: var(--cmp-sticky-block, 0px);
  scroll-padding-inline-start: var(--cmp-sticky-inline, 0px);
}
.comparanda-matrix [data-cell]:focus-visible { outline: 2px solid var(--cmp-focus); outline-offset: -2px; }
.comparanda-matrix .comparanda-keys { margin: 0 0 0.35em; color: var(--cmp-muted); font-size: 0.9em; }
.comparanda-matrix .comparanda-sr {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; border: 0;
  overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap;
}
.comparanda-matrix table { border-collapse: separate; border-spacing: 0; }
.comparanda-matrix caption { text-align: start; font-weight: 600; padding: 0.35em 0; }
.comparanda-matrix td { position: relative; }
.comparanda-matrix th, .comparanda-matrix td {
  padding: 0.35em 0.6em; line-height: 1.4; text-align: start; vertical-align: top;
  background: var(--cmp-surface); color: var(--cmp-ink);
  box-shadow: inset -1px -1px 0 var(--cmp-rule);
}
.comparanda-matrix th { background: var(--cmp-header); font-weight: 600; }
.comparanda-matrix thead th { position: sticky; top: 0; z-index: 2; }
.comparanda-matrix thead tr.comparanda-band th { white-space: nowrap; }
.comparanda-matrix thead tr.comparanda-band + tr th { top: var(--cmp-band-block, 2.1em); }
.comparanda-matrix tbody th[scope="row"] { position: sticky; inset-inline-start: 0; z-index: 1; }
.comparanda-matrix thead .comparanda-corner { inset-inline-start: 0; z-index: 3; }
.comparanda-matrix tr.comparanda-band th { background: var(--cmp-band); }
.comparanda-matrix .comparanda-also { font-weight: 400; color: var(--cmp-muted); }
.comparanda-matrix td[data-state="missing"],
.comparanda-matrix td[data-state="refused"],
.comparanda-matrix td[data-state="not-applicable"],
.comparanda-matrix td[data-state="not-assessed"] { color: var(--cmp-muted); font-style: italic; }
.comparanda-matrix td[data-state="not-applicable"],
.comparanda-matrix td[data-absence="structural"] {
  background-image: repeating-linear-gradient(135deg, var(--cmp-hatch) 0 1px, transparent 1px 7px);
}
/* Any absence counted as work outstanding (\`not-assessed\`, \`deferred\`, their extensions, an undeclared
   code) has the gap's dashed shape. */
.comparanda-matrix td[data-state="not-assessed"],
.comparanda-matrix td[data-absence="outstanding"],
.comparanda-matrix td[data-absence="undeclared"] { outline: 1px dashed var(--cmp-muted); outline-offset: -4px; }
/* Focused, the gap keeps its dashed shape: the ring takes the focus colour, not a solid line. */
.comparanda-matrix td[data-state="not-assessed"]:focus-visible,
.comparanda-matrix td[data-absence="outstanding"]:focus-visible,
.comparanda-matrix td[data-absence="undeclared"]:focus-visible { outline: 2px dashed var(--cmp-focus); }
/* An encoding's swatch paints the cell and sets the ink measured against it. Same specificity as the
   td[data-state] rules that mute an empty cell's ink, and later: keep it after them. */
${paletteRules(PALETTE, '.comparanda-matrix')}
/* On a fill, the focus ring takes the ink, which clears 4.5:1 there; the focus colour does not on every step. */
.comparanda-matrix td[data-swatch]:focus-visible { outline-color: currentColor; }
.comparanda-matrix td[data-swatch] { font-style: normal; }
.comparanda-matrix .comparanda-badge { margin-inline-start: 0.4em; font-weight: 700; }
.comparanda-matrix .comparanda-legend { margin: 0 0 0.5em; }
.comparanda-matrix .comparanda-legend-title { margin: 0 0 0.25em; font-weight: 600; }
.comparanda-matrix .comparanda-legend ul { list-style: none; padding: 0; margin: 0 0 0.25em; display: flex; flex-wrap: wrap; gap: 0.25em 1em; }
.comparanda-matrix .comparanda-swatch {
  display: inline-block; min-width: 1.6em; padding: 0 0.3em; text-align: center; font-weight: 700;
  box-shadow: inset 0 0 0 1px var(--cmp-rule);
}
.comparanda-matrix .comparanda-legend-note { margin: 0 0 0.15em; color: var(--cmp-muted); font-size: 0.9em; }
.comparanda-matrix .comparanda-degraded { color: var(--cmp-ink); }
.comparanda-matrix .comparanda-edits { list-style: none; padding: 0; margin: 0 0 0.5em; color: var(--cmp-muted); }
.comparanda-matrix .comparanda-edits button {
  font: inherit; color: var(--cmp-muted); background: var(--cmp-header);
  border: 1px dashed var(--cmp-rule); padding: 0.1em 0.5em; cursor: not-allowed;
}
@media (forced-colors: active) {
  .comparanda-matrix th, .comparanda-matrix td { box-shadow: none; border: 1px solid CanvasText; }
  .comparanda-matrix thead tr.comparanda-band + tr th { top: calc(2.1em + 2px); }
}
@media print {
  .comparanda-matrix .comparanda-scroll { overflow: visible; max-height: none; }
  .comparanda-matrix thead th, .comparanda-matrix tbody th { position: static; }
}
`;
