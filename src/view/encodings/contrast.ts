/**
 * WCAG 2.x contrast, for the build-time palette test (ADR-0010 clause 6).
 *
 * Not called on the render path: the palette is finite, so its legibility is
 * asserted in CI rather than computed per cell. The APCA tie-break and the
 * compositing helpers arrive with the value-suppressing palette (#91), as
 * separate functions that share no code with these.
 */

/** SC 1.4.3: cell text. */
export const TEXT_CONTRAST_MIN = 4.5;
/** SC 1.4.11: texture strokes, borders, focus rings, meaning-bearing glyphs. */
export const GRAPHIC_CONTRAST_MIN = 3;

/** WCAG 2.x relative luminance of a `#rrggbb` colour, with the linear toe below 0.04045. */
export function relativeLuminanceWcag(hex: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new TypeError(`expected a #rrggbb colour; got ${JSON.stringify(hex)}`);
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => {
    const s = parseInt(h!, 16) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG 2.x contrast ratio of two `#rrggbb` colours, 1 to 21. */
export function wcagContrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminanceWcag(a), relativeLuminanceWcag(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
