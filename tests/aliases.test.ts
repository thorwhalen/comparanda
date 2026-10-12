/**
 * Display aliases are per-analysis data with one default, from one place (#42).
 *
 * ADR-0003's amendment (decision 2) makes "options" the default display word
 * for alternatives; the internal name stays `alternatives`.
 */
import { describe, it, expect } from 'vitest';

import { Aliases, aliasesOf } from '../src/core/schema/structure.js';
import { Analysis, validateAnalysis } from '../src/core/schema/analysis.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

  it('refuses half a pair, which would mix the alias with the default in one sentence (#165)', () => {
    const doc = (aliases: Record<string, string>) => ({ id: 'a', subject: { question: 'q' }, aliases });
    const half = validateAnalysis(doc({ alternatives: 'vendors' }));
    expect(half.ok).toBe(false);
    expect(half.problems.map((p) => [p.ruleId, p.path])).toEqual([['alias-pair-complete', 'aliases.alternative']]);
    expect(validateAnalysis(doc({ criterion: 'factor' })).problems[0]!.path).toBe('aliases.criteria');
    expect(validateAnalysis(doc({ alternative: 'vendor', alternatives: 'vendors' })).ok).toBe(true);
    expect(validateAnalysis(doc({})).ok).toBe(true);
  });

  it('the emitted JSON Schema says the same, for a validator in another language', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const schema = JSON.parse(readFileSync(join(root, 'schema', 'comparanda.v1.json'), 'utf8'));
    expect(schema.properties.aliases.dependentRequired).toEqual({
      alternative: ['alternatives'], alternatives: ['alternative'], criterion: ['criteria'], criteria: ['criterion'],
    });
  });
});
