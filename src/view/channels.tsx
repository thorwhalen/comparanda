/**
 * The non-colour channels, drawn in the foreground (ADR-0028): a glyph for the
 * reason a cell is missing, and a hatch for how sure a value is.
 *
 * Both are inline `<svg>` with `stroke="currentColor"`, never a
 * `background-image` or a `box-shadow`: forced-colors mode recolours a
 * foreground stroke and deletes a background image, and a printer does the
 * same with backgrounds off. Both sit beside the cell's text, not under it, so
 * the text's contrast is the ink against the fill and nothing else; the stroke
 * is that same ink, which clears 4.5:1 there and so the 3:1 a graphic needs.
 *
 * Both are `aria-hidden`: the cell already says its reason and its confidence
 * in words. The shape is for the eye, and the legend keys it in words.
 */
import type { MissingCode } from '../core/schema/missingness.js';

/** What a missing cell's glyph keys on: a core reason, or a code nothing here defines. */
export type GlyphKey = MissingCode | 'undeclared';

/** The size of a channel's drawing box, in user units; the stylesheet sizes it in `em`. */
const BOX = 12;

/**
 * One shape per core reason, and one for a code nothing defines. Distinct in
 * outline, not in density or size, so no reader has to compare a cell with its
 * neighbour to tell `not-applicable` from `not-assessed` (ADR-0028).
 */
const GLYPHS: Readonly<Record<GlyphKey, { readonly d: string; readonly name: string }>> = Object.freeze({
  'not-applicable': { name: 'a dash', d: 'M2 6h8' },
  'not-assessed': { name: 'an open circle', d: 'M10 6a4 4 0 1 1-8 0a4 4 0 1 1 8 0z' },
  deferred: { name: 'two bars', d: 'M4 2.5v7M8 2.5v7' },
  'not-evidenced': { name: 'an open square', d: 'M2.5 2.5h7v7h-7z' },
  indeterminate: { name: 'a wave', d: 'M1.5 7c1.5-3 3-3 4.5 0s3 3 4.5 0' },
  withheld: { name: 'a triangle', d: 'M6 2l4.5 8h-9z' },
  undeclared: { name: 'a question mark', d: 'M4 4.5a2 2 0 1 1 3 1.7c-.8.5-1 .9-1 1.8M6 9.5v1' },
});

/** The glyph keys in the order a legend lists them: the core reasons, then the unknown. */
export const GLYPH_KEYS = Object.freeze(Object.keys(GLYPHS) as GlyphKey[]);

/** The words for a glyph's shape, for a legend: "an open circle". */
export function glyphName(key: GlyphKey): string {
  return GLYPHS[key].name;
}

/** A missing cell's glyph, drawn in the cell's own ink. */
export function Glyph({ reason }: { reason: GlyphKey }) {
  return (
    <svg
      class="comparanda-glyph" data-glyph={reason} viewBox={`0 0 ${BOX} ${BOX}`} aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
    >
      <path d={GLYPHS[reason].d} />
    </svg>
  );
}

/** Hatch density: 1 sparse, 3 dense. ADR-0028 caps it at three. */
export type HatchLevel = 1 | 2 | 3;

/** The gap between hatch lines at each level, in user units: denser is less sure. */
const HATCH_SPACING: Readonly<Record<HatchLevel, number>> = Object.freeze({ 1: 6, 2: 4, 3: 2.4 });

/** Whether an encoding's mark is a hatch level this build draws; anything else is ignored, never guessed. */
export function isHatchLevel(level: unknown, ceiling: number): level is HatchLevel {
  return (level === 1 || level === 2 || level === 3) && level <= ceiling;
}

/**
 * A small framed tile of diagonal lines beside the value. The frame makes the
 * tile a fixed area, so a density is read within one tile, not by comparing
 * the lines of two cells.
 */
export function Hatch({ level }: { level: HatchLevel }) {
  const gap = HATCH_SPACING[level];
  const lines: string[] = [];
  for (let x = -BOX + gap / 2; x < BOX; x += gap) lines.push(`M${x.toFixed(2)} ${BOX}L${(x + BOX).toFixed(2)} 0`);
  return (
    <svg
      class="comparanda-hatch" data-hatch={level} viewBox={`0 0 ${BOX} ${BOX}`} aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" stroke-width="1"
    >
      <rect x="0.5" y="0.5" width={BOX - 1} height={BOX - 1} />
      <path d={lines.join('')} />
    </svg>
  );
}
