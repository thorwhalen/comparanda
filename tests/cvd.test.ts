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
    // A colour on each side of the separation plane (normal · linear rgb), so neither branch goes unexercised.
    const sides = [[255, 255, 0], [0, 0, 255]].map(([r, g, b]) => 0.03901 * r! - 0.02788 * g! - 0.01113 * b!);
    expect(Math.sign(sides[0]!)).not.toBe(Math.sign(sides[1]!));
    for (const c of [[255, 255, 0], [0, 0, 255]] as const) simulate('tritan', c);
  });
});

describe('distance', () => {
  it('is CIELAB: white is L* 100 and black L* 0, and a colour is zero from itself', () => {
    expect(lab([255, 255, 255])[0]).toBeCloseTo(100, 1);
    expect(lab([0, 0, 0])[0]).toBeCloseTo(0, 1);
    expect(distance(parseHex('#336699'), parseHex('#336699'))).toBe(0);
  });

  it('puts the separability floor at about two just-noticeable differences', () => {
    expect(CVD_MIN_DELTA_E / 2.3).toBeCloseTo(2, 0);
  });
});
