/**
 * Strict on honesty, forgiving on completeness.
 *
 * The two properties, and they are the whole boundary contract:
 *
 *   1. An analysis that is merely **unfinished** validates. Twenty-three of
 *      twenty-four cells unassessed is a normal working state, and a schema that
 *      rejects it forces a second, looser draft format -- i.e. two schemas.
 *   2. An analysis that asserts something a reader **cannot check** does not
 *      validate, and **cannot be made to** by any option this function takes.
 *
 * The second half of (2) is why `includeCompleteness` exists and no
 * `includeHonesty` does. A switch would be reached for on the first inconvenient
 * failure, and the guarantee would erode precisely where it matters.
 */
import { describe, it, expect } from 'vitest';
import { validateAnalysis, type ValidationProblem } from '../src/core/schema/analysis.js';

const AUTHOR = { id: 'ana', displayName: 'Ana', kind: 'human' as const };

const CRITERION = {
  id: 'cost',
  label: 'Cost',
  defaultMeasurement: {
    level: 'ordinal' as const, preference: 'increasing' as const,
    range: { min: 1, max: 5 }, levels: [1, 2, 3, 4, 5],
  },
};

const doc = (cells: unknown[], extra: Record<string, unknown> = {}) => ({
  id: 'a1',
  schemaVersion: 1,
  subject: { question: 'which one?' },
  authors: [AUTHOR],
  alternatives: [{ id: 'alt-1', label: 'A' }, { id: 'alt-2', label: 'B' }],
  criteria: [CRITERION],
  cells,
  ...extra,
});

const assertion = (over: Record<string, unknown> = {}) => ({
  id: 's1', authorId: 'ana', at: '2026-08-22T00:00:00Z',
  value: 4, justification: 'the filing states a dated commitment',
  evidence: [], version: 1, ...over,
});

const cellOf = (alternativeId: string, over: Record<string, unknown> = {}) => ({
  alternativeId, criterionId: 'cost', measure: 'score',
  assertions: [assertion(over)],
});

const byRule = (problems: ValidationProblem[], ruleId: string) =>
  problems.filter((p) => p.ruleId === ruleId);

describe('unfinished is not invalid', () => {
  it('accepts a matrix that is almost entirely unassessed', () => {
    // One cell scored, one deliberately blank, and nothing else written yet.
    const r = validateAnalysis(doc([
      cellOf('alt-1'),
      cellOf('alt-2', { value: undefined, missing: { code: 'not-assessed' } }),
    ]));
    expect(r.ok).toBe(true);
    expect(r.problems.every((p) => p.severity === 'warning')).toBe(true);
  });

  it('accepts an analysis with no cells at all', () => {
    expect(validateAnalysis(doc([])).ok).toBe(true);
  });

  it('warns rather than errors about a value with no evidence', () => {
    const r = validateAnalysis(doc([cellOf('alt-1')]));
    const p = byRule(r.problems, 'value-has-evidence');
    expect(p).toHaveLength(1);
    expect(p[0]!.severity).toBe('warning');
    expect(p[0]!.family).toBe('completeness');
    expect(r.ok).toBe(true);
  });

  it('can be asked to stay quiet about completeness, and stays valid', () => {
    const quiet = validateAnalysis(doc([cellOf('alt-1')]), { includeCompleteness: false });
    expect(quiet.ok).toBe(true);
    expect(quiet.problems.filter((p) => p.family === 'completeness')).toHaveLength(0);
  });
});

describe('dishonest does not validate, and cannot be silenced', () => {
  const cases: [string, unknown, string][] = [
    [
      'a score with no reason',
      doc([cellOf('alt-1', { justification: undefined })]),
      'score-has-a-reason',
    ],
    [
      'a score whose justification is only whitespace',
      doc([cellOf('alt-1', { justification: '   ' })]),
      'score-has-a-reason',
    ],
    [
      'an assertion by nobody',
      doc([cellOf('alt-1', { authorId: 'ghost' })]),
      'assertion-attributed',
    ],
    [
      'a blank whose code the document never defines',
      doc([cellOf('alt-1', { value: undefined, missing: { code: 'invented' } })]),
      'blank-is-defined',
    ],
    [
      'a citation that points at a whole document',
      doc([cellOf('alt-1', {
        evidence: [{ id: 'e', target: 'doc:1', selectors: [], sourceType: 'primary', stance: 'supports', derivedFrom: [] }],
      })]),
      'cite-a-span',
    ],
    [
      'an inference citing nothing',
      doc([cellOf('alt-1', {
        evidence: [{
          id: 'e', target: 'doc:1', sourceType: 'agent-inference', stance: 'supports',
          selectors: [{ type: 'TextQuoteSelector', exact: 'something' }], derivedFrom: [],
        }],
      })]),
      'inference-names-its-sources',
    ],
    [
      'a value supported only by the agent\'s own output',
      doc([cellOf('alt-1', {
        evidence: [{
          id: 'e', target: 'doc:1', sourceType: 'agent-summary', stance: 'supports',
          selectors: [{ type: 'TextQuoteSelector', exact: 'something' }], derivedFrom: ['other'],
        }],
      })]),
      'external-support-required',
    ],
    [
      'an undated verdict',
      doc([cellOf('alt-1', {
        evidence: [{
          id: 'e', target: 'doc:1', sourceType: 'primary', stance: 'supports',
          selectors: [{ type: 'TextQuoteSelector', exact: 'something' }], derivedFrom: [],
          check: { status: 'exact' },
        }],
      })]),
      'check-dated',
    ],
  ];

  it.each(cases)('rejects %s', (_name, document, ruleId) => {
    const r = validateAnalysis(document);
    expect(r.ok).toBe(false);
    const p = byRule(r.problems, ruleId);
    expect(p.length).toBeGreaterThan(0);
    expect(p[0]!.family).toBe('honesty');
    expect(p[0]!.severity).toBe('error');
  });

  it.each(cases)('cannot be silenced: %s', (_name, document) => {
    // The only option this function takes suppresses completeness. There is no
    // argument that makes any of the above pass.
    expect(validateAnalysis(document, { includeCompleteness: false }).ok).toBe(false);
  });

  it('says what would fix every honesty problem it reports', () => {
    for (const [, document] of cases) {
      for (const p of validateAnalysis(document).problems.filter((x) => x.family === 'honesty')) {
        expect(p.fix, `${p.ruleId} has no fix`).toBeTruthy();
        expect(p.fix!.length).toBeGreaterThan(20);
      }
    }
  });
});

describe('a declared code is not a dishonest one', () => {
  it('accepts a blank whose code the document declares', () => {
    // The distinction that matters: a code this build does not *implement*
    // degrades honestly through `broader`. A code the document never *defines*
    // is a document no reader can repair, and only the second is rejected.
    const r = validateAnalysis(doc(
      [cellOf('alt-1', { value: undefined, missing: { code: 'paywalled' } })],
      {
        missingCodes: [{
          id: 'paywalled', broader: 'not-evidenced', informative: false,
          means: 'The source exists but is behind a paywall we did not pass.',
        }],
      },
    ));
    expect(byRule(r.problems, 'blank-is-defined')).toHaveLength(0);
    expect(r.ok).toBe(true);
  });
});

describe('every problem is classified', () => {
  it('carries a family and a rule id, always', () => {
    const r = validateAnalysis(doc([cellOf('alt-1', { justification: undefined, authorId: 'ghost' })]));
    expect(r.problems.length).toBeGreaterThan(0);
    for (const p of r.problems) {
      expect(['schema', 'honesty', 'completeness']).toContain(p.family);
      expect(p.ruleId).toBeTruthy();
      expect(p.fix, `${p.ruleId} has no fix`).toBeTruthy();
    }
  });

  it('classifies a malformed document as schema, not as dishonest', () => {
    const r = validateAnalysis({ nonsense: true });
    expect(r.ok).toBe(false);
    expect(r.problems.every((p) => p.family === 'schema')).toBe(true);
  });

  it('gives distinct rules distinct ids, so a suppression is auditable', () => {
    // Every structural rule shared one id until this was checked. Silencing
    // "duplicate declaration" would then have silently also silenced "unknown
    // alternative", which is the opposite of what a stable id is for.
    const r = validateAnalysis({
      id: 'a', schemaVersion: 1, subject: { question: 'q' },
      authors: [AUTHOR], alternatives: [], criteria: [],
      cells: [{ alternativeId: 'ghost', criterionId: 'ghost', measure: 'score', assertions: [] }],
      missingCodes: [{ id: 'withheld', broader: 'withheld', means: 'x' }],
    });
    const ids = new Set(r.problems.map((p) => p.ruleId));
    expect(ids.has('cell-coordinates-exist')).toBe(true);
    expect(ids.has('no-redeclaring-core')).toBe(true);
    expect(ids.size).toBeGreaterThan(1);
  });

  it('never reports an honesty problem as a warning', () => {
    const r = validateAnalysis(doc([cellOf('alt-1', { justification: undefined })]));
    for (const p of r.problems.filter((x) => x.family === 'honesty')) {
      expect(p.severity).toBe('error');
    }
  });
});
