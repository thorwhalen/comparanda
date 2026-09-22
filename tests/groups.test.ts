/**
 * Groups through `@zodal/groups-core` (#47, ADR-0008).
 *
 * The stored shape is unchanged -- `groupIds` on rows, `parentId` on groups --
 * and the membership questions are answered by the library over a space built
 * from the document. These tests pin the four things #47 asks of groups, plus
 * the adapter's own promises: namespacing, derived rank, a cycle that does not
 * throw, and inapplicability by closure.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Analysis, completeness, isInapplicable, validateAnalysis } from '../src/core/schema/analysis.js';
import {
  axisGroups, groupsOf, groupScopeFilter, makeInapplicability, membersOfGroup,
} from '../src/core/schema/groups.js';

const ORDINAL = {
  level: 'ordinal', preference: 'increasing', range: { min: 1, max: 5 }, levels: [1, 2, 3, 4, 5],
};

/**
 * Europe > Germany > Berlin-ish rows. `lisbon` is in two groups on the same
 * axis (Europe directly, and "coastal"); `tokyo` is in Asia.
 */
const doc = (extra: Record<string, unknown> = {}) => Analysis.parse({
  id: 'g', subject: { question: 'where?' },
  authors: [{ id: 'ana', displayName: 'Ana', kind: 'human' }],
  groups: [
    { id: 'europe', label: 'Europe', axis: 'alternatives' },
    { id: 'germany', label: 'Germany', axis: 'alternatives', parentId: 'europe' },
    { id: 'coastal', label: 'Coastal', axis: 'alternatives' },
    { id: 'asia', label: 'Asia', axis: 'alternatives' },
    { id: 'eu-rules', label: 'EU rules', axis: 'criteria' },
    { id: 'residency', label: 'Residency', axis: 'criteria', parentId: 'eu-rules' },
  ],
  alternatives: [
    { id: 'munich', label: 'Munich', groupIds: ['germany'] },
    { id: 'lisbon', label: 'Lisbon', groupIds: ['europe', 'coastal'] },
    { id: 'berlin', label: 'Berlin', groupIds: ['germany'] },
    { id: 'tokyo', label: 'Tokyo', groupIds: ['asia', 'coastal'] },
  ],
  criteria: [
    { id: 'rent', label: 'Rent', defaultMeasurement: ORDINAL },
    { id: 'visa', label: 'Visa', defaultMeasurement: ORDINAL, groupIds: ['residency'] },
  ],
  cells: [],
  ...extra,
});

describe('many-to-many membership (#47 item 1)', () => {
  it('puts one row in several groups on the same axis', () => {
    const ag = axisGroups(doc(), 'alternatives');
    expect(groupsOf(ag, 'lisbon', { expand: 'direct' }).sort()).toEqual(['coastal', 'europe']);
    expect(membersOfGroup(ag, 'coastal')).toEqual(['lisbon', 'tokyo']);
    expect(membersOfGroup(ag, 'europe')).toContain('lisbon');
  });

  it('reads nesting by closure: a row in a sub-group is in the group', () => {
    const ag = axisGroups(doc(), 'alternatives');
    expect(groupsOf(ag, 'berlin').sort()).toEqual(['europe', 'germany']);
    expect(groupsOf(ag, 'berlin', { expand: 'direct' })).toEqual(['germany']);
    // Closure lists each member once, in axis order.
    expect(membersOfGroup(ag, 'europe')).toEqual(['munich', 'lisbon', 'berlin']);
    expect(membersOfGroup(ag, 'europe', { expand: 'direct' })).toEqual(['lisbon']);
  });

  it('keeps the axes apart', () => {
    const alts = axisGroups(doc(), 'alternatives');
    const crits = axisGroups(doc(), 'criteria');
    expect(groupsOf(alts, 'visa')).toEqual([]);
    expect(groupsOf(crits, 'visa').sort()).toEqual(['eu-rules', 'residency']);
  });

  it('derives the within-group rank from axis order, compared by code unit', () => {
    const ag = axisGroups(doc(), 'alternatives');
    expect(membersOfGroup(ag, 'germany', { expand: 'direct' })).toEqual(['munich', 'berlin']);
    // Reordering the axis reorders the group: the rank is derived, not stored.
    const swapped = doc();
    swapped.alternatives.reverse();
    expect(membersOfGroup(axisGroups(swapped, 'alternatives'), 'germany', { expand: 'direct' }))
      .toEqual(['berlin', 'munich']);
  });

  it('gives a store filter over the stored groupIds, closure included', () => {
    const ag = axisGroups(doc(), 'alternatives');
    const f = groupScopeFilter(ag, 'europe');
    expect(f.field).toBe('groupIds');
    expect(f.operator).toBe('arrayContainsAny');
    expect(f.value.sort()).toEqual(['europe', 'germany']);
    // And the filter selects exactly the closure's members.
    const selected = doc().alternatives
      .filter((x) => x.groupIds.some((g) => f.value.includes(g))).map((x) => x.id);
    expect(selected).toEqual(membersOfGroup(ag, 'europe'));
    expect(groupScopeFilter(ag, 'europe', { expand: 'direct' }).value).toEqual(['europe']);
  });

  it('does not confuse a group and a row that share an id', () => {
    const d = doc({
      groups: [{ id: 'same', label: 'Group', axis: 'alternatives' }],
      alternatives: [{ id: 'same', label: 'Row', groupIds: ['same'] }],
    });
    const ag = axisGroups(d, 'alternatives');
    expect(membersOfGroup(ag, 'same')).toEqual(['same']);
    expect(groupsOf(ag, 'same')).toEqual(['same']);
  });

  it('survives a nesting cycle: the closing edge is refused, not thrown', () => {
    const d = doc({
      groups: [
        { id: 'a', label: 'A', axis: 'alternatives', parentId: 'b' },
        { id: 'b', label: 'B', axis: 'alternatives', parentId: 'a' },
      ],
      alternatives: [{ id: 'x', label: 'X', groupIds: ['a'] }],
    });
    const ag = axisGroups(d, 'alternatives');
    expect(ag.refused).toHaveLength(1);
    expect(ag.refused[0]!.kind).toBe('nesting');
    expect(ag.refused[0]!.codes).toContain('cycle');
    expect(groupsOf(ag, 'x', { expand: 'direct' })).toEqual(['a']);
    const v = validateAnalysis(d);
    expect(v.problems.some((p) => p.ruleId === 'group-nesting-acyclic')).toBe(true);
  });
});

describe('group-pair inapplicability (#47 item 2) -- ours, not the library\'s', () => {
  const blocked = () => doc({
    inapplicable: [{ alternativeGroupId: 'asia', criterionGroupId: 'eu-rules' }],
  });

  it('covers members of sub-groups on both axes', () => {
    // The block names `eu-rules`; `visa` is in its sub-group `residency`.
    expect(isInapplicable(blocked(), 'tokyo', 'visa')).toBe(true);
    expect(isInapplicable(blocked(), 'tokyo', 'rent')).toBe(false);
    expect(isInapplicable(blocked(), 'berlin', 'visa')).toBe(false);
  });

  it('covers a nested alternatives group too', () => {
    const d = doc({ inapplicable: [{ alternativeGroupId: 'europe', criterionGroupId: 'residency' }] });
    const f = makeInapplicability(d);
    expect(f('berlin', 'visa')).toBe(true); // berlin ∈ germany ⊂ europe
    expect(f('lisbon', 'visa')).toBe(true);
    expect(f('tokyo', 'visa')).toBe(false);
  });

  it('auto-populates not-applicable, and wins over an author-set contingent code', () => {
    const d = blocked();
    d.cells.push({
      alternativeId: 'tokyo', criterionId: 'visa', measure: 'score',
      assertions: [{
        id: 's', authorId: 'ana', at: '2026-08-22T00:00:00Z', version: 1, evidence: [],
        missing: { code: 'deferred' },
      }],
    } as never);
    const c = completeness(d, { measure: 'score', alternativeIds: ['tokyo'], criterionIds: ['visa'] });
    // Counted as structurally absent, not as the author's outstanding `deferred`.
    expect(c.total).toBe(1);
    expect(c.structural).toBe(1);
    expect(c.outstanding).toBe(0);
  });

  it('costs nothing when no block is declared', () => {
    expect(makeInapplicability(doc())('tokyo', 'visa')).toBe(false);
  });
});

describe('groups are analysis data, and nothing else (#47 items 3-4)', () => {
  it('refuses a group used on the wrong axis', () => {
    const d = {
      id: 'g', subject: { question: 'q' }, authors: [],
      groups: [{ id: 'crit-group', label: 'C', axis: 'criteria' }],
      alternatives: [{ id: 'x', label: 'X', groupIds: ['crit-group'] }],
      inapplicable: [{ alternativeGroupId: 'crit-group', criterionGroupId: 'crit-group' }],
    };
    const hits = validateAnalysis(d).problems.filter((p) => p.ruleId === 'group-on-its-axis');
    expect(hits.map((p) => p.path).sort()).toEqual(['alternatives[0].groupIds', 'inapplicable[0].alternativeGroupId']);
  });

  it('refuses an unknown parent group', () => {
    const d = {
      id: 'g', subject: { question: 'q' }, authors: [],
      groups: [{ id: 'a', label: 'A', axis: 'alternatives', parentId: 'nowhere' }],
    };
    expect(validateAnalysis(d).problems.some((p) => p.ruleId === 'group-exists' && p.path === 'groups[0].parentId'))
      .toBe(true);
  });

  it('has no representation for selection', () => {
    // ADR-0008: selection is view state. The group schema has no field that
    // could hold "these three, for me, right now".
    const keys = Object.keys(Analysis.parse({ id: 'g', subject: { question: 'q' } }));
    expect(keys.some((k) => /select/i.test(k))).toBe(false);
  });

  it('keeps the messy fixture\'s blocks where they were', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const a = Analysis.parse(JSON.parse(readFileSync(join(here, '..', 'examples', 'relocation.json'), 'utf8')));
    const f = makeInapplicability(a);
    const expected = (alt: string, crit: string) => a.inapplicable.some((b) =>
      a.alternatives.find((x) => x.id === alt)!.groupIds.includes(b.alternativeGroupId) &&
      a.criteria.find((x) => x.id === crit)!.groupIds.includes(b.criterionGroupId));
    // The fixture has no nested groups, so closure must agree with the flat rule.
    for (const alt of a.alternatives) {
      for (const crit of a.criteria) expect(f(alt.id, crit.id)).toBe(expected(alt.id, crit.id));
    }
  });
});
