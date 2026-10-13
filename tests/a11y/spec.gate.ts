/**
 * The gate's list is the research section's list (ADR-0029, #105): twenty
 * automated checks, A1 to A20, each with a title, none repeated. The three
 * runtimes' own files then assert that together they implement exactly these.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { AUTOMATED } from './spec.js';

const research = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs/research/sections/c7-interaction-a11y.md'), 'utf8');

describe('the automated set', () => {
  it('is A1 to A20, in order, each once', () => {
    expect(AUTOMATED.map((c) => c.id)).toEqual(Array.from({ length: 20 }, (_, i) => `A${i + 1}`));
  });

  it('is the research section\'s table: every number it lists is here, and no other', () => {
    const listed = Array.from(research.matchAll(/^\| (A\d+) \|/gm)).map((m) => m[1]);
    expect(listed).toEqual(AUTOMATED.map((c) => c.id));
  });
});
