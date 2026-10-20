/**
 * Group-informed consensus (#111, ADR-0011 clause 8): cell by cell, whether
 * camps a person named share ground; per-criterion counts and no matrix-wide
 * number; nothing averaged; nothing grouped by the analysis itself.
 */
import { describe, it, expect } from 'vitest';

import { Analysis } from '../src/core/schema/analysis.js';
import { consensusAnalysis, groupInformedConsensus, type Camp } from '../src/index.js';

const ORDINAL = { level: 'ordinal', preference: 'increasing', range: { min: 1, max: 5 }, levels: [1, 2, 3, 4, 5] } as const;
const human = (id: string, over: Record<string, unknown> = {}) => ({ id, displayName: id, kind: 'human', ...over });
const s = (id: string, authorId: string, value: number, over: Record<string, unknown> = {}) =>
  ({ id, authorId, at: '2026-10-20T00:00:00Z', value, justification: 'j', independence: 'independent' as const, ...over });

const doc = () => Analysis.parse({
  id: 'a', subject: { question: 'q' },
  authors: [human('ana'), human('al'), human('bo'), human('bea'), human('ana-as-buyer', { principalId: 'ana' })],
  alternatives: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }, { id: 'z', label: 'Z' }],
  criteria: [{ id: 'c', label: 'C', defaultMeasurement: ORDINAL }, { id: 'kind', label: 'Kind', defaultMeasurement: { level: 'nominal', preference: 'none' } }],
  cells: [
    // Camps overlap on 3: shared ground although they lean apart.
    { alternativeId: 'x', criterionId: 'c', measure: 'score', assertions: [s('1', 'ana', 2), s('2', 'al', 3), s('3', 'bo', 3), s('4', 'bea', 5)] },
    // Disjoint ranges: divided. The persona counts as Ana's camp.
    { alternativeId: 'y', criterionId: 'c', measure: 'score', assertions: [s('5', 'ana-as-buyer', 1), s('6', 'bo', 4)] },
    // Camp B silent: not compared.
    { alternativeId: 'z', criterionId: 'c', measure: 'score', assertions: [s('7', 'ana', 4)] },
  ],
});
const CAMPS: Camp[] = [{ id: 'A', label: 'A', authorIds: ['ana', 'al'] }, { id: 'B', label: 'B', authorIds: ['bo', 'bea'] }];

describe('groupInformedConsensus', () => {
  it('says shared, divided or not compared per cell, with what is common, and counts per criterion only', () => {
    const r = groupInformedConsensus(doc(), { measure: 'score', camps: CAMPS, criterionIds: ['c'] });
    const at = (alt: string) => r.cells.find((c) => c.alternativeId === alt)!;
    expect(at('x')).toMatchObject({ status: 'shared', common: [3], camps: [{ campId: 'A', values: [2, 3] }, { campId: 'B', values: [3, 5] }] });
    expect(at('y').status).toBe('divided');
    expect(at('z')).toMatchObject({ status: 'not-compared', silent: ['B'] });
    expect(r.criteria).toEqual([{ criterionId: 'c', shared: 1, divided: 1, notCompared: 1 }]);
    expect(Object.keys(r).sort()).toEqual(['assumptions', 'cells', 'criteria', 'measure', 'skipped', 'widenedByDisclosure']);
    expect(r.assumptions.join(' ')).toMatch(/named by a person/);
  });

  it('reads a nominal criterion as sets, and skips a criterion with no measurement for the measure', () => {
    const a = doc();
    const nominal = { ...a, cells: [{ alternativeId: 'x', criterionId: 'kind', measure: 'score', assertions: [s('n1', 'ana', 1), s('n2', 'bo', 1), s('n3', 'bo', 2)] }] };
    const r = groupInformedConsensus(Analysis.parse(nominal), { measure: 'score', camps: CAMPS, criterionIds: ['kind'] });
    expect(r.cells.find((c) => c.alternativeId === 'x')).toMatchObject({ status: 'shared', common: [1] });
    const scoreOnly = { ...a, criteria: [{ ...a.criteria[0]!, defaultMeasurement: undefined, measurements: { score: ORDINAL } }] };
    expect(groupInformedConsensus(Analysis.parse(scoreOnly), { measure: 'confidence', camps: CAMPS }).skipped.map((x) => x.criterionId)).toEqual(['c']);
  });

  it('leaves superseded and consensus assertions out', () => {
    const a = doc();
    const cells = a.cells.map((c) => (c.alternativeId === 'y'
      ? { ...c, assertions: [{ ...c.assertions[0]!, supersededBy: '8' }, c.assertions[1]!, { ...s('8', 'ana', 4), version: 1, evidence: [] }, { ...s('9', 'bo', 1, { independence: 'consensus' }), version: 1, evidence: [] }] }
      : c));
    const r = groupInformedConsensus({ ...a, cells }, { measure: 'score', camps: CAMPS, criterionIds: ['c'] });
    expect(r.cells.find((c) => c.alternativeId === 'y')).toMatchObject({ status: 'shared', common: [4] });
  });

  it('refuses one camp, or an author on two sides, and is a registered definition', () => {
    expect(() => groupInformedConsensus(doc(), { measure: 'score', camps: CAMPS.slice(0, 1) })).toThrow(/at least two camps/);
    expect(() => groupInformedConsensus(doc(), { measure: 'score', camps: [...CAMPS, { id: 'C', label: 'C', authorIds: ['ana'] }] })).toThrow(/one author takes one/);
    expect(() => groupInformedConsensus(doc(), { measure: 'score', camps: [{ id: 'A', label: 'A', authorIds: ['ana'] }, { id: 'A', label: 'A2', authorIds: ['bo'] }] }))
      .toThrow(/share an id/);
    expect(consensusAnalysis.id).toBe('group-informed-consensus');
  });
});
