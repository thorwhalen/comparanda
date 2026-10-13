/**
 * The colour-vision-deficiency simulator the browser gate uses (#104, ADR-0028),
 * checked in plain Node: it is the instrument, and an instrument that is
 * wrong passes everything. The rendered-screenshot check is
 * `tests/browser/cvd.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { CVD_MIN_DELTA_E, DEFICIENCIES, distance, lab, parseHex, simulate, type Rgb8 } from './support/cvd.js';

describe('simulate', () => {
  it.each(DEFICIENCIES)('%s leaves every grey alone: a dichromat sees neutrals as everyone does', (deficiency) => {
    for (const v of [0, 17, 64, 128, 200, 255]) {
      const out = simulate(deficiency, [v, v, v]);
      out.forEach((c) => expect(Math.abs(c - v)).toBeLessThanOrEqual(1));
    }
  });

  it('is applied to linear light, not to the gamma-encoded values', () => {
    // Pure red is (1, 0, 0) in linear light; Viénot's protan row gives (0.11238, 0.11238, 0.00401),
    // which re-encodes to (94, 94, 13). The same matrix on encoded values would give (29, 29, 1).
    expect(simulate('protan', [255, 0, 0])).toEqual([94, 94, 13]);
  });

  it('takes red and green apart for a normal reader and brings them together for a protan or deutan one', () => {
    const red: Rgb8 = [200, 60, 50];
    const green: Rgb8 = [60, 140, 50];
    const normal = distance(red, green);
    expect(distance(simulate('protan', red), simulate('protan', green))).toBeLessThan(normal / 2);
    expect(distance(simulate('deutan', red), simulate('deutan', green))).toBeLessThan(normal / 2);
  });

  it('takes blue and yellow-green together for a tritan reader, and uses both of Brettel\'s half-planes', () => {
    const blue: Rgb8 = [40, 90, 200];
    const teal: Rgb8 = [40, 150, 150];
    expect(distance(simulate('tritan', blue), simulate('tritan', teal))).toBeLessThan(distance(blue, teal));
    // Pinned on each side of the separation plane (normal · linear rgb): yellow on the positive
    // side, blue on the negative, computed by hand from the matrices. Swapping the two matrices,
    // or using only one, moves these.
    expect(simulate('tritan', [255, 255, 0])).toEqual([255, 238, 241]);
    expect(simulate('tritan', [200, 160, 40])).toEqual([208, 149, 155]);
    expect(simulate('tritan', [0, 0, 255])).toEqual([0, 98, 136]);
    expect(simulate('tritan', blue)).toEqual([0, 110, 137]);
  });
});

describe('distance', () => {
  it('is CIELAB: white is L* 100 and black L* 0, and a colour is zero from itself', () => {
    expect(lab([255, 255, 255])[0]).toBeCloseTo(100, 1);
    expect(lab([0, 0, 0])[0]).toBeCloseTo(0, 1);
    expect(distance(parseHex('#336699'), parseHex('#336699'))).toBe(0);
  });

  it('puts the separability floor at 4.5: twice a just-noticeable difference of about 2.3, rounded down', () => {
    expect(CVD_MIN_DELTA_E).toBe(4.5);
  });
});
