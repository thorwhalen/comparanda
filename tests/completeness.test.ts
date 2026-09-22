/**
 * Completeness: five counts and three rates, keyed on the structural flag (#81, ADR-0009).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Analysis, completeness } from '../src/core/schema/analysis.js';

const examples = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const relocation = () => Analysis.parse(JSON.parse(readFileSync(join(examples, 'relocation.json'), 'utf8')));

const ORDINAL = { level: 'ordinal', preference: 'increasing', range: { min: 1, max: 5 }, levels: [1, 2, 3, 4, 5] };
const assertion = (i: number, over: Record<string, unknown>) =>
  ({ id: `s${i}`, authorId: 'ana', at: '2026-01-01T00:00:00Z', version: 1, evidence: [], ...over });

describe('the messy fixture, hand-checked (#81)', () => {
  /*
   * examples/relocation.json, measure "score": 5 alternatives x 8 criteria = 40 cells.
   *
   * structural (3): eu-residency-path for taipei and seoul (inapplicable block
   *   g-asia x g-eu; no cell stored at all) and for montreal (block g-americas x
   *   g-eu, and stored as not-applicable anyway).
   * present (27): rent 4 (all but seoul) + income-tax 1 (lisbon) + climate-type 5
   *   + winter-daylight 3 (lisbon, berlin, montreal) + visa-free 4 (all but
   *   montreal) + flight-hours 5 + school-quality 3 (lisbon, berlin, montreal)
   *   + eu-residency-path 2 (lisbon, berlin). Two-rater cells reduce to a value
   *   under the document's lower-median default.
   * settledAbsent (4): seoul/rent indeterminate, berlin/income-tax paywalled
   *   (declared on the criterion, broader not-evidenced -> terminal),
   *   taipei/income-tax withheld, seoul/income-tax not-evidenced.
   * informativeAbsent (2): indeterminate and not-evidenced. paywalled overrides
   *   informative to false; withheld is not informative.
   * outstanding (6): montreal/income-tax, taipei/winter-daylight,
   *   seoul/winter-daylight, seoul/school-quality (not-assessed x4),
   *   taipei/school-quality (deferred), montreal/visa-free (not-yet-negotiated,
   *   declared broader deferred -> non-terminal).
   * 27 + 4 + 6 + 3 = 40. applicable = 37.
   */
  it('has the five counts and three rates a hand count gives', () => {
    const c = completeness(relocation(), { measure: 'score' });
    expect(c).toMatchObject({
      total: 40, structural: 3, applicable: 37, present: 27,
      settledAbsent: 4, informativeAbsent: 2, outstanding: 6, widenedByDisclosure: 0,
    });
    expect(c.examinedRate).toBeCloseTo(31 / 37, 12);
    expect(c.valuedRate).toBeCloseTo(27 / 37, 12);
    expect(c.silenceRate).toBeCloseTo(2 / 37, 12);
  });

  it('returns rates as fractions in [0, 1], never formatted', () => {
    const c = completeness(relocation(), { measure: 'score' });
    for (const k of ['examinedRate', 'valuedRate', 'silenceRate'] as const) {
      expect(typeof c[k], k).toBe('number');
      expect(c[k], k).toBeGreaterThanOrEqual(0);
      expect(c[k], k).toBeLessThanOrEqual(1);
    }
  });
});

describe('a custom structural code is excluded by its flag alone', () => {
  it('without the analysis knowing its id', () => {
    const a = Analysis.parse({
      id: 'd', subject: { question: 'q' }, authors: [{ id: 'ana', displayName: 'Ana', kind: 'human' }],
      alternatives: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }],
      criteria: [{ id: 'c', label: 'C', defaultMeasurement: ORDINAL }],
      missingCodes: [{
        id: 'no-such-regime', broader: 'not-applicable', structural: true,
        means: 'This jurisdiction has no such regime, so the question does not arise.',
      }],
      cells: [
        { alternativeId: 'x', criterionId: 'c', measure: 'score', assertions: [assertion(1, { value: 3, justification: 'x' })] },
        { alternativeId: 'y', criterionId: 'c', measure: 'score', assertions: [assertion(2, { missing: { code: 'no-such-regime' } })] },
      ],
    });
    const c = completeness(a, { measure: 'score' });
    expect(c).toMatchObject({ total: 2, structural: 1, applicable: 1, present: 1, outstanding: 0 });
    expect(c.valuedRate).toBe(1);
  });
});

describe('group-level completeness respects group-pair inapplicability', () => {
  const doc = () => Analysis.parse({
    id: 'g', subject: { question: 'q' }, authors: [{ id: 'ana', displayName: 'Ana', kind: 'human' }],
    groups: [
      { id: 'asia', label: 'Asia', axis: 'alternatives' },
      { id: 'east-asia', label: 'East Asia', axis: 'alternatives', parentId: 'asia' },
      { id: 'eu', label: 'EU', axis: 'criteria' },
    ],
    inapplicable: [{ alternativeGroupId: 'asia', criterionGroupId: 'eu' }],
    alternatives: [
      { id: 'tokyo', label: 'Tokyo', groupIds: ['east-asia'] },
      { id: 'delhi', label: 'Delhi', groupIds: ['asia'] },
      { id: 'lisbon', label: 'Lisbon' },
    ],
    criteria: [
      { id: 'eu-path', label: 'EU residency', groupIds: ['eu'], defaultMeasurement: ORDINAL },
      { id: 'rent', label: 'Rent', defaultMeasurement: ORDINAL },
    ],
    cells: [
      { alternativeId: 'lisbon', criterionId: 'eu-path', measure: 'score', assertions: [assertion(1, { value: 4, justification: 'x' })] },
      { alternativeId: 'tokyo', criterionId: 'rent', measure: 'score', assertions: [assertion(2, { value: 2, justification: 'x' })] },
    ],
  });

  it('counts a group\'s cells, sub-group members included, with the block structural', () => {
    // asia = delhi + tokyo (via east-asia). eu-path is blocked for both; rent:
    // tokyo present, delhi never assessed.
    const c = completeness(doc(), { measure: 'score', alternativeGroupId: 'asia' });
    expect(c).toMatchObject({ total: 4, structural: 2, applicable: 2, present: 1, outstanding: 1 });
  });

  it('crosses an alternative group with a criterion group', () => {
    const c = completeness(doc(), { measure: 'score', alternativeGroupId: 'east-asia', criterionGroupId: 'eu' });
    expect(c).toMatchObject({ total: 1, structural: 1, applicable: 0 });
    // Nothing applicable: rates stay 0 rather than NaN.
    expect(c.examinedRate).toBe(0);
  });

  it('refuses a group that is not on the named axis', () => {
    expect(() => completeness(doc(), { measure: 'score', alternativeGroupId: 'eu' })).toThrow(/not a group of alternatives/);
    expect(() => completeness(doc(), { measure: 'score', criterionGroupId: 'nope' })).toThrow(/nope/);
  });
});
