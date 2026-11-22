/**
 * The gate's list is the research section's list (ADR-0029, #105): twenty-three
 * automated checks, A1 to A23, each with a title, none repeated. The three
 * runtimes' own files then assert that together they implement exactly these.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { AUTOMATED } from './spec.js';

const research = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs/research/sections/c7-interaction-a11y.md'), 'utf8');

describe('the automated set', () => {
  it('is A1 to A23, in order, each once', () => {
    expect(AUTOMATED.map((c) => c.id)).toEqual(Array.from({ length: 23 }, (_, i) => `A${i + 1}`));
  });

  it('is the research section\'s table: every number it lists is here, and no other', () => {
    const listed = Array.from(research.matchAll(/^\| (A\d+) \|/gm)).map((m) => m[1]);
    expect(listed).toEqual(AUTOMATED.map((c) => c.id));
  });
});

describe('the cross-fixture matrix in shards (#375)', () => {
  it('holds every fixture in exactly one shard, whatever the number of checks or shards', async () => {
    const { shardOf } = await import('./gate.js');
    const { MATRIX_SHARDS } = await import('../../vitest.a11y.config.js');
    for (const count of [1, 2, 3, MATRIX_SHARDS, 7]) {
      for (const n of [0, 1, 5, 27, 40]) {
        const items = Array.from({ length: n }, (_, i) => i);
        const shares = Array.from({ length: count }, (_, i) => shardOf(items, [i + 1, count]));
        expect(shares.flat().sort((a, b) => a - b)).toEqual(items);
        expect(Math.max(...shares.map((s) => s.length)) - Math.min(...shares.map((s) => s.length))).toBeLessThanOrEqual(1);
      }
    }
    expect(() => shardOf([1], [0, 2])).toThrow(/shard/);
    expect(() => shardOf([1], [3, 2])).toThrow(/shard/);
  });
});

describe('CI runs every part of the gate (#375)', () => {
  it('the a11y-part matrix in ci.yml lists exactly A11Y_PARTS', async () => {
    const { A11Y_PARTS } = await import('../../vitest.a11y.config.js');
    const ci = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.github/workflows/ci.yml'), 'utf8');
    const listed = /^\s+part: \[([^\]]*)\]/m.exec(ci)?.[1]?.split(',').map((p) => p.trim());
    expect(listed).toEqual([...A11Y_PARTS]);
  });
});
