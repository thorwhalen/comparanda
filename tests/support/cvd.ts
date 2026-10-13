/**
 * Colour-vision-deficiency simulation for the accessibility gate (#104, ADR-0028).
 *
 * Test-only: nothing here is imported by `src`, so it adds no page bytes.
 *
 * Viénot, Brettel & Mollon (1999) for protan and deutan, and Brettel, Viénot &
 * Mollon (1997) for tritan, which the others were not designed for. Never the
 * Coblis V1 matrices. sRGB is decoded to linear light before any matrix is
 * applied and re-encoded after: the right matrix on gamma-encoded sRGB is the
 * common failure. The numbers are those of libDaltonLens (DaltonLens, 2021),
 * which is unit-tested against the reference implementations.
 */
export type Deficiency = 'protan' | 'deutan' | 'tritan';
export const DEFICIENCIES: readonly Deficiency[] = ['protan', 'deutan', 'tritan'];

/** 8-bit sRGB, as read from a screenshot. */
export type Rgb8 = readonly [r: number, g: number, b: number];
type Matrix = readonly number[];

/** Viénot 1999, in linear RGB. */
const VIENOT: Record<'protan' | 'deutan', Matrix> = {
  protan: [0.11238, 0.88762, 0, 0.11238, 0.88762, 0, 0.00401, -0.00401, 1],
  deutan: [0.29275, 0.70725, 0, 0.29275, 0.70725, 0, -0.02234, 0.02234, 1],
};

/** Brettel 1997: the projection onto either half-plane of the dichromat's reduced gamut, chosen by the sign of `normal · rgb`. */
const BRETTEL_TRITAN = {
  positive: [1.01277, 0.13548, -0.14826, -0.01243, 0.86812, 0.14431, 0.07589, 0.805, 0.11911],
  negative: [0.93678, 0.18979, -0.12657, 0.06154, 0.81526, 0.1232, -0.37562, 1.12767, 0.24796],
  normal: [0.03901, -0.02788, -0.01113],
} as const;

const toLinear = (v: number): number => {
  const s = v / 255;
  return s < 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number): number => {
  if (v <= 0) return 0;
  if (v >= 1) return 255;
  return Math.round(255 * (v < 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055));
};
const apply = (m: Matrix, [r, g, b]: readonly [number, number, number]): [number, number, number] => [
  m[0]! * r + m[1]! * g + m[2]! * b, m[3]! * r + m[4]! * g + m[5]! * b, m[6]! * r + m[7]! * g + m[8]! * b,
];

/** What a reader with the given dichromacy sees where `rgb` is painted. */
export function simulate(deficiency: Deficiency, rgb: Rgb8): Rgb8 {
  const linear: [number, number, number] = [toLinear(rgb[0]), toLinear(rgb[1]), toLinear(rgb[2])];
  const out = deficiency === 'tritan'
    ? apply(
      BRETTEL_TRITAN.normal[0] * linear[0] + BRETTEL_TRITAN.normal[1] * linear[1] + BRETTEL_TRITAN.normal[2] * linear[2] >= 0
        ? BRETTEL_TRITAN.positive : BRETTEL_TRITAN.negative,
      linear,
    )
    : apply(VIENOT[deficiency], linear);
  return [fromLinear(out[0]), fromLinear(out[1]), fromLinear(out[2])];
}

/** CIE L*a*b* (D65) of an 8-bit sRGB colour. */
export function lab([r, g, b]: Rgb8): [number, number, number] {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const [x, y, z] = [
    (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / 0.95047,
    0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb,
    (0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / 1.08883,
  ];
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** Distance between two colours in CIELAB (ΔE*76): about 2.3 is a just-noticeable difference. */
export function distance(x: Rgb8, y: Rgb8): number {
  const [a, b] = [lab(x), lab(y)];
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** `#rrggbb` to 8-bit channels. */
export const parseHex = (hex: string): Rgb8 => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as unknown as Rgb8;

/**
 * The least two colours may differ by (ΔE*76) under a simulated deficiency and
 * still count as separable: twice a just-noticeable difference of about 2.3,
 * rounded down. One number for every deficiency and both themes. A palette that
 * cannot clear it for some tree has too many steps, not the wrong hue (#104).
 */
export const CVD_MIN_DELTA_E = 4.5;
