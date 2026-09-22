/**
 * Analyses are described, then assembled by a composition root; every result
 * carries its assumptions (#87, ADR-0015, ADR-0017).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Analysis } from '../src/core/schema/analysis.js';
import {
  createAnalysisRegistry, defineAnalysis,
  dominanceAnalysis, screeningAnalysis, pughAnalysis, nonDiscriminatingAnalysis, agreementAnalysis,
} from '../src/core/analyses/index.js';
import { explainDominance } from '../src/core/analyses/dominance.js';

const here = dirname(fileURLToPath(import.meta.url));
const relocation = () => Analysis.parse(JSON.parse(readFileSync(join(here, '..', 'examples', 'relocation.json'), 'utf8')));

describe('every shipped analysis result carries its assumptions, as data', () => {
  const a = relocation();
  const results = [
    dominanceAnalysis.run(a, { measure: 'score' }),
    screeningAnalysis.run(a, { measure: 'score' }),
    pughAnalysis.run(a, { measure: 'score', datum: a.alternatives[0]!.id }),
    nonDiscriminatingAnalysis.run(a, { measure: 'score' }),
    agreementAnalysis.run(a, { measure: 'score' }),
    explainDominance(a, a.alternatives[0]!.id, a.alternatives[1]!.id, { measure: 'score' }),
  ];
  it.each(results.map((r, i) => [i, r] as const))('result %i', (_i, r) => {
    expect(r.assumptions.length).toBeGreaterThan(0);
    for (const s of r.assumptions) expect(s.length).toBeGreaterThan(20);
    expect(typeof r.widenedByDisclosure).toBe('number');
  });
});

describe('a result without assumptions does not typecheck', () => {
  it('is refused by defineAnalysis at compile time', () => {
    defineAnalysis({
      id: 'bare', label: 'Bare',
      // @ts-expect-error -- the result has no `assumptions`, so this is not an analysis.
      run: () => ({ widenedByDisclosure: 0 }),
    });
    defineAnalysis({
      id: 'empty', label: 'Empty',
      // @ts-expect-error -- an empty assumptions list is not a statement of assumptions.
      run: () => ({ assumptions: [], widenedByDisclosure: 0 }),
    });
    // The lines above are checked by `tsc` (pnpm typecheck); if either ever
    // compiled, the unused @ts-expect-error would fail the typecheck.
    expect(true).toBe(true);
  });
});

describe('the composition root ships exactly what it names', () => {
  it('a consumer who wants two analyses gets two', () => {
    const r = createAnalysisRegistry([dominanceAnalysis, screeningAnalysis]);
    expect(r.ids).toEqual(['dominance', 'screening']);
    expect(r.get('dominance')).toBe(dominanceAnalysis);
    expect(r.get('agreement')).toBeUndefined();
  });

  it('refuses two analyses with one id rather than letting the later one win', () => {
    expect(() => createAnalysisRegistry([dominanceAnalysis, { ...dominanceAnalysis, label: 'again' }])).toThrow(/dominance/);
  });

  it('describes without registering: definitions are frozen values, and nothing is global', () => {
    expect(Object.isFrozen(dominanceAnalysis)).toBe(true);
    const one = createAnalysisRegistry([pughAnalysis]);
    const other = createAnalysisRegistry([agreementAnalysis]);
    expect(one.ids).toEqual(['pugh']);
    expect(other.ids).toEqual(['agreement']);
  });
});
