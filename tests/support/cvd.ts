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

/**
 * CIEDE2000 (ΔE*00) between two CIELAB colours, with kL = kC = kH = 1.
 * Sharma, Wu & Dalal (2005), "The CIEDE2000 color-difference formula:
 * implementation notes, supplementary test data, and mathematical observations",
 * whose test pairs pin it in `tests/cvd.test.ts`. It weights lightness, chroma
 * and hue by where they sit, so one floor means about the same thing for a pale
 * pair and a dark one, which ΔE*76 does not.
 */
export function deltaE2000(lab1: readonly [number, number, number], lab2: readonly [number, number, number]): number {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;
  const rad = Math.PI / 180;
  const cBar = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const g = 0.5 * (1 - Math.sqrt(cBar ** 7 / (cBar ** 7 + 25 ** 7)));
  const [a1p, a2p] = [(1 + g) * a1, (1 + g) * a2];
  const [c1p, c2p] = [Math.hypot(a1p, b1), Math.hypot(a2p, b2)];
  const hue = (b: number, a: number) => (b === 0 && a === 0 ? 0 : ((Math.atan2(b, a) / rad) + 360) % 360);
  const [h1p, h2p] = [hue(b1, a1p), hue(b2, a2p)];
  const dLp = L2 - L1;
  const dCp = c2p - c1p;
  let dhp = 0;
  if (c1p * c2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(c1p * c2p) * Math.sin((dhp / 2) * rad);
  const lBarP = (L1 + L2) / 2;
  const cBarP = (c1p + c2p) / 2;
  let hBarP = h1p + h2p;
  if (c1p * c2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hBarP = (h1p + h2p) / 2;
    else hBarP = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  }
  const t = 1 - 0.17 * Math.cos((hBarP - 30) * rad) + 0.24 * Math.cos(2 * hBarP * rad)
    + 0.32 * Math.cos((3 * hBarP + 6) * rad) - 0.2 * Math.cos((4 * hBarP - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hBarP - 275) / 25) ** 2));
  const rc = 2 * Math.sqrt(cBarP ** 7 / (cBarP ** 7 + 25 ** 7));
  const sl = 1 + (0.015 * (lBarP - 50) ** 2) / Math.sqrt(20 + (lBarP - 50) ** 2);
  const sc = 1 + 0.045 * cBarP;
  const sh = 1 + 0.015 * cBarP * t;
  const rt = -Math.sin(2 * dTheta * rad) * rc;
  return Math.sqrt((dLp / sl) ** 2 + (dCp / sc) ** 2 + (dHp / sh) ** 2 + rt * (dCp / sc) * (dHp / sh));
}

/** ΔE*00 between two 8-bit sRGB colours: what the gate measures (#203). */
export const distance2000 = (x: Rgb8, y: Rgb8): number => deltaE2000(lab(x), lab(y));

/** `#rrggbb` to 8-bit channels. */
export const parseHex = (hex: string): Rgb8 => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as unknown as Rgb8;

/**
 * The least two colours may differ by (ΔE*00) under a simulated deficiency and
 * still count as separable. One number for every deficiency and both themes. A
 * palette that cannot clear it for some tree has too many steps, not the wrong
 * hue (#104).
 *
 * CIEDE2000, not ΔE*76 (#203): ΔE*76 overstates differences among saturated and
 * dark colours, so the same floor was stricter on a pale pair than on a dark one.
 * 3 is a little above the closest pair the shipped palettes paint (about 3.35,
 * the dark theme's 5 × 4 tree, layer 2) and comfortably above a just-noticeable
 * difference (about 1 in ΔE*00).
 */
export const CVD_MIN_DELTA_E = 3;
