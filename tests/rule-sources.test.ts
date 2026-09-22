/**
 * Every refusal names its rule and the ADR it comes from (#56).
 *
 * The compiler already refuses a helper call with a rule id missing from
 * `RULE_SOURCES`. These tests cover what it cannot: that the table has no stale
 * entries, that every ADR it cites exists, and that the rule and ADR actually
 * reach the message a human reads -- for every family, including shape errors
 * and the evidence rules, which are produced outside `validateAnalysis`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RULE_SOURCES, validateAnalysis, type ValidationProblem } from '../src/core/schema/analysis.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

/** Rule ids as they appear at their call sites, found by reading the source. */
function ruleIdsInSource(): Set<string> {
  const ids = new Set<string>();
  for (const file of ['src/core/schema/analysis.ts', 'src/core/schema/evidence.ts']) {
    const src = read(file);
    for (const m of src.matchAll(/\b(?:err|honesty|incomplete)\(\s*'([a-z0-9-]+)'/g)) ids.add(m[1]!);
    for (const m of src.matchAll(/\bruleId: '([a-z0-9-]+)'/g)) ids.add(m[1]!);
  }
  return ids;
}

describe('the rule-source table', () => {
  it('finds rule ids in the source (so the comparisons below are not vacuous)', () => {
    expect(ruleIdsInSource().size).toBeGreaterThan(15);
  });

  it('lists every rule the source can report, and nothing else', () => {
    expect([...ruleIdsInSource()].sort()).toEqual(Object.keys(RULE_SOURCES).sort());
  });

  it('cites only ADRs that exist', () => {
    const adrs = new Set(
      readdirSync(join(root, 'docs', 'adr'))
        .map((f) => /^(\d{4})-/.exec(f)?.[1])
        .filter((n): n is string => n !== undefined && n !== '0000')
        .map((n) => `ADR-${n}`),
    );
    for (const [rule, adr] of Object.entries(RULE_SOURCES)) {
      expect(adrs, `${rule} cites ${adr}, which has no file in docs/adr`).toContain(adr);
    }
  });

  it('is frozen', () => {
    expect(Object.isFrozen(RULE_SOURCES)).toBe(true);
  });
});

const AUTHOR = { id: 'ana', displayName: 'Ana', kind: 'human' };
const ORDINAL = {
  level: 'ordinal', preference: 'increasing', range: { min: 1, max: 5 }, levels: [1, 2, 3, 4, 5],
};

/** One document that trips as many rules as one document can. */
const hostile = {
  id: 'a1',
  schemaVersion: 99,
  subject: { question: 'which one?' },
  authors: [AUTHOR],
  alternatives: [{ id: 'x', label: 'X', groupIds: ['ghost-group'] }, { id: 'x', label: 'X again' }],
  criteria: [
    { id: 'c', label: 'C', defaultMeasurement: ORDINAL },
    { id: 'bare', label: 'No measurement', weights: { substitution: 1 } },
    { id: 'n', label: 'Ordinal with no range', defaultMeasurement: { level: 'ordinal', preference: 'increasing' } },
  ],
  missingCodes: [
    { id: 'withheld', broader: 'withheld', means: 'redeclares core' },
    { id: 'mine', broader: 'withheld', structural: true, means: 'structural but not n/a' },
    { id: 'mine', broader: 'withheld', means: 'declared twice' },
  ],
  cells: [
    {
      alternativeId: 'x', criterionId: 'c', measure: 'score',
      assertions: [
        { id: 's1', authorId: 'ghost', at: '2026-08-22T00:00:00Z', value: 3, evidence: [], version: 1 },
        { id: 's2', authorId: 'ana', at: '2026-08-22T00:00:00Z', version: 1, evidence: [] },
        {
          id: 's3', authorId: 'ana', at: '2026-08-22T00:00:00Z', version: 1, evidence: [],
          missing: { code: 'never-declared' },
        },
        {
          id: 's4', authorId: 'ana', at: '2026-08-22T00:00:00Z', version: 1, value: 4,
          justification: 'rests on the agent alone',
          evidence: [
            { id: 'e1', target: 'doc:1', selectors: [], sourceType: 'agent-inference', stance: 'supports', derivedFrom: [] },
            {
              id: 'e2', target: 'doc:2', sourceType: 'agent-summary', stance: 'supports', derivedFrom: ['e1'],
              selectors: [{ type: 'TextQuoteSelector', exact: 'quoted' }], check: { status: 'exact' },
            },
          ],
        },
      ],
    },
    { alternativeId: 'x', criterionId: 'c', measure: 'score', assertions: [] },
    { alternativeId: 'nobody', criterionId: 'nothing', measure: 'score', assertions: [] },
    { alternativeId: 'x', criterionId: 'bare', measure: 'score', assertions: [] },
  ],
};

function expectCited(problems: ValidationProblem[]) {
  expect(problems.length).toBeGreaterThan(0);
  for (const p of problems) {
    const adr = (RULE_SOURCES as Record<string, string>)[p.ruleId];
    expect(adr, `rule ${p.ruleId} has no source`).toBeDefined();
    expect(p.adr).toBe(adr);
    expect(p.message.endsWith(`[rule ${p.ruleId}; ${adr}]`), p.message).toBe(true);
  }
}

describe('every reported problem names its rule and its ADR', () => {
  it('in every family, over a document built to trip most rules', () => {
    const { problems } = validateAnalysis(hostile);
    expectCited(problems);
    const reported = new Set(problems.map((p) => p.ruleId));
    // Everything except the shape rule, which needs a document that does not
    // parse, is exercised here -- so this is not a check of three rules.
    const expected = Object.keys(RULE_SOURCES).filter((r) => r !== 'schema-shape');
    expect([...reported].sort()).toEqual(expected.sort());
    expect(new Set(problems.map((p) => p.family))).toEqual(new Set(['schema', 'honesty', 'completeness']));
  });

  it('for shape errors too', () => {
    const { problems } = validateAnalysis({ nonsense: true });
    expect(problems.every((p) => p.ruleId === 'schema-shape')).toBe(true);
    expectCited(problems);
  });

  it('names the ADR once, not twice', () => {
    for (const p of validateAnalysis(hostile).problems) {
      expect(p.message.split(p.adr).length - 1, p.message).toBe(1);
    }
  });
});

describe('an invalid document never partially loads (#56)', () => {
  it('returns no analysis when any error is reported', () => {
    const r = validateAnalysis(hostile);
    expect(r.ok).toBe(false);
    expect(r.analysis).toBeUndefined();
    expect('analysis' in r).toBe(false);
  });

  it('returns no analysis for a document that does not parse', () => {
    const r = validateAnalysis({ nonsense: true });
    expect(r.ok).toBe(false);
    expect(r.analysis).toBeUndefined();
  });

  it('still returns the document when only warnings are reported', () => {
    // Unfinished is not invalid: a value with no evidence is a completeness
    // warning, and withholding the document for it would force a draft format.
    const r = validateAnalysis({
      id: 'a1', subject: { question: 'q' }, authors: [AUTHOR],
      alternatives: [{ id: 'x', label: 'X' }],
      criteria: [{ id: 'c', label: 'C', defaultMeasurement: ORDINAL }],
      cells: [{
        alternativeId: 'x', criterionId: 'c', measure: 'score',
        assertions: [{
          id: 's', authorId: 'ana', at: '2026-08-22T00:00:00Z', value: 3,
          justification: 'a considered judgement', evidence: [], version: 1,
        }],
      }],
    });
    expect(r.problems.some((p) => p.severity === 'warning')).toBe(true);
    expect(r.ok).toBe(true);
    // Narrowed by `ok`: no optional chaining needed, which is the point of the union.
    if (r.ok) expect(r.analysis.id).toBe('a1');
  });
});

describe('validation is blind to who produced the document (#56, ADR-0002)', () => {
  it('reports the same problems whether the author is a human or an agent', () => {
    const asKind = (kind: string) => ({ ...hostile, authors: [{ ...AUTHOR, kind }] });
    const strip = (ps: ValidationProblem[]) => ps.map(({ ruleId, path, severity }) => [ruleId, path, severity]);
    const human = strip(validateAnalysis(asKind('human')).problems);
    expect(human.length).toBeGreaterThan(0);
    expect(strip(validateAnalysis(asKind('agent')).problems)).toEqual(human);
  });
});
