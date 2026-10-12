/**
 * A criterion's definition is structured, and the structure is checked (#61).
 *
 * Three things: scale anchors are keyed to levels the scale can actually take;
 * a missing rule names *which* blank to record, by a code the document defines;
 * and a terse criterion with no definition at all is still a valid criterion.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateAnalysis } from '../src/core/schema/analysis.js';
import { validateMeasurement, type Measurement } from '../src/core/schema/measurement.js';
import { CriterionDefinition } from '../src/core/schema/structure.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const anchors = (levels: Record<string, string>, requires: string[] = []) =>
  ({ levels, requires, contentHash: 'sha256:test' });

const ORDINAL: Measurement = {
  level: 'ordinal', preference: 'increasing', range: { min: 1, max: 5 }, levels: [1, 2, 3, 4, 5],
};

const doc = (criterion: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id: 'd', subject: { question: 'q' }, authors: [{ id: 'ana', displayName: 'Ana', kind: 'human' }],
  alternatives: [{ id: 'x', label: 'X' }],
  criteria: [{ id: 'c', label: 'C', defaultMeasurement: ORDINAL, ...criterion }],
  cells: [],
  ...extra,
});

const hits = (input: unknown, ruleId: string) =>
  validateAnalysis(input).problems.filter((p) => p.ruleId === ruleId);

describe('scale anchors are keyed to levels the scale can take', () => {
  it('accepts anchors on declared levels', () => {
    expect(validateMeasurement({ ...ORDINAL, anchors: anchors({ 1: 'a', 3: 'b', 5: 'c' }, ['1', '3', '5']) }))
      .toEqual([]);
  });

  it('rejects an anchor on a level that is not declared, naming the path', () => {
    const p = validateMeasurement({ ...ORDINAL, anchors: anchors({ 1: 'a', 6: 'off the scale' }) }, 'm');
    expect(p).toHaveLength(1);
    expect(p[0]!.path).toBe('m.anchors.levels.6');
    expect(p[0]!.message).toMatch(/not one of the declared levels/);
  });

  it('rejects a required level the scale does not have', () => {
    const p = validateMeasurement({ ...ORDINAL, anchors: anchors({ 1: 'a' }, ['1', '7']) });
    expect(p.map((x) => x.path)).toContain('anchors.requires.7');
  });

  it('checks against the declared levels, not their position, when levels are text', () => {
    const m: Measurement = {
      level: 'ordinal', preference: 'increasing', range: { min: 1, max: 3 }, levels: ['low', 'mid', 'high'],
    };
    expect(validateMeasurement({ ...m, anchors: anchors({ low: 'a', high: 'b' }) })).toEqual([]);
    expect(validateMeasurement({ ...m, anchors: anchors({ 2: 'b' }) }).map((x) => x.path))
      .toContain('anchors.levels.2');
  });

  it('falls back to the range when no levels are declared', () => {
    const m: Measurement = { level: 'ordinal', preference: 'increasing', range: { min: 1, max: 5 } };
    const paths = validateMeasurement({ ...m, anchors: anchors({ 3: 'ok', 9: 'high', x: 'nan' }) })
      .filter((p) => p.path.startsWith('anchors.')).map((p) => p.path);
    expect(paths).toEqual(['anchors.levels.9', 'anchors.levels.x']);
  });

  it('reaches the boundary as a measurement-well-formed error', () => {
    const h = hits(doc({ defaultMeasurement: { ...ORDINAL, anchors: anchors({ 0: 'below' }) } }), 'measurement-well-formed');
    expect(h.map((p) => p.path)).toContain('criteria[0].defaultMeasurement.anchors.levels.0');
    expect(h[0]!.severity).toBe('error');
  });

  it('has one home: the definition no longer carries a second anchors map', () => {
    expect(Object.keys(CriterionDefinition.shape)).not.toContain('anchors');
  });
});

describe('a missing rule names which blank to record, by a defined code', () => {
  it('accepts a core code', () => {
    const d = doc({ definition: { missingRules: [{ when: 'nothing is published', code: 'not-evidenced' }] } });
    expect(hits(d, 'missing-rule-code-defined')).toEqual([]);
    expect(validateAnalysis(d).ok).toBe(true);
  });

  it('accepts a code declared on the criterion, and one declared on the analysis', () => {
    const decl = (id: string) => ({ id, broader: 'not-evidenced', means: 'behind a paywall' });
    expect(hits(doc({
      missingCodes: [decl('paywalled')],
      definition: { missingRules: [{ when: 'paywalled', code: 'paywalled' }] },
    }), 'missing-rule-code-defined')).toEqual([]);
    expect(hits(doc(
      { definition: { missingRules: [{ when: 'paywalled', code: 'paywalled' }] } },
      { missingCodes: [decl('paywalled')] },
    ), 'missing-rule-code-defined')).toEqual([]);
  });

  it('rejects a code nothing defines, as an honesty error at the exact path', () => {
    const r = validateAnalysis(doc({
      definition: { missingRules: [
        { when: 'nothing is published', code: 'not-evidenced' },
        { when: 'the vendor will not say', code: 'stonewalled' },
      ] },
    }));
    expect(r.ok).toBe(false);
    const h = r.problems.filter((p) => p.ruleId === 'missing-rule-code-defined');
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({
      path: 'criteria[0].definition.missingRules[1].code', family: 'honesty', severity: 'error', adr: 'ADR-0030',
    });
    expect(h[0]!.message).toMatch(/stonewalled/);
    expect(h[0]!.message).toMatch(/the vendor will not say/);
  });

  it('does not accept free text in place of the structured rule', () => {
    const r = validateAnalysis(doc({ definition: { missingRules: 'record not-evidenced if nothing is published' } }));
    expect(r.ok).toBe(false);
  });
});

describe('a terse criterion stays terse', () => {
  it('validates with no definition at all', () => {
    expect(validateAnalysis(doc({})).ok).toBe(true);
  });

  it('validates with any subset of the definition fields', () => {
    expect(validateAnalysis(doc({ definition: { question: 'Is it fast?' } })).ok).toBe(true);
  });
});

describe('the messy fixture exercises a structured definition', () => {
  const raw = JSON.parse(readFileSync(join(root, 'examples', 'relocation.json'), 'utf8'));

  it('declares missing rules that resolve, one through a criterion-scoped code', () => {
    const tax = raw.criteria.find((c: { id: string }) => c.id === 'income-tax');
    const codes = tax.definition.missingRules.map((r: { code: string }) => r.code);
    expect(codes).toContain('paywalled');
    expect(tax.missingCodes.map((c: { id: string }) => c.id)).toContain('paywalled');
    const r = validateAnalysis(raw);
    expect(r.problems.filter((p) => p.ruleId === 'missing-rule-code-defined')).toEqual([]);
    expect(r.ok).toBe(true);
  });
});
