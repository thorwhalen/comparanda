/**
 * The accessibility merge gate's checks, by number (ADR-0029, #105).
 *
 * `docs/research/sections/c7-interaction-a11y.md` is where A1-A20 came from;
 * this is the list CI reads (ADR-0029: "the suite is then authoritative"). Each
 * check is implemented once, in the runtime its mechanism needs, and each has a
 * deliberately broken fixture proving it fails on its own (`gate.ts`).
 *
 * Adding a check is adding a line here and an implementation there; the gate's
 * own test fails until both exist, so a number cannot be listed and not run.
 */

/** Where a check runs: plain Node, a real browser (vitest browser mode), or the built standalone page in Playwright. */
export type Runtime = 'node' | 'browser' | 'standalone';

export interface CheckSpec {
  readonly id: string;
  readonly title: string;
  readonly runtime: Runtime;
  /** Other runtimes that implement a second half of the same check: the mounted DOM as well as the source (#213). */
  readonly alsoIn?: readonly Runtime[];
}

/** The automated set. Titles are the research section's, shortened. */
export const AUTOMATED = [
  { id: 'A1', runtime: 'standalone', title: 'No axe-core violations on the standalone bundle, light and dark' },
  { id: 'A2', runtime: 'browser', title: 'Exactly one tab stop in the grid, after every key' },
  { id: 'A3', runtime: 'browser', title: 'No cell is announced as blank' },
  { id: 'A4', runtime: 'browser', title: 'Every missing cell says its reason code\'s phrase' },
  { id: 'A5', runtime: 'node', title: 'describeMove: start, middle, end, single-element axis, cancel' },
  { id: 'A6', runtime: 'browser', title: 'Keyboard reorder by arrow round-trips, focus kept on the handle' },
  { id: 'A7', runtime: 'browser', title: 'Keyboard reorder by Tab gives the identical order' },
  { id: 'A8', runtime: 'browser', title: 'Escape during a grab restores the order and the focus' },
  { id: 'A9', runtime: 'browser', title: 'Exactly one announcement per reorder, with the label and "of N"' },
  { id: 'A10', runtime: 'browser', title: 'A focused edge cell is never under the sticky headers' },
  { id: 'A11', runtime: 'browser', title: 'Tooltip: Escape closes it, focus stays, nothing auto-dismisses' },
  { id: 'A12', runtime: 'browser', title: 'A tooltip holds no focusable element' },
  { id: 'A13', runtime: 'browser', title: 'Composited contrast per encoding per theme' },
  { id: 'A14', runtime: 'browser', title: 'Palette steps stay apart under protan, deutan and tritan simulation' },
  { id: 'A15', runtime: 'browser', title: 'Forced colors: numeral, glyph and border survive' },
  { id: 'A16', runtime: 'node', alsoIn: ['browser'], title: 'No background-image carries meaning' },
  { id: 'A17', runtime: 'node', alsoIn: ['browser'], title: 'No aria-grabbed, no aria-dropeffect, no title= on a cell' },
  { id: 'A18', runtime: 'browser', title: 'Print: numeral and glyph present with backgrounds suppressed' },
  { id: 'A19', runtime: 'standalone', title: 'The standalone bundle makes zero network requests' },
  { id: 'A20', runtime: 'browser', title: 'prefers-reduced-motion disables animation and smooth scroll' },
] as const satisfies readonly CheckSpec[];

export type CheckId = (typeof AUTOMATED)[number]['id'];

/** The ids a runtime must implement, in order. */
export const idsFor = (runtime: Runtime): CheckId[] =>
  AUTOMATED.filter((c) => c.runtime === runtime || (c as CheckSpec).alsoIn?.includes(runtime)).map((c) => c.id);
