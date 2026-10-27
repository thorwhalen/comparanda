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
import { tombstone, reopenedByTombstone, tombstonedGroupProblems } from '../src/core/schema/anchors.js';
import { alternativeScope } from '../src/core/analyses/scope.js';
import { inMemoryAnalysisSource } from '../src/store/index.js';

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

  it('refuses a group that is its own parent (review finding: the one-group cycle)', () => {
    const d = {
      id: 'g', subject: { question: 'q' }, authors: [],
      groups: [{ id: 'a', label: 'A', axis: 'alternatives', parentId: 'a' }],
    };
    const r = validateAnalysis(d);
    expect(r.ok).toBe(false);
    expect(r.problems.some((p) => p.ruleId === 'group-nesting-acyclic' && p.path === 'groups[0].parentId')).toBe(true);
  });

  it('refuses a two-group nesting cycle', () => {
    const d = {
      id: 'g', subject: { question: 'q' }, authors: [],
      groups: [
        { id: 'a', label: 'A', axis: 'alternatives', parentId: 'b' },
        { id: 'b', label: 'B', axis: 'alternatives', parentId: 'a' },
      ],
    };
    expect(validateAnalysis(d).problems.some((p) => p.ruleId === 'group-nesting-acyclic')).toBe(true);
  });

  it('refuses a parent group on the other axis', () => {
    const d = {
      id: 'g', subject: { question: 'q' }, authors: [],
      groups: [
        { id: 'crit', label: 'C', axis: 'criteria' },
        { id: 'alt', label: 'A', axis: 'alternatives', parentId: 'crit' },
      ],
    };
    const hits = validateAnalysis(d).problems.filter((p) => p.ruleId === 'group-on-its-axis');
    expect(hits.map((p) => p.path)).toEqual(['groups[1].parentId']);
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

describe('a tombstoned group groups nothing (#51)', () => {
  const base = () => Analysis.parse({
    id: 't', subject: { question: 'q' },
    alternatives: [{ id: 'x', label: 'X', groupIds: ['ga'] }, { id: 'y', label: 'Y', groupIds: ['gsub'] }],
    criteria: [{ id: 'c', label: 'C', groupIds: ['gc'], defaultMeasurement: { level: 'ratio', preference: 'increasing', range: { min: 0, max: 1 } } }],
    groups: [
      { id: 'ga', label: 'A', axis: 'alternatives' },
      { id: 'gsub', label: 'Sub', axis: 'alternatives', parentId: 'ga' },
      { id: 'gc', label: 'C', axis: 'criteria' },
    ],
    inapplicable: [{ alternativeGroupId: 'ga', criterionGroupId: 'gc' }],
  });

  it('drops its memberships and its block, and promotes its sub-groups', () => {
    const live = base();
    expect(makeInapplicability(live)('x', 'c')).toBe(true);
    expect(makeInapplicability(live)('y', 'c')).toBe(true);
    const gone = tombstone(live, { kind: 'group', id: 'ga' }, { reopensInapplicable: true });
    const ag = axisGroups(gone, 'alternatives');
    expect(groupsOf(ag, 'x')).toEqual([]);
    expect(groupsOf(ag, 'y')).toEqual(['gsub']);
    expect(makeInapplicability(gone)('x', 'c')).toBe(false);
    expect(makeInapplicability(gone)('y', 'c')).toBe(false);
  });

  it('still validates: references to a tombstoned group are not dangling', () => {
    const gone = tombstone(base(), { kind: 'group', id: 'ga' }, { reopensInapplicable: true });
    expect(validateAnalysis(JSON.parse(JSON.stringify(gone))).problems.filter((p) => p.ruleId === 'group-exists')).toEqual([]);
  });

  it('will not reopen excused cells silently: tombstoning a blocking group must say it means to (#165)', () => {
    expect(reopenedByTombstone(base(), 'ga')).toEqual([
      { alternativeId: 'x', criterionId: 'c' }, { alternativeId: 'y', criterionId: 'c' },
    ]);
    expect(() => tombstone(base(), { kind: 'group', id: 'ga' })).toThrow(/would reopen 2 cells/);
    // A sub-group's members inherit the block through nesting, so they count too.
    expect(reopenedByTombstone(base(), 'gsub')).toEqual([{ alternativeId: 'y', criterionId: 'c' }]);
    // A group whose tombstone excuses nothing needs no acknowledgement.
    const unblocked = { ...base(), inapplicable: [] };
    expect(reopenedByTombstone(unblocked, 'ga')).toEqual([]);
    expect(tombstone(unblocked, { kind: 'group', id: 'ga' }).groups[0]!.tombstoned).toBe(true);
  });

  it('accepts no new members, children or blocks once tombstoned (#165)', async () => {
    const gone = tombstone(base(), { kind: 'group', id: 'ga' }, { reopensInapplicable: true });
    const add = {
      alternatives: [...gone.alternatives, { id: 'z', label: 'Z', groupIds: ['ga'] }],
      groups: [...gone.groups, { id: 'gnew', label: 'New', axis: 'alternatives' as const, parentId: 'ga' }],
      inapplicable: [...gone.inapplicable, { alternativeGroupId: 'ga', criterionGroupId: 'gc' }],
    };
    expect(tombstonedGroupProblems(gone, { ...gone, ...add }).map((p) => p.path)).toEqual([
      'alternatives[2].groupIds', 'groups[3].parentId', 'inapplicable[0]',
    ]);
    // The sanctioned tombstone released ga's block; a block on a live group is fine, a new one on ga is not.
    expect(gone.inapplicable).toEqual([]);
    expect(tombstonedGroupProblems(gone, { ...gone, inapplicable: [{ alternativeGroupId: 'gsub', criterionGroupId: 'gc' }] })).toEqual([]);
    expect(tombstonedGroupProblems(gone, { ...gone, inapplicable: [{ alternativeGroupId: 'ga', criterionGroupId: 'gc' }] })
      .map((p) => p.path)).toEqual(['inapplicable[0]']);
    // What was attached when it was tombstoned stays; reviving it is allowed.
    expect(tombstonedGroupProblems(gone, gone)).toEqual([]);
    const revived = { ...gone, ...add, groups: add.groups.map((g) => (g.id === 'ga' ? { ...g, tombstoned: false } : g)) };
    expect(tombstonedGroupProblems(gone, revived)).toEqual([]);
    // The store enforces it.
    const src = inMemoryAnalysisSource(gone);
    await expect(src.update('t', { alternatives: add.alternatives })).rejects.toThrow(/tombstoned/);
  });

  it('refuses to scope completeness by it', () => {
    const gone = tombstone(base(), { kind: 'group', id: 'ga' }, { reopensInapplicable: true });
    expect(() => completeness(gone, { measure: 'score', alternativeGroupId: 'ga' })).toThrow(/tombstoned/);
  });
});

describe('a tombstoned alternative or criterion is in no group (#284)', () => {
  const doc = () => {
    const a = structuredClone(Analysis.parse(JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'relocation.json'), 'utf8'))));
    a.alternatives.find((x) => x.id === 'berlin')!.tombstoned = true;
    a.criteria.find((x) => x.id === 'rent')!.tombstoned = true;
    return a;
  };

  it('is no member, and has no group, on either axis', () => {
    const a = doc();
    expect(membersOfGroup(axisGroups(a, 'alternatives'), 'g-europe')).toEqual(['lisbon']);
    expect(groupsOf(axisGroups(a, 'alternatives'), 'berlin')).toEqual([]);
    expect(membersOfGroup(axisGroups(a, 'criteria'), 'g-cost')).toEqual(['income-tax']);
    // Its groupIds stay in the document, as history.
    expect(a.alternatives.find((x) => x.id === 'berlin')!.groupIds).toEqual(['g-europe']);
  });

  it('reaches every caller from that one rule: a scope by group, and a selection by group', () => {
    const a = doc();
    expect(alternativeScope(a, { groupId: 'g-europe' })).toEqual(['lisbon']);
  });
});
