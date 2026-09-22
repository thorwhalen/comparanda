/**
 * The headless core runs, unchanged, in a real browser (#41, ADR-0005).
 *
 * The core suite proves the core needs no DOM; this proves the other half of
 * ADR-0005's claim -- that the same modules a page imports behave the same in a
 * browser engine as in Node. It is also the seed of the browser job the
 * accessibility gate (ADR-0029) needs: new browser tests are new files here.
 */
import { describe, it, expect } from 'vitest';

import { Analysis, validateAnalysis, completeness } from '../../src/core/schema/analysis.js';
import { dominance } from '../../src/core/analyses/dominance.js';
import languages from '../../examples/languages.json';
import relocation from '../../examples/relocation.json';

describe('in a real browser', () => {
  it('is a browser: the DOM exists here, unlike in the core suite', () => {
    expect(typeof document).toBe('object');
    expect(typeof window).toBe('object');
    expect(navigator.userAgent).toMatch(/Chrome|Chromium|HeadlessChrome/);
  });

  it('validates both fixtures exactly as Node does', () => {
    for (const doc of [languages, relocation]) {
      const r = validateAnalysis(doc);
      expect(r.problems.filter((p) => p.severity === 'error')).toEqual([]);
      expect(r.ok).toBe(true);
    }
  });

  it('computes dominance and completeness over the messy fixture', () => {
    const a = Analysis.parse(relocation);
    const d = dominance(a, { measure: 'score' });
    expect(d.basis.length).toBeGreaterThan(0);
    expect(d.basisDescription).toMatch(/criteri/);
    const c = completeness(a, { measure: 'score' });
    expect(c.total).toBeGreaterThan(0);
  });
});
