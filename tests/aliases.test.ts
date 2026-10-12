/**
 * Display aliases are per-analysis data with one default, from one place (#42).
 *
 * ADR-0003's amendment (decision 2) makes "options" the default display word
 * for alternatives; the internal name stays `alternatives`.
 */
import { describe, it, expect } from 'vitest';

import { Aliases, aliasesOf } from '../src/core/schema/structure.js';
import { Analysis } from '../src/core/schema/analysis.js';

describe('display aliases', () => {
  it('default alternatives to "options" and leave criteria as they are', () => {
    expect(Aliases.parse({})).toEqual({
      alternative: 'option', alternatives: 'options', criterion: 'criterion', criteria: 'criteria',
    });
  });

  it('aliasesOf supplies the defaults for an analysis that sets none, and the analysis\'s own otherwise', () => {
    const bare = Analysis.parse({ id: 'a', subject: { question: 'q' } });
    expect(bare.aliases).toBeUndefined();
    expect(aliasesOf(bare).alternatives).toBe('options');
    const own = Analysis.parse({ id: 'a', subject: { question: 'q' }, aliases: { alternatives: 'vendors' } });
    expect(aliasesOf(own)).toMatchObject({ alternatives: 'vendors', alternative: 'option' });
  });

  it('round-trips through JSON as data', () => {
    const a = Analysis.parse({ id: 'a', subject: { question: 'q' }, aliases: { criterion: 'factor' } });
    expect(Analysis.parse(JSON.parse(JSON.stringify(a))).aliases).toEqual(a.aliases);
  });
});
