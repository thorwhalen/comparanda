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
 * The kinds of absence differ in shape, not only in colour (ADR-0009, ADR-0028):
 * each carries its reason's glyph, drawn in the foreground by `channels.tsx`;
 * the frame's style says whether work remains -- dashed for a gap, solid for an
 * answer -- and every one of them also says what it is in words.
 *
 * No meaning rides on a background image or a box shadow (ADR-0028): forced
 * colors deletes both, and a printer drops backgrounds. The rules here are drawn
 * as box shadows because they carry structure, not meaning, and the
 * forced-colors and print blocks replace them with real borders whose width and
 * colour they set and whose style they never touch: the style is the cell's
 * `terminal` channel. Print is the light theme with no fills, legible without
 * `print-color-adjust`, which is set only on the legend's samples, as a hint.
 * The print block takes the fill off every `td`, the analysis panels' too
 * (#292), at the band header's specificity, which also outranks a swatch's.
 */
import { paletteRules, paletteVars, PALETTE, type Swatch } from './encodings/palette.js';
import { THEMES, type Theme } from './theme.js';

function tokens(theme: Theme): string {
  const t = THEMES[theme];
  return `
  --cmp-surface: ${t.surface}; --cmp-ink: ${t.ink}; --cmp-muted: ${t.muted};
  --cmp-header: ${t.header}; --cmp-band: ${t.band}; --cmp-rule: ${t.rule};
  --cmp-focus: ${t.focus};
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
@media print {${themed(paletteVars(palette, 'light'), paletteVars(palette, 'light'))}
}
${paletteRules(palette, '.comparanda-matrix')}`;
}

/**
 * The rater dot strip's two narrower forms (ADR-0024), chosen by the strip
 * box's own width: a container query, so no script measures anything. The
 * thresholds are the encoding's (`PreparedEncoding.strip`), in `em` of the
 * cell's text, and are checked finite before they reach here.
 */
export function stripCss({ bracketBelow, hiddenBelow }: { bracketBelow: number; hiddenBelow: number }): string {
  return `
@container (max-width: ${bracketBelow}em) {
  .comparanda-matrix .comparanda-strip-dots { display: none; }
  .comparanda-matrix .comparanda-strip-bracket { display: block; }
}
@container (max-width: ${hiddenBelow}em) {
  .comparanda-matrix .comparanda-strip-bracket { display: none; }
  .comparanda-matrix .comparanda-swatch.comparanda-strip-ramp { display: block; }
}`;
}

/**
 * The matrix stylesheet. Its explanations live here, not in the CSS: a comment inside
 * the template literal ships in the standalone page (ADR-0017 clause 8), a comment out here does not.
 * For the same reason `&` stands for the scope, `.comparanda-matrix`, as it would in CSS nesting: the
 * page carries the scope once, not once per rule, and the stylesheet built is the same (#208).
 * In source order:
 * - Focus scrolls clear of the sticky chrome (SC 2.4.11): the extents are measured by mount (sticky.ts).
 * - No width here; forced colors and print give it one. The style is the terminal channel, set below.
 * - The terminal channel (ADR-0028 amendment), read from the code's own flag: an absence that is not terminal (`not-assessed`, `deferred`, their extensions, an undeclared code, a structural code declared open) has the gap's dashed shape; an answered one, the answer's solid frame. A structural, terminal absence has no frame: it reads as ground, not as a placeholder.
 * - Focused, the gap keeps its dashed shape: the ring takes the focus colour, not a solid line.
 * - The answer's frame outranks the plain ring on specificity; focused, it is the ring.
 * - An encoding's swatch paints the cell and sets the ink measured against it. Same specificity as the td[data-state] rules that mute an empty cell's ink, and later: keep it after them.
 * - On a fill, the focus ring takes the ink, which clears 4.5:1 there; the focus colour does not on every step.
 * - The strip: its box is a container (so the cell's width picks the form), as wide as one slot per level at rest.
 * - The detail panel (#94): beside the matrix when there is room, under it when not; never over it.
 * - Held in grab mode: a shape, not only a colour -- a thick dashed frame.
 * - Where a pointer drop would land: a thick rule on that side, drawn as a border so forced colors keeps it.
 * - A sticky header is its own stacking context, so the menu's z-index counts only inside it: lift the header holding an open menu above its siblings, or the next rows' headers paint over the menu.
 * - Width and colour only: the style is each cell's terminal channel (ADR-0028 amendment).
 * - The one exemption: the legend's samples, whose only job is to show the palette.
 * - Backgrounds off, whatever the printer does: the cells' fills go, their ink returns to the page's.
 */
export const MATRIX_CSS = `${themed(tokens('light'), tokens('dark'))}
& { color: var(--cmp-ink); background: var(--cmp-surface); }
& .comparanda-scroll {
  overflow: auto; max-height: var(--comparanda-max-height, 80vh); position: relative;
  scroll-padding-block-start: var(--cmp-sticky-block, 0px);
  scroll-padding-inline-start: var(--cmp-sticky-inline, 0px);
}
& [data-cell]:focus-visible { outline: 2px solid var(--cmp-focus); outline-offset: -2px; }
& .comparanda-keys { margin: 0 0 0.35em; color: var(--cmp-muted); font-size: 0.9em; }
& .comparanda-sr {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; border: 0;
  overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap;
}
& table { border-collapse: separate; border-spacing: 0; }
& caption { text-align: start; font-weight: 600; padding: 0.35em 0; }
& td { position: relative; }
& .comparanda-tip {
  position: absolute; z-index: 3; max-inline-size: 22em; padding: 0.3em 0.5em; border: 1px solid var(--cmp-ink);
  background: var(--cmp-surface); color: var(--cmp-ink); font-size: 0.9em;
}
& th, & td {
  padding: 0.35em 0.6em; line-height: 1.4; text-align: start; vertical-align: top;
  background: var(--cmp-surface); color: var(--cmp-ink);
  box-shadow: inset -1px -1px 0 var(--cmp-rule);
  border: 0 solid transparent;
}
& th { background: var(--cmp-header); font-weight: 600; }
& thead th { position: sticky; top: 0; z-index: 2; }
& thead tr.comparanda-band th { white-space: nowrap; }
& thead tr.comparanda-band + tr th { top: var(--cmp-band-block, 2.1em); }
& tbody th[scope="row"] { position: sticky; inset-inline-start: 0; z-index: 1; }
& thead .comparanda-corner { inset-inline-start: 0; z-index: 3; }
& tr.comparanda-band th { background: var(--cmp-band); }
& .comparanda-also { font-weight: 400; color: var(--cmp-muted); }
& td[data-state="missing"],
& td[data-state="refused"],
& td[data-state="not-applicable"],
& td[data-state="not-assessed"] { color: var(--cmp-muted); font-style: italic; }
& td[data-terminal="false"] { outline: 1px dashed var(--cmp-muted); outline-offset: -4px; border-style: dashed; }
& td[data-terminal="true"]:not([data-absence="structural"]) { outline: 1px solid var(--cmp-muted); outline-offset: -4px; }
& td[data-terminal="false"]:focus-visible { outline: 2px dashed var(--cmp-focus); }
& td[data-terminal="true"]:focus-visible { outline: 2px solid var(--cmp-focus); outline-offset: -2px; }
${paletteRules(PALETTE, '&')}
& td[data-swatch]:focus-visible { outline-color: currentColor; }
& td[data-swatch] { font-style: normal; }
& .comparanda-badge { margin-inline-start: 0.4em; font-weight: 700; }
& .comparanda-glyph, & .comparanda-hatch {
  display: inline-block; width: 0.9em; height: 0.9em; vertical-align: -0.1em; overflow: hidden;
}
& td .comparanda-glyph { margin-inline-end: 0.35em; }
& .comparanda-strip-box { display: block; container-type: inline-size; inline-size: calc(var(--k) * 0.8em); max-inline-size: 100%; margin-block-start: 0.15em; }
& .comparanda-strip-dots, & .comparanda-strip-bracket { display: block; inline-size: 100%; block-size: auto; }
& .comparanda-strip-bracket { display: none; }
& .comparanda-swatch.comparanda-strip-ramp { display: none; min-width: 0; padding: 0; inline-size: 100%; block-size: 0.7em; box-shadow: inset 0 0 0 1px currentColor; }
& td .comparanda-hatch { margin-inline-start: 0.4em; }
& .comparanda-key { list-style: none; padding: 0; margin: 0 0 0.25em; display: flex; flex-wrap: wrap; gap: 0.25em 1em; }
& .comparanda-forced-only, & .comparanda-print-only { display: none; }
& .comparanda-legend { margin: 0 0 0.5em; }
& .comparanda-legend-title { margin: 0 0 0.25em; font-weight: 600; }
& .comparanda-legend ul { list-style: none; padding: 0; margin: 0 0 0.25em; display: flex; flex-wrap: wrap; gap: 0.25em 1em; }
& .comparanda-swatch {
  display: inline-block; min-width: 1.6em; padding: 0 0.3em; text-align: center; font-weight: 700;
  box-shadow: inset 0 0 0 1px var(--cmp-rule);
}
& .comparanda-legend-note { margin: 0 0 0.15em; color: var(--cmp-muted); font-size: 0.9em; }
& .comparanda-degraded { color: var(--cmp-ink); }
& .comparanda-notice { color: var(--cmp-ink); border: 2px solid var(--cmp-ink); padding: 0.4em 0.6em; margin: 0 0 0.5em; }
& .comparanda-notice p { margin: 0 0 0.3em; }
& .comparanda-edits { list-style: none; padding: 0; margin: 0 0 0.5em; color: var(--cmp-muted); }
& .comparanda-edits button {
  font: inherit; color: var(--cmp-muted); background: var(--cmp-header);
  border: 1px dashed var(--cmp-rule); padding: 0.1em 0.5em; cursor: not-allowed;
}
& .comparanda-body { display: flex; flex-wrap: wrap; gap: 0.75em; align-items: flex-start; }
& .comparanda-body > .comparanda-scroll { flex: 1 1 28em; min-width: 0; }
& .comparanda-panel {
  flex: 0 1 24em; min-width: min(100%, 16em); max-height: var(--comparanda-max-height, 80vh); overflow: auto;
  padding: 0.5em 0.75em; box-shadow: inset 0 0 0 1px var(--cmp-rule); border: 0 solid transparent;
}
& .comparanda-panel-head { display: flex; gap: 0.5em; align-items: baseline; justify-content: space-between; }
& .comparanda-panel h2 { font-size: 1.05em; margin: 0; }
& .comparanda-panel h3 { font-size: 1em; margin: 0.75em 0 0.25em; }
& :is(.comparanda-panel, .comparanda-suggestions, .comparanda-saved-views) h2:focus-visible { outline: 2px solid var(--cmp-focus); }
& .comparanda-panel-kind, & .comparanda-panel-hint,
& .comparanda-provenance, & .comparanda-check { color: var(--cmp-muted); font-weight: 400; }
& .comparanda-panel-hint { font-size: 0.9em; margin: 0.25em 0; }
& .comparanda-panel button {
  font: inherit; color: var(--cmp-ink); background: var(--cmp-header); border: 1px solid var(--cmp-rule); padding: 0.1em 0.5em;
}
& :is(.comparanda-panel, .comparanda-suggestions, .comparanda-saved-views) :is(button, a):focus-visible { outline: 2px solid var(--cmp-focus); outline-offset: 1px; }
& .comparanda-panel a { color: var(--cmp-ink); text-decoration: underline; }
& .comparanda-panel-facts { display: grid; grid-template-columns: max-content 1fr; gap: 0.2em 0.75em; margin: 0.5em 0; }
& .comparanda-panel-facts dt { font-weight: 600; grid-column: 1; }
& .comparanda-panel-facts dd { margin: 0; grid-column: 2; }
& .comparanda-panel p { margin: 0.25em 0; }
& .comparanda-assertions { padding-inline-start: 1.25em; margin: 0; }
& .comparanda-assertions > li { margin: 0 0 0.6em; }
& .comparanda-assertions > li[data-superseded] { color: var(--cmp-muted); }
& .comparanda-evidence { padding-inline-start: 1em; margin: 0.25em 0; }
& .comparanda-panel blockquote { margin: 0.2em 0 0.2em 0.5em; padding-inline-start: 0.5em; border-inline-start: 2px solid var(--cmp-rule); }
& .comparanda-distribution { margin: 0.5em 0; }
& .comparanda-bar { display: flex; max-width: 18em; }
& .comparanda-bar span {
  flex-basis: 0; min-width: 0; overflow: hidden; white-space: nowrap; text-align: center; background: var(--cmp-header); color: var(--cmp-ink);
  box-shadow: inset 0 0 0 1px var(--cmp-rule); padding: 0.1em 0; border: 0 solid transparent;
}
& .comparanda-bar span:empty { visibility: hidden; }
& .comparanda-bar span[data-neutral] { font-weight: 700; text-decoration: underline; }
& .comparanda-thread-mark { margin-inline-start: 0.35em; font-size: 0.85em; font-weight: 600; white-space: nowrap; }
& .comparanda-thread-icon { display: inline-block; width: 0.9em; height: 0.9em; vertical-align: -0.1em; margin-inline-end: 0.1em; }
& .comparanda-thread-list, & .comparanda-comments { padding-inline-start: 1.1em; margin: 0.25em 0; }
& .comparanda-thread-list > li { margin: 0 0 0.6em; }
& .comparanda-orphans { border: 1px solid var(--cmp-muted); padding: 0.4em 0.8em; margin: 0 0 0.75em; }
& .comparanda-orphans h2 { font-size: 1em; margin: 0.2em 0; }
& .comparanda-saved-views { border: 1px solid var(--cmp-muted); padding: 0.4em 0.8em; margin: 0 0 0.75em; }
& .comparanda-saved-views h2 { font-size: 1em; margin: 0.2em 0; }
& .comparanda-saved-views input {
  font: inherit; color: var(--cmp-ink); background: var(--cmp-surface); border: 1px solid var(--cmp-muted); padding: 0.2em 0.35em;
}
& .comparanda-saved-views input:focus-visible { outline: 2px solid var(--cmp-focus); outline-offset: 1px; }
& .comparanda-saved-views button[aria-disabled="true"] { color: var(--cmp-muted); }
& .comparanda-analysis { border: 1px solid var(--cmp-muted); padding: 0.4em 0.8em; margin: 0.75em 0 0; }
& .comparanda-analysis-table { border-collapse: collapse; margin: 0.4em 0; }
& .comparanda-analysis-table :is(th, td) { border: 1px solid var(--cmp-muted); padding: 0.15em 0.4em; text-align: start; }
& .comparanda-thread-list[data-resolved] { color: var(--cmp-muted); }
& .comparanda-compose { display: grid; gap: 0.2em; margin: 0.35em 0; }
& .comparanda-compose button { justify-self: start; }
& .comparanda-panel :is(textarea, select) {
  font: inherit; color: var(--cmp-ink); background: var(--cmp-surface); border: 1px solid var(--cmp-muted); padding: 0.2em 0.35em;
}
& .comparanda-panel :is(textarea, select):focus-visible { outline: 2px solid var(--cmp-focus); outline-offset: 1px; }
& .comparanda-panel button[aria-disabled="true"] { color: var(--cmp-muted); cursor: progress; }
& .comparanda-suggestions .comparanda-compose button[aria-disabled="true"] { color: var(--cmp-muted); cursor: progress; }
& :is(.comparanda-panel, .comparanda-suggestions, .comparanda-saved-views) [role="alert"] { color: var(--cmp-ink); font-weight: 600; }
& .comparanda-handle {
  font: inherit; color: var(--cmp-muted); background: none; border: 0; padding: 0 0.15em; margin-inline-end: 0.2em;
  cursor: grab; touch-action: none; vertical-align: baseline;
}
& .comparanda-handle:hover, & .comparanda-handle[aria-expanded="true"] { color: var(--cmp-ink); }
& .comparanda-handle[data-dragging] { cursor: grabbing; }
& th[data-grabbed] { outline: 3px dashed var(--cmp-focus); outline-offset: -3px; }
& th[data-drop="before"][scope="col"] { border-inline-start-width: 4px; border-color: var(--cmp-focus); }
& th[data-drop="after"][scope="col"] { border-inline-end-width: 4px; border-color: var(--cmp-focus); }
& th[data-drop="before"][scope="row"] { border-top-width: 4px; border-color: var(--cmp-focus); }
& th[data-drop="after"][scope="row"] { border-bottom-width: 4px; border-color: var(--cmp-focus); }
& .comparanda-menu {
  position: absolute; z-index: 4; inset-inline-start: 0; top: 100%; margin: 0; padding: 0.2em 0; list-style: none;
  min-width: 12em; max-height: 18em; overflow: auto; font-weight: 400; white-space: nowrap;
  background: var(--cmp-surface); color: var(--cmp-ink); border: 1px solid var(--cmp-muted);
}
& thead th[data-menu-open], & tbody th[data-menu-open] { z-index: 5; }
& .comparanda-menu [role="menuitem"] { padding: 0.15em 0.6em; cursor: pointer; }
& .comparanda-menu [role="menuitem"]:focus { outline: 2px solid var(--cmp-focus); outline-offset: -2px; }
& .comparanda-arrange p { margin: 0 0 0.25em; color: var(--cmp-muted); font-size: 0.9em; }
& .comparanda-grouping p { margin: 0 0 0.35em; }
& th[aria-selected="true"]::before { content: "\\2713\\a0"; content: "\\2713\\a0" / ""; }
& .comparanda-block-note { font-size: 0.9em; }
& .comparanda-arrange button {
  font: inherit; color: var(--cmp-ink); background: var(--cmp-header); border: 1px solid var(--cmp-rule); padding: 0.05em 0.45em;
}
& .comparanda-arrange button:focus-visible { outline: 2px solid var(--cmp-focus); outline-offset: 1px; }
@media (forced-colors: active) {
  & th, & td { box-shadow: none; border-width: 1px; border-color: CanvasText; }
  & thead tr.comparanda-band + tr th { top: calc(2.1em + 2px); }
  & .comparanda-swatch { forced-color-adjust: none; }
  & .comparanda-forced-only { display: block; }
  & .comparanda-panel, & .comparanda-bar span { border-width: 1px; border-color: CanvasText; }
  & th[data-drop] { border-color: Highlight; }
}
@media print {${themed(tokens('light'), tokens('light'))}
  & .comparanda-scroll { overflow: visible; max-height: none; }
  & thead th, & tbody th { position: static; }
  & th, & :is(td, tr.comparanda-band th) {
    background: none; box-shadow: none; border-width: 1px; border-color: var(--cmp-muted);
  }
  & tbody td[data-swatch] { color: var(--cmp-ink); }
  & .comparanda-swatch { print-color-adjust: exact; -webkit-print-color-adjust: exact; outline: 1px solid var(--cmp-ink); }
  & .comparanda-print-only { display: block; }
}
`.replace(/&/g, '.comparanda-matrix');
