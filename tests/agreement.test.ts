/**
 * Krippendorff's alpha, per criterion (#82, ADR-0022).
 *
 * The gate is Krippendorff's own published example -- "dataset C" in
 * *Computing Krippendorff's Alpha-Reliability* (2011): 4 observers, 12 units,
 * 7 missing values, published alpha 0.743 (nominal), 0.815 (ordinal) and 0.849
 * (interval), which a from-scratch implementation reproduced as 0.7434 / 0.8154
 * / 0.8491 (ADR-0022). The ordinal value is the one a mature library got wrong
 * (0.789), because the ordinal difference is a distance in observed marginal
 * mass, not `(c - k)^2`. It exercises missing data, variable observer counts
 * and an unpairable lone value (unit 12) at once.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Analysis } from '../src/core/schema/analysis.js';
import { agreement, cellShape, jackknifeInterval, krippendorffAlpha } from '../src/core/analyses/agreement.js';

/** Dataset C: rows are observers A-D, columns units 1-12, `null` is missing. */
const DATASET_C: (number | null)[][] = [
  [1, 2, 3, 3, 2, 1, 4, 1, 2, null, null, null],
  [1, 2, 3, 3, 2, 2, 4, 1, 2, 5, null, 3],
  [null, 3, 3, 3, 2, 3, 4, 2, 2, 5, 1, null],
  [1, 2, 3, 3, 2, 4, 4, 1, 2, 5, 1, null],
];
const units = DATASET_C[0]!.map((_, u) =>
  DATASET_C.map((row) => row[u]).filter((v): v is number => v !== null));

describe('the golden fixture: Krippendorff (2011), dataset C', () => {
  it('has the published shape: 4 observers, 12 units, 7 missing values', () => {
    expect(DATASET_C.flat().filter((v) => v === null)).toHaveLength(7);
    expect(units).toHaveLength(12);
  });

  it.each([
    ['nominal', 0.7434],
    ['ordinal', 0.8154],
    ['interval', 0.8491],
    ['ratio', 0.7974],
  ] as const)('reproduces the published %s alpha', (metric, expected) => {
    expect(krippendorffAlpha(units, metric)).toBeCloseTo(expected, 4);
  });

  it('is not the naive (c - k)^2 ordinal: that gives the interval value instead', () => {
    // The bug ADR-0022 cites: treating ordinal as squared rank distance.
    expect(krippendorffAlpha(units, 'ordinal')).not.toBeCloseTo(krippendorffAlpha(units, 'interval')!, 2);
    expect(krippendorffAlpha(units, 'ordinal')).not.toBeCloseTo(0.789, 3);
  });

  it('reads ordinal values by rank only: any increasing relabelling gives the same alpha', () => {
    const relabelled = units.map((u) => u.map((v) => v * v * 10 + 7));
    expect(krippendorffAlpha(relabelled, 'ordinal')).toBeCloseTo(krippendorffAlpha(units, 'ordinal')!, 12);
  });

  it('carries a jackknife interval around the estimate, capped at 1', () => {
    const jk = jackknifeInterval(units, 'ordinal');
    const alpha = krippendorffAlpha(units, 'ordinal')!;
    expect(jk.interval).toBeDefined();
    expect(jk.interval![0]).toBeLessThan(alpha);
    expect(jk.interval![1]).toBeGreaterThan(alpha);
    expect(jk.interval![1]).toBeLessThanOrEqual(1);
    // Regression value, independently recomputed from the leave-one-unit-out
    // estimates during review; a wrong SE formula moves it.
    expect(jk.standardError).toBeCloseTo(0.148031, 5);
  });

  it('is undefined, not 1 or 0, when nothing varies or nothing pairs', () => {
    expect(krippendorffAlpha([[3, 3], [3, 3]], 'ordinal')).toBeUndefined();
    expect(krippendorffAlpha([[1], [2], [3]], 'nominal')).toBeUndefined();
  });
});

const ORDINAL = { level: 'ordinal', preference: 'increasing', range: { min: 1, max: 5 }, levels: [1, 2, 3, 4, 5] };
const OBSERVERS = ['a', 'b', 'c', 'd'];

/** Dataset C as a comparanda analysis: units are alternatives, observers are authors. */
function datasetCAnalysis(over: {
  independence?: string | undefined;
  authors?: { id: string; principalId?: string }[];
  extraAssertions?: Record<number, unknown[]>;
  missingCodes?: unknown[];
} = {}) {
  const alternatives = units.map((_, u) => ({ id: `u${u + 1}`, label: `Unit ${u + 1}` }));
  const cells = units.map((_, u) => ({
    alternativeId: `u${u + 1}`, criterionId: 'c', measure: 'score',
    assertions: [
      ...DATASET_C.flatMap((row, o) => (row[u] === null ? [] : [{
        id: `${OBSERVERS[o]}-${u}`, authorId: OBSERVERS[o], at: '2026-09-22T00:00:00Z', version: 1,
        evidence: [], value: row[u], justification: 'coded',
        ...(over.independence === undefined ? { independence: 'independent' }
          : over.independence === 'absent' ? {} : { independence: over.independence }),
      }])),
      ...(over.extraAssertions?.[u] ?? []),
    ],
  }));
  return Analysis.parse({
    id: 'dataset-c', subject: { question: 'reliability' },
    authors: (over.authors ?? OBSERVERS.map((id) => ({ id }))).map((a) => ({ displayName: a.id, kind: 'human', ...a })),
    alternatives,
    criteria: [{ id: 'c', label: 'Code', defaultMeasurement: ORDINAL }],
    missingCodes: over.missingCodes ?? [],
    cells,
  });
}

const absence = (id: string, code: string) => ({
  id, authorId: 'd', at: '2026-09-22T00:00:00Z', version: 1, evidence: [], missing: { code }, independence: 'independent',
});

describe('agreement() over an analysis', () => {
  it('reproduces dataset C per criterion, labelled agreement when every rater is independent', () => {
    const r = agreement(datasetCAnalysis(), { measure: 'score' });
    expect(r.criteria).toHaveLength(1);
    const c = r.criteria[0]!;
    expect(c.metric).toBe('ordinal');
    expect(c.alpha).toBeCloseTo(0.8154, 4);
    expect(c.labelledAs).toBe('agreement');
    expect(c.pairableUnits).toBe(11); // unit 12 has one value
    expect(c.interval).toBeDefined();
    expect(c.band).toMatchObject({ position: 'at-or-above-upper', edges: { lower: 0.667, upper: 0.8 } });
    expect(c.band!.source).toMatch(/Krippendorff/);
  });

  it('has no matrix-wide agreement number anywhere in its result', () => {
    const r = agreement(datasetCAnalysis(), { measure: 'score' });
    expect(Object.keys(r).sort()).toEqual(['criteria', 'measure', 'notes', 'skipped', 'widenedByDisclosure']);
    expect(r.notes.join(' ')).toMatch(/no agreement figure for the whole matrix/);
  });

  it('bands act on nothing: a low alpha is still reported, with its interval', () => {
    const r = agreement(datasetCAnalysis(), { measure: 'score', bands: { lower: 0.9, upper: 0.95 } });
    expect(r.criteria[0]!.alpha).toBeCloseTo(0.8154, 4);
    expect(r.criteria[0]!.band!.position).toBe('below-lower');
    expect(r.criteria[0]!.interval).toBeDefined();
  });

  describe('labelling by independence (#64, ADR-0022 Gate 3)', () => {
    it('labels repeated draws of one agent consistency, never agreement', () => {
      const c = agreement(datasetCAnalysis({ independence: 'resampled' }), { measure: 'score' }).criteria[0]!;
      expect(c.labelledAs).toBe('consistency');
      expect(c.weakestIndependence).toBe('resampled');
      expect(c.alpha).toBeCloseTo(0.8154, 4); // a label, not a ban
      expect(c.reason).toMatch(/not agreement between raters/);
    });

    it('treats unrecorded independence as not independent', () => {
      const c = agreement(datasetCAnalysis({ independence: 'absent' }), { measure: 'score' }).criteria[0]!;
      expect(c.labelledAs).toBe('consistency');
      expect(c.weakestIndependence).toBe('unknown');
    });

    it('collapses personas of one principal: four names, two heads, is not agreement', () => {
      const authors = [{ id: 'a' }, { id: 'b', principalId: 'a' }, { id: 'c' }, { id: 'd', principalId: 'c' }];
      const c = agreement(datasetCAnalysis({ authors }), { measure: 'score' }).criteria[0]!;
      expect(c.labelledAs).toBe('consistency');
    });

    it('leaves a consensus assertion out: an agreed value is not one more observation', () => {
      const consensus = { ...absence('k', 'x'), missing: undefined, value: 5, independence: 'consensus' };
      delete (consensus as { missing?: unknown }).missing;
      const withConsensus = agreement(datasetCAnalysis({ extraAssertions: { 0: [consensus] } }), { measure: 'score' });
      expect(withConsensus.criteria[0]!.alpha).toBeCloseTo(0.8154, 4);
      expect(withConsensus.criteria[0]!.labelledAs).toBe('agreement');
    });
  });

  describe('missingness, by flags (ADR-0022, ADR-0009)', () => {
    it('counts terminal absences separately, by the core code they are or refine, without moving alpha', () => {
      const declared = [{ id: 'insufficient-evidence-to-discriminate', broader: 'indeterminate', means: 'compared directly; could not separate' }];
      const a = datasetCAnalysis({
        missingCodes: declared,
        extraAssertions: {
          9: [absence('x1', 'not-evidenced')],
          10: [absence('x2', 'indeterminate'), absence('x3', 'insufficient-evidence-to-discriminate')],
          11: [absence('x4', 'withheld'), absence('x5', 'not-assessed')],
        },
      });
      const c = agreement(a, { measure: 'score' }).criteria[0]!;
      expect(c.alpha).toBeCloseTo(0.8154, 4);
      expect(c.absentCounted).toEqual({ 'not-evidenced': 1, indeterminate: 2, withheld: 1 });
      expect(c.outstanding).toBe(1);
      expect(c.structuralExcluded).toBe(0);
    });

    it('excludes an alternative every rater marks structurally absent, including through a declared code', () => {
      const declared = [{ id: 'no-such-programme', broader: 'not-applicable', structural: true, means: 'no programme exists' }];
      const a = datasetCAnalysis({ missingCodes: declared, extraAssertions: { 5: [absence('s1', 'no-such-programme')] } });
      // Replace unit 6's values with structural absences from the same raters.
      const cell = a.cells[5]!;
      cell.assertions = cell.assertions.map((s) => ({ ...s, value: undefined, justification: undefined, missing: { code: 'no-such-programme' } }) as never);
      const c = agreement(a, { measure: 'score' }).criteria[0]!;
      expect(c.structuralExcluded).toBe(1);
      expect(c.disputedApplicability).toBe(0);
      // Same as dataset C with unit 6 removed.
      const without = units.filter((_, u) => u !== 5);
      expect(c.alpha).toBeCloseTo(krippendorffAlpha(without, 'ordinal')!, 12);
    });

    it('keeps the other raters\' values when one rater says the criterion does not apply, and reports the dispute (review finding)', () => {
      const declared = [{ id: 'no-such-programme', broader: 'not-applicable', structural: true, means: 'no programme exists' }];
      const a = datasetCAnalysis({ missingCodes: declared, extraAssertions: { 5: [absence('s1', 'no-such-programme')] } });
      const c = agreement(a, { measure: 'score' }).criteria[0]!;
      expect(c.structuralExcluded).toBe(0);
      expect(c.disputedApplicability).toBe(1);
      expect(c.alpha).toBeCloseTo(0.8154, 4);
    });
  });

  it('runs over the messy fixture, one entry per criterion with a measurement', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const a = Analysis.parse(JSON.parse(readFileSync(join(here, '..', 'examples', 'relocation.json'), 'utf8')));
    const r = agreement(a, { measure: 'score' });
    expect(r.criteria.length + r.skipped.length).toBe(a.criteria.filter((c) => !c.tombstoned).length);
    for (const c of r.criteria) {
      if (c.alpha === undefined) expect(c.reason).toBeTruthy();
    }
    expect(r.widenedByDisclosure).toBe(0);
  });
});

describe('cellShape: what a cell reports instead of a coefficient', () => {
  const LEVELS = [1, 2, 3, 4, 5];
  it('reports n, the multiset, extremes, span and modes -- and no mean', () => {
    const s = cellShape([2, 4, 4], LEVELS);
    expect(s).toMatchObject({ n: 3, min: 2, max: 4, span: 2, modes: [4], polarised: false });
    expect(s.multiset.map((m) => m.count)).toEqual([0, 1, 0, 2, 0]);
    expect(Object.keys(s)).not.toContain('mean');
  });

  it('flags a split across an empty level with no dominant mode as polarised', () => {
    expect(cellShape([1, 1, 5, 5], LEVELS).polarised).toBe(true);
    expect(cellShape([4, 4, 5, 5], LEVELS).polarised).toBe(false); // adjacent: no gap
    expect(cellShape([1, 5, 5, 5], LEVELS).polarised).toBe(false); // one dominant mode
    expect(cellShape([1, 1, 3, 3], LEVELS, { gap: 2 }).polarised).toBe(false); // gap is configuration
  });

  it('is empty, not wrong, for an empty cell', () => {
    expect(cellShape([], LEVELS)).toMatchObject({ n: 0, span: 0, modes: [], polarised: false });
  });
});
