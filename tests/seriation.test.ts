/**
 * Seriation: OLO over a missingness-aware Gower distance (#80, ADR-0025).
 *
 * The load-bearing property is locality: a pair's distance is a fact about the
 * pair, so adding a third alternative cannot move it. Sample-rank scoring would
 * break that, which is why ADR-0025 forbids it, and why the first test here is
 * the one that would catch a regression to it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Analysis } from '../src/core/schema/analysis.js';
import { seriate, gowerDistance, SERIATION_ASSUMPTIONS } from '../src/core/analyses/seriation.js';
import { AxisOrder } from '../src/core/view-state.js';

const examples = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const relocation = () => Analysis.parse(JSON.parse(readFileSync(join(examples, 'relocation.json'), 'utf8')));

const ORD = { level: 'ordinal', preference: 'increasing', range: { min: 1, max: 5 }, levels: [1, 2, 3, 4, 5] };
const COST = { level: 'ratio', preference: 'decreasing', range: { min: 0, max: 100 } };

type V = number | undefined | 'na';

/** Rows of values per alternative, one column per criterion measurement given. */
function doc(measurements: Record<string, unknown>[], rows: Record<string, V[]>) {
  const criteria = measurements.map((m, j) => ({ id: `c${j}`, label: `C${j}`, defaultMeasurement: m }));
  return Analysis.parse({
    id: 's', subject: { question: 'q' }, authors: [{ id: 'a', displayName: 'a', kind: 'human' }],
    alternatives: Object.keys(rows).map((id) => ({ id, label: id })),
    criteria,
    cells: Object.entries(rows).flatMap(([alt, vals]) => vals.map((v, j) => ({
      alternativeId: alt, criterionId: `c${j}`, measure: 'score',
      assertions: [{
        id: `${alt}${j}`, authorId: 'a', at: '2026-01-01T00:00:00Z', version: 1, evidence: [],
        ...(v === undefined ? { missing: { code: 'not-assessed' } }
          : v === 'na' ? { missing: { code: 'not-applicable' } }
            : { value: v, justification: 'j' }),
      }],
    }))),
  });
}

const run = (a: Analysis, extra: Record<string, unknown> = {}) => seriate(a, { measure: 'score', minOverlap: 1, ...extra });

describe('the distance is a fact about the pair (#80, ADR-0025)', () => {
  it('adding a third alternative does not change the distance between the first two', () => {
    const two = doc([ORD, ORD, ORD], { x: [1, 2, 3], y: [5, 4, 3] });
    const three = doc([ORD, ORD, ORD], { x: [1, 2, 3], y: [5, 4, 3], z: [3, 3, 3] });
    const pair = gowerDistance(two, 'x', 'y', { measure: 'score' });
    const withThird = gowerDistance(three, 'x', 'y', { measure: 'score' });
    expect(pair.distance).toBeGreaterThan(0);
    expect(withThird.distance).toBeCloseTo(pair.distance, 12);
    expect(withThird.overlap).toBe(pair.overlap);

    // And through the full run, where all three are placed.
    const both = run(three).distances;
    const i = both.ids.indexOf('x');
    const j = both.ids.indexOf('y');
    expect(both.distance[i]![j]!).toBeCloseTo(pair.distance, 12);
  });

  it('scores ordinal levels by declared index, so an unused level still counts as span', () => {
    // 1 and 3 on a declared 1..5 scale are half a scale apart, whatever else is
    // in the document. A sample-rank scoring would make them adjacent.
    const a = doc([ORD], { x: [1], y: [3] });
    expect(gowerDistance(a, 'x', 'y', { measure: 'score' }).distance).toBeCloseTo(0.5, 12);
  });

  it('carries the per-pair comparison count out of the distance, not just the distance', () => {
    const a = doc([ORD, ORD, ORD], { x: [1, undefined, 3], y: [5, 4, 3] });
    expect(gowerDistance(a, 'x', 'y', { measure: 'score' }).overlap).toBe(2);
  });
});

describe('missingness, by flag and never by literal code', () => {
  it('counts a shared structural absence as similarity, and a one-sided one as difference', () => {
    const shared = doc([ORD, ORD], { x: [3, 'na'], y: [3, 'na'] });
    const oneSided = doc([ORD, ORD], { x: [3, 'na'], y: [3, 4] });
    expect(gowerDistance(shared, 'x', 'y', { measure: 'score' }).distance).toBeCloseTo(0, 12);
    expect(gowerDistance(oneSided, 'x', 'y', { measure: 'score' }).distance).toBeCloseTo(0.5, 12);
  });

  it('drops a contingent blank out of both sums rather than reading it as agreement', () => {
    const a = doc([ORD, ORD], { x: [3, undefined], y: [3, undefined] });
    const d = gowerDistance(a, 'x', 'y', { measure: 'score' });
    expect(d.overlap).toBe(1);
    expect(d.distance).toBeCloseTo(0, 12);
  });

  it('honours skip-all: a structural absence then compares nothing', () => {
    const a = doc([ORD, ORD], { x: [3, 'na'], y: [3, 'na'] });
    const skip = seriate(a, { measure: 'score', minOverlap: 1, missingPolicy: 'skip-all' });
    const i = skip.distances.ids.indexOf('x');
    const j = skip.distances.ids.indexOf('y');
    expect(skip.distances.overlap[i]![j]!).toBe(1);
    expect(skip.missingPolicy).toBe('skip-all');
  });
});

describe('the minOverlap guard parks, visibly (#80)', () => {
  it('returns a thin alternative parked with its count, never dropped', () => {
    const a = doc([ORD, ORD, ORD, ORD], {
      x: [1, 2, 3, 4], y: [2, 3, 4, 5], z: [5, 4, 3, 2],
      thin: [3, undefined, undefined, undefined],
    });
    const r = run(a, { minOverlap: 3 });
    expect(r.parked.map((p) => p.id)).toEqual(['thin']);
    expect(r.parked[0]!.comparable).toBe(1);
    expect(r.parked[0]!.reason).toMatch(/minimum overlap/);
    // Still in the order, at the end: parked is not dropped.
    expect(r.order).toHaveLength(4);
    expect(r.order[r.order.length - 1]).toBe('thin');
    expect(r.distances.ids).not.toContain('thin');
    expect(r.notes.join(' ')).toMatch(/parked/);
  });

  it('defaults the guard from the number of usable features, and says so on a narrow matrix', () => {
    const r = run(doc([ORD, ORD], { x: [1, 2], y: [2, 3] }), { minOverlap: undefined });
    expect(r.minOverlap).toBe(2);
    expect(r.parked).toEqual([]);
    expect(r.notes.join(' ')).toMatch(/minOverlap/);
  });
});

describe('pins and locked runs are inputs, so a manual arrangement survives a re-run (#80)', () => {
  const a = () => doc([ORD, ORD, ORD], {
    x: [1, 1, 1], y: [2, 2, 2], z: [4, 4, 4], w: [5, 5, 5],
  });

  it('a pinned alternative is at its pinned position, on this run and the next', () => {
    const constraints = { pins: [{ id: 'w', position: 0 }] };
    const first = run(a(), { constraints });
    expect(first.order[0]).toBe('w');
    const again = run(a(), { constraints });
    expect(again.order).toEqual(first.order);
    expect(again.order[0]).toBe('w');
    // The pins are recorded as what they were: inputs to the run.
    expect(first.provenance.kind).toBe('seriated');
    if (first.provenance.kind === 'seriated') {
      expect(first.provenance.params.pins).toEqual([{ id: 'w', position: 0 }]);
    }
  });

  it('two pins hold their own positions', () => {
    const r = run(a(), { constraints: { pins: [{ id: 'z', position: 0 }, { id: 'x', position: 3 }] } });
    expect(r.order[0]).toBe('z');
    expect(r.order[3]).toBe('x');
  });

  it('a locked run stays contiguous and in the order it was locked in', () => {
    // w and x are the two ends of the scale, so nothing but the lock would put
    // them side by side: the plain run orders them x, y, z, w.
    expect(run(a()).order).toEqual(['x', 'y', 'z', 'w']);
    const r = run(a(), { constraints: { lockedRuns: [['w', 'x']] } });
    const i = r.order.indexOf('w');
    expect(r.order[i + 1]).toBe('x');
    if (r.provenance.kind === 'seriated') expect(r.provenance.params.lockedRuns).toEqual([['w', 'x']]);
  });

  it('a locked run survives a re-run, as pins do', () => {
    const constraints = { lockedRuns: [['w', 'x']] };
    expect(run(a(), { constraints }).order).toEqual(run(a(), { constraints }).order);
  });
});

describe('the provenance record explains the arrangement (#80, ADR-0025)', () => {
  it('records the method, the linkage chosen and the parameters, and fits AxisOrder', () => {
    const r = run(doc([ORD, ORD, ORD], { x: [1, 2, 1], y: [2, 1, 2], z: [5, 5, 5] }), { at: '2026-09-22T00:00:00Z' });
    expect(r.provenance.kind).toBe('seriated');
    if (r.provenance.kind !== 'seriated') throw new Error('expected a seriated provenance');
    expect(r.provenance.method).toBe('olo-hierarchical');
    expect(['single', 'average', 'complete']).toContain(r.provenance.linkage);
    expect(r.provenance.distance).toBe('gower/structural-matches');
    expect(r.provenance.missingPolicy).toBe('structural-matches');
    expect(r.provenance.minOverlap).toBe(r.minOverlap);
    expect(r.provenance.pathLength).toBeCloseTo(r.pathLength, 12);
    expect(r.provenance.params.sizeLimit).toBe(40);
    // It is exactly what view state stores beside an order.
    const parsed = AxisOrder.parse({ order: r.order, provenance: r.provenance });
    expect(parsed.provenance.kind).toBe('seriated');
  });

  it('measures the three linkages rather than guessing, and keeps the lowest path length', () => {
    const r = run(doc([ORD, ORD, ORD], { x: [1, 1, 2], y: [2, 1, 1], z: [5, 4, 5], w: [4, 5, 4] }));
    expect(Object.keys(r.pathLengths).sort()).toEqual(['average', 'complete', 'single']);
    const lowest = Math.min(...Object.values(r.pathLengths) as number[]);
    expect(r.pathLength).toBeCloseTo(lowest, 12);
    expect(r.pathLengths[r.linkage]).toBeCloseTo(lowest, 12);
  });

  it('returns the equal-spacing assumption for the UI to display', () => {
    const r = run(doc([ORD], { x: [1], y: [5] }));
    expect(r.assumptions).toBe(SERIATION_ASSUMPTIONS);
    expect(r.assumptions.join(' ')).toMatch(/equally spaced/);
    expect(r.assumptions.join(' ')).toMatch(/declared level index/);
  });

  it('excludes a criterion it cannot score, and names it (ADR-0025 amendment)', () => {
    const a = doc([ORD, { level: 'ordinal', preference: 'increasing' }], { x: [1, 2], y: [5, 4] });
    const r = run(a);
    expect(r.excludedFeatures.map((e) => [e.featureId, e.reason])).toEqual([['c1', 'unscoreable-level']]);
    expect(r.notes.join(' ')).toMatch(/excluded/);
  });
});

describe('a single-criterion sort is the same code path', () => {
  it('orders by the criterion, best first, and records a sorted provenance', () => {
    const a = doc([ORD, ORD], { x: [1, 5], y: [4, 1], z: [2, 3] });
    const best = seriate(a, { measure: 'score', minOverlap: 1, sortBy: { criterionId: 'c0', direction: 'best-first' } });
    expect(best.order).toEqual(['y', 'z', 'x']);
    expect(best.provenance).toMatchObject({ kind: 'sorted', criterionId: 'c0', direction: 'best-first' });
    const worst = seriate(a, { measure: 'score', minOverlap: 1, sortBy: { criterionId: 'c0', direction: 'worst-first' } });
    expect(worst.order).toEqual(['x', 'z', 'y']);
  });

  it('orients by the declared direction of preference: on a cost, lower is best', () => {
    const a = doc([COST], { cheap: [10], dear: [90], middling: [50] });
    const r = seriate(a, { measure: 'score', minOverlap: 1, sortBy: { criterionId: 'c0', direction: 'best-first' } });
    expect(r.order).toEqual(['cheap', 'middling', 'dear']);
  });

  it('parks an alternative with no value for the sort criterion, at the end', () => {
    const a = doc([ORD], { x: [1], y: [5], blank: [undefined] });
    const r = seriate(a, { measure: 'score', sortBy: { criterionId: 'c0', direction: 'best-first' } });
    expect(r.parked.map((p) => p.id)).toEqual(['blank']);
    expect(r.order[r.order.length - 1]).toBe('blank');
  });

  it('refuses a sort criterion that is not in scope', () => {
    expect(() => seriate(doc([ORD], { x: [1] }), { measure: 'score', sortBy: { criterionId: 'nope', direction: 'best-first' } }))
      .toThrow(/nope/);
  });
});

describe('over the messy fixture', () => {
  it('arranges the alternatives, identically twice, and accounts for every one', () => {
    const a = relocation();
    const first = seriate(a, { measure: 'score' });
    const second = seriate(a, { measure: 'score' });
    expect(second.order).toEqual(first.order);
    expect([...first.order].sort()).toEqual([...a.alternatives.map((x) => x.id)].sort());
    expect(first.pathLength).toBeGreaterThanOrEqual(0);
    expect(first.provenance.kind).toBe('seriated');
  });

  it('orders the criteria axis independently, on the same document', () => {
    const a = relocation();
    const r = seriate(a, { measure: 'score', axis: 'criteria' });
    expect(r.axis).toBe('criteria');
    const usable = a.criteria.map((c) => c.id).filter((id) => !r.excludedFeatures.some((e) => e.featureId === id));
    expect([...r.order].sort()).toEqual([...usable].sort());
  });

  it('never writes anything: the analysis is untouched', () => {
    const a = relocation();
    const before = JSON.stringify(a);
    seriate(a, { measure: 'score', constraints: { pins: [{ id: 'berlin', position: 0 }] } });
    expect(JSON.stringify(a)).toBe(before);
  });
});
