/**
 * Colour maths for building and testing palettes (ADR-0010 clause 6), never
 * for drawing a cell: the palette is finite, so its colours and the ink on
 * each are computed ahead of time (`vsup-palette.ts` is the output) and their
 * legibility is asserted in CI. Nothing on the render path imports this.
 *
 * - CIELAB (D65) conversion and interpolation, for the value-suppressing
 *   blend, which suppresses in Lab and is gamut-clamped back to sRGB *before*
 *   anything is measured, so what is measured is a colour a screen can show.
 * - Compositing in gamma-encoded sRGB, as browsers do, for overlays.
 * - APCA Lc, the tie-break. Its luminance is `screenLuminanceApca`, which
 *   shares no code with `relativeLuminanceWcag` (`contrast.ts`): a plain 2.4
 *   exponent, longer coefficients and a low-luminance clamp, where WCAG has a
 *   linear toe. Reusing either for the other is wrong in both.
 * - `pickInk`: gate on WCAG 2.x, then the largest |Lc| among the survivors.
 *   An empty passing set is returned as `undefined`, never papered over with
 *   the least-bad ink: that is a palette bug, repaired by moving the fill.
 */
import { TEXT_CONTRAST_MIN, wcagContrastRatio } from './contrast.js';

/** An sRGB colour, 0-255 per channel, possibly out of gamut until clamped. */
export type Rgb = readonly [r: number, g: number, b: number];
/** A CIELAB colour, D65 white. */
export type Lab = readonly [l: number, a: number, b: number];

export function hexToRgb(hex: string): Rgb {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new TypeError(`expected a #rrggbb colour; got ${JSON.stringify(hex)}`);
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}

/** Clamp to the sRGB gamut and round to 8 bits: the colour a screen shows. */
export function rgbToHex(rgb: Rgb): string {
  return `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')}`;
}

// D65 reference white, and the sRGB <-> XYZ matrices (IEC 61966-2-1).
const WHITE = [0.95047, 1, 1.08883] as const;
const EPSILON = 216 / 24389;
const KAPPA = 24389 / 27;

function toLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function fromLinear(c: number): number {
  return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
}

export function hexToLab(hex: string): Lab {
  const [r, g, b] = hexToRgb(hex).map(toLinear) as [number, number, number];
  const xyz = [
    0.4124564 * r + 0.3575761 * g + 0.1804375 * b,
    0.2126729 * r + 0.7151522 * g + 0.072175 * b,
    0.0193339 * r + 0.119192 * g + 0.9503041 * b,
  ].map((v, i) => v / WHITE[i]!);
  const [fx, fy, fz] = xyz.map((t) => (t > EPSILON ? Math.cbrt(t) : (KAPPA * t + 16) / 116)) as [number, number, number];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Lab to the nearest 8-bit sRGB colour, clamped into gamut. */
export function labToHex([l, a, b]: Lab): string {
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inv = (f: number) => (f ** 3 > EPSILON ? f ** 3 : (116 * f - 16) / KAPPA);
  const [x, y, z] = [inv(fx) * WHITE[0], (l > KAPPA * EPSILON ? fy ** 3 : l / KAPPA) * WHITE[1], inv(fz) * WHITE[2]];
  const rgb: Rgb = [
    3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
    -0.969266 * x + 1.8760108 * y + 0.041556 * z,
    0.0556434 * x - 0.2040259 * y + 1.0572252 * z,
  ].map((c) => fromLinear(Math.min(1, Math.max(0, c)))) as unknown as Rgb;
  return rgbToHex(rgb);
}

/** Interpolate from `from` toward `to` by `t` in CIELAB; the result is gamut-clamped sRGB. */
export function interpolateLab(from: string, to: string, t: number): string {
  const [a, b] = [hexToLab(from), hexToLab(to)];
  return labToHex([0, 1, 2].map((i) => a[i]! + (b[i]! - a[i]!) * t) as unknown as Lab);
}

/** Euclidean distance in CIELAB (ΔE*76): about 2.3 is a just-noticeable difference. */
export function deltaE(x: string, y: string): number {
  const [a, b] = [hexToLab(x), hexToLab(y)];
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** A translucent layer painted over a cell: a stripe, a hover, a hatch. */
export interface Overlay {
  readonly name: string;
  readonly colour: string;
  readonly alpha: number;
}

/** `overlay` painted over `below`, composited in gamma-encoded sRGB as browsers do. */
export function composite(below: string, overlay: Overlay): string {
  const [top, under] = [hexToRgb(overlay.colour), hexToRgb(below)];
  return rgbToHex(top.map((c, i) => overlay.alpha * c + (1 - overlay.alpha) * under[i]!) as unknown as Rgb);
}

/**
 * APCA screen luminance (apca-w3 0.1.9): a plain 2.4 exponent, no linear toe,
 * and the reference implementation's coefficients. Deliberately not
 * `relativeLuminanceWcag`.
 */
export function screenLuminanceApca(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => (c / 255) ** 2.4) as [number, number, number];
  return 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
}

/** APCA Lc of `text` on `background`: positive for dark on light, negative for light on dark. */
export function apcaLc(text: string, background: string): number {
  const clamp = (y: number) => (y <= 0.022 ? y + (0.022 - y) ** 1.414 : y);
  const [yt, yb] = [clamp(screenLuminanceApca(text)), clamp(screenLuminanceApca(background))];
  if (Math.abs(yb - yt) < 0.0005) return 0;
  if (yb > yt) {
    const s = (yb ** 0.56 - yt ** 0.57) * 1.14;
    return (s < 0.1 ? 0 : s - 0.027) * 100;
  }
  const s = (yb ** 0.65 - yt ** 0.62) * 1.14;
  return (s > -0.1 ? 0 : s + 0.027) * 100;
}

export interface Ink {
  readonly colour: string;
  readonly wcag: number;
  readonly lc: number;
}

/**
 * The ink for a painted background: among `candidates` clearing `minRatio`
 * (WCAG 2.x) on it, the one with the largest |Lc|. `undefined` when none
 * clears: a palette bug for the caller to report, not a case to fall back on.
 * `background` must already be composited and clamped.
 */
export function pickInk(
  background: string,
  candidates: readonly string[],
  { minRatio = TEXT_CONTRAST_MIN }: { minRatio?: number } = {},
): Ink | undefined {
  return candidates
    .map((colour) => ({ colour, wcag: wcagContrastRatio(colour, background), lc: Math.abs(apcaLc(colour, background)) }))
    .filter((ink) => ink.wcag >= minRatio)
    .reduce<Ink | undefined>((best, ink) => (best === undefined || ink.lc > best.lc ? ink : best), undefined);
}

/** A fill, the ink drawn on it, and a name to report it by. */
export interface PaintedSwatch {
  readonly id: string;
  readonly fill: string;
  readonly ink: string;
}

/**
 * Throws, naming every offending swatch, unless each one's ink clears
 * `TEXT_CONTRAST_MIN` on its fill and on its fill under every overlay. Texture,
 * focus ring and glyph are drawn in the ink (`currentColor`), so the same pair
 * clears `GRAPHIC_CONTRAST_MIN` for them a fortiori. The repair for a failure
 * moves the fill, never the threshold.
 */
export function assertPaletteLegible(
  swatches: readonly PaintedSwatch[],
  { theme, overlays = [] }: {
    theme: string;
    /** The layers painted over a fill, for every swatch or per swatch: only where they are actually drawn. */
    overlays?: readonly Overlay[] | ((swatch: PaintedSwatch) => readonly Overlay[]);
  },
): void {
  const failures: string[] = [];
  for (const s of swatches) {
    const over = typeof overlays === 'function' ? overlays(s) : overlays;
    for (const [under, bg] of [['', s.fill] as const, ...over.map((o) => [` under ${o.name}`, composite(s.fill, o)] as const)]) {
      const ratio = wcagContrastRatio(s.ink, bg);
      if (ratio < TEXT_CONTRAST_MIN) {
        failures.push(`${s.id} (${theme}${under}): ink ${s.ink} on ${bg} is ${ratio.toFixed(2)}:1, under ${TEXT_CONTRAST_MIN}:1`);
      }
    }
  }
  if (failures.length > 0) {
    throw new Error(`palette not legible -- move the fill, not the threshold:\n  ${failures.join('\n  ')}`);
  }
}
