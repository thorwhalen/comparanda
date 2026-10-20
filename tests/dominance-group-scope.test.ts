/**
 * Dominance scoped to an alternatives group (#78, ADR-0019 clause 3).
 *
 * The group is the natural scope: a group-pair inapplicability block makes the
 * criterion structurally absent for every member, so within the group the basis
 * is homogeneous. The scope is named, never defaulted.
 */
import { describe, it, expect } from 'vitest';

import { blanksWorthFilling, dominance, dominanceScope, explainDominance } from '../src/core/analyses/dominance.js';
import { Analysis } from '../src/core/schema/analysis.js';

const range = { level: 'ratio', preference: 'increasing', range: { min: 0, max: 10 } };

function fixture() {
  const alts = [
    { id: 'p', groupIds: ['europe'] },
    { id: 'q', groupIds: ['berlin'] },
    { id: 'r', groupIds: ['asia'] },
    { id: 's', groupIds: ['asia'] },
  ];
  const values: Record<string, Record<string, number | null>> = {
    p: { c1: 5, c2: 5 }, q: { c1: 3, c2: 3 }, r: { c1: 9, c2: null }, s: { c1: 1, c2: null },
  };
  const cells = alts.flatMap((alt) => ['c1', 'c2'].map((cid) => {
    const v = values[alt.id]![cid];
    const assertion: Record<string, unknown> = {
      id: `${alt.id}-${cid}`, authorId: 'a', at: '2026-01-01T00:00:00Z', evidence: [], version: 1,
    };
    if (v === null) assertion.missing = { code: 'not-applicable' };
    else { assertion.value = v; assertion.justification = 'invented'; }
    return { alternativeId: alt.id, criterionId: cid, measure: 'score', assertions: [assertion] };
  }));
  return Analysis.parse({
    id: 'scope', subject: { question: 'group scope' }, measures: [{ name: 'score' }],
    authors: [{ id: 'a', displayName: 'gen', kind: 'derived' }],
    alternatives: alts.map((x) => ({ ...x, label: x.id.toUpperCase() })),
    criteria: [
      { id: 'c1', label: 'C1', groupIds: [], measurements: { score: range } },
      { id: 'c2', label: 'C2', groupIds: ['eu-only'], measurements: { score: range } },
    ],
    groups: [
      { id: 'europe', label: 'Europe', axis: 'alternatives' },
      { id: 'berlin', label: 'Berlin', axis: 'alternatives', parentId: 'europe' },
      { id: 'asia', label: 'Asia', axis: 'alternatives' },
      { id: 'eu-only', label: 'EU only', axis: 'criteria' },
    ],
    inapplicable: [{ alternativeGroupId: 'asia', criterionGroupId: 'eu-only' }],
    cells,
  });
}

describe('dominance scoped to an alternatives group', () => {
  it('compares only the group, sub-groups included', () => {
    const a = fixture();
    expect(dominanceScope(a, { groupId: 'europe' })).toEqual(['p', 'q']);
    const r = dominance(a, { measure: 'score', groupId: 'europe' });
    expect(r.nonDominated).toEqual(['p']);
    expect(r.dominated).toEqual(['q']);
    expect(r.basisDescription).toContain('across 2 options in "Europe"');
    expect(r.basisDescription).not.toContain('not applicable');
  });

  it('within a group whose block is declared, applicability is homogeneous', () => {
    const r = dominance(fixture(), { measure: 'score', groupId: 'asia' });
    expect(r.nonDominated).toEqual(['r']);
    expect(r.dominated).toEqual(['s']);
    expect(r.basisDescription).toContain('2 cells not applicable');
  });

  it('defaults to the whole analysis, and says so without a group', () => {
    const r = dominance(fixture(), { measure: 'score' });
    expect(r.basisDescription).toContain('across 4 options;');
    expect(r.basisDescription).not.toContain(' in "');
  });

  it('explanations and blanks read the same scope', () => {
    const a = fixture();
    expect(explainDominance(a, 'p', 'q', { measure: 'score', groupId: 'europe' }).basisDescription)
      .toContain('in "Europe"');
    expect(() => explainDominance(a, 'p', 'r', { measure: 'score', groupId: 'europe' })).toThrow(/not an alternative in scope/);
    expect(blanksWorthFilling(a, { measure: 'score', groupId: 'europe' }).blanks).toEqual([]);
  });

  it('refuses an unknown group, a criteria group, and a doubled scope', () => {
    const a = fixture();
    expect(() => dominance(a, { measure: 'score', groupId: 'nowhere' })).toThrow(/not a live alternatives group/);
    expect(() => dominance(a, { measure: 'score', groupId: 'eu-only' })).toThrow(/not a live alternatives group/);
    expect(() => dominance(a, { measure: 'score', groupId: 'asia', alternativeIds: ['r'] })).toThrow(/not both/);
  });
});
