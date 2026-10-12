/**
 * The write-path guard, against the bypasses the #165 adversarial review found.
 *
 * `revisionProblems` is the one check a provider runs; the in-memory source
 * runs it on every `update`. Each case here is a write the review showed being
 * accepted silently, or a legitimate write the first fix refused.
 */
import { describe, it, expect } from 'vitest';

import { Analysis, supersededCells, validateAnalysis } from '../src/core/schema/analysis.js';
import { reviseCriterion, scoreHistoryProblems } from '../src/core/criteria-revision.js';
import { revisionProblems } from '../src/core/revision.js';
import { revisionProblems as fromRoot } from '../src/index.js';
import { tombstone } from '../src/core/schema/anchors.js';
import { makeInapplicability } from '../src/core/schema/groups.js';
import { inMemoryAnalysisSource } from '../src/store/index.js';

const ORDINAL = { level: 'ordinal', preference: 'increasing', range: { min: 1, max: 5 }, levels: [1, 2, 3, 4, 5] } as const;
const AUTHOR = { id: 'ana', displayName: 'Ana', kind: 'human' };
const score = (id: string, value: number, over: Record<string, unknown> = {}) =>
  ({ id, authorId: 'ana', at: '2026-08-22T00:00:00Z', value, justification: 'j', ...over });

const analysis = (over: Record<string, unknown> = {}) => Analysis.parse({
  id: 'a', subject: { question: 'q' }, authors: [AUTHOR],
  alternatives: [{ id: 'x', label: 'X' }],
  criteria: [
    { id: 'c', label: 'Support', defaultMeasurement: ORDINAL },
    { id: 'd', label: 'Price', defaultMeasurement: ORDINAL },
  ],
  cells: [{ alternativeId: 'x', criterionId: 'c', measure: 'score', assertions: [score('s1', 3, { criteriaVersion: '3' })] }],
  criteriaVersion: '3',
  ...over,
});

const rejects = async (a: Analysis, data: Partial<Analysis>, why: RegExp) => {
  const src = inMemoryAnalysisSource(a);
  await expect(src.update('a', data)).rejects.toThrow(why);
  expect(await src.getOne('a')).toEqual(a);
};

describe('scores cannot be moved, deleted or relabelled (#165)', () => {
  it('refuses moving a cell onto another existing criterion', async () => {
    const a = analysis();
    await rejects(a, { cells: a.cells.map((c) => ({ ...c, criterionId: 'd' })) }, /is gone from its cell/);
  });

  it('refuses copy-instead-of-rename: tombstone c, add c2, move the cells', async () => {
    const a = analysis();
    const t = tombstone(a, { kind: 'criterion', id: 'c' });
    await rejects(a, {
      criteria: [...t.criteria, { ...a.criteria[0]!, id: 'c2', label: 'Something else' }],
      cells: a.cells.map((c) => ({ ...c, criterionId: 'c2' })),
    }, /is gone from its cell/);
  });

  it('refuses rewriting an old score\'s criteriaVersion after a material revision', async () => {
    const b = reviseCriterion(analysis(), 'c', { label: 'Dated support' }, { material: true });
    expect(supersededCells(b).count).toBe(1);
    await rejects(b, {
      cells: b.cells.map((c) => ({ ...c, assertions: c.assertions.map((s) => ({ ...s, criteriaVersion: '4' })) })),
    }, /changed its criteriaVersion/);
  });

  it('refuses editing a stored value in place, and changing supersededBy once set', () => {
    const a = analysis();
    const edited = { ...a, cells: a.cells.map((c) => ({ ...c, assertions: [{ ...c.assertions[0]!, value: 4 }] })) };
    expect(scoreHistoryProblems(a, edited)[0]!.message).toMatch(/changed its value/);
    const two = analysis({ cells: [{ alternativeId: 'x', criterionId: 'c', measure: 'score',
      assertions: [score('s1', 3, { supersededBy: 's2' }), score('s2', 4), score('s3', 4)] }] });
    const repointed = { ...two, cells: two.cells.map((c) => ({ ...c, assertions: c.assertions.map((s) => (s.id === 's1' ? { ...s, supersededBy: 's3' } : s)) })) };
    expect(scoreHistoryProblems(two, repointed)[0]!.message).toMatch(/supersededBy/);
  });

  it('accepts what is not a rewrite: a new assertion that supersedes the old one', async () => {
    const a = analysis();
    const src = inMemoryAnalysisSource(a);
    await src.update('a', { cells: a.cells.map((c) => ({ ...c, assertions: [
      { ...c.assertions[0]!, supersededBy: 's2' }, { ...score('s2', 4, { criteriaVersion: '3' }), version: 1, evidence: [] },
    ] })) });
    expect((await src.getOne('a')).cells[0]!.assertions).toHaveLength(2);
  });
});

describe('criteria removal', () => {
  it('lets an unreferenced criterion go, as during elicitation', () => {
    const a = analysis();
    expect(revisionProblems(a, { ...a, criteria: [a.criteria[0]!] })).toEqual([]);
  });

  it('keeps a criterion a thread is anchored to', () => {
    const a = analysis({ threads: [{ id: 't', anchor: { scope: 'criterion', criterionId: 'd' }, comments: [] }] });
    expect(revisionProblems(a, { ...a, criteria: [a.criteria[0]!] }).map((p) => p.path)).toEqual(['criteria[1]']);
  });
});

describe('the validator, counted by difference', () => {
  it('a sanctioned material revision of the scale is accepted, though old unversioned scores fall off it', async () => {
    const a = analysis({ criteriaVersion: undefined, cells: [{ alternativeId: 'x', criterionId: 'c', measure: 'score', assertions: [score('s1', 5)] }] });
    const b = reviseCriterion(a, 'c', { defaultMeasurement: { ...ORDINAL, range: { min: 1, max: 3 }, levels: [1, 2, 3] as number[] } }, { material: true });
    expect(validateAnalysis(b).ok).toBe(true);
    const src = inMemoryAnalysisSource(a);
    await src.update('a', { criteria: b.criteria, criteriaVersion: b.criteriaVersion });
    expect(supersededCells(await src.getOne('a')).unversioned).toBe(1);
  });

  it('an error already stored does not lock the document; a new one is refused', async () => {
    const bad = analysis({ cells: [{ alternativeId: 'x', criterionId: 'c', measure: 'score', assertions: [score('s1', 99)] }] });
    expect(validateAnalysis(bad).ok).toBe(false);
    const src = inMemoryAnalysisSource(bad);
    await expect(src.update('a', { title: 'renamed' } as Partial<Analysis>)).resolves.toMatchObject({ title: 'renamed' });
    await expect(src.update('a', { cells: [{ ...bad.cells[0]!, assertions: [...bad.cells[0]!.assertions,
      { ...score('s2', 77), version: 1, evidence: [], independence: 'independent' }] }] })).rejects.toThrow(/value-admitted/);
  });

  it('reports a malformed write as a refusal, not a crash', () => {
    const a = tombstone(analysis({ groups: [{ id: 'g', label: 'G', axis: 'alternatives' }] }), { kind: 'group', id: 'g' });
    expect(revisionProblems(a, { ...a, alternatives: [...a.alternatives, { id: 'z', label: 'Z' }] })).toEqual([]);
    expect(revisionProblems(a, { ...a, alternatives: [{ id: 'z' }] })[0]!.message).toMatch(/schema-shape/);
  });

  it('is exported from the package root', () => {
    expect(fromRoot).toBe(revisionProblems);
  });
});

describe('a group cannot be tombstoned silently through the store (#165)', () => {
  const blocked = () => analysis({
    alternatives: [{ id: 'x', label: 'X', groupIds: ['ga'] }],
    criteria: [{ id: 'c', label: 'C', groupIds: ['gc'], defaultMeasurement: ORDINAL }],
    groups: [{ id: 'ga', label: 'A', axis: 'alternatives' }, { id: 'gc', label: 'C', axis: 'criteria' }],
    inapplicable: [{ alternativeGroupId: 'ga', criterionGroupId: 'gc' }],
    cells: [],
  });

  it('refuses a raw tombstone that leaves the block naming the group', async () => {
    const a = blocked();
    await rejects(a, { groups: a.groups.map((g) => (g.id === 'ga' ? { ...g, tombstoned: true } : g)) }, /still names it/);
    expect(makeInapplicability(a)('x', 'c')).toBe(true);
  });

  it('accepts the sanctioned tombstone, which releases the block', async () => {
    const a = blocked();
    const t = tombstone(a, { kind: 'group', id: 'ga' }, { reopensInapplicable: true });
    expect(t.inapplicable).toEqual([]);
    const src = inMemoryAnalysisSource(a);
    await src.update('a', { groups: t.groups, inapplicable: t.inapplicable });
    expect(makeInapplicability(await src.getOne('a'))('x', 'c')).toBe(false);
  });

  it('refuses tombstoning a group and attaching a new member to it in the same write', async () => {
    const a = analysis({ groups: [{ id: 'g', label: 'G', axis: 'alternatives' }] });
    await rejects(a, {
      groups: [{ ...a.groups[0]!, tombstoned: true }],
      alternatives: [{ ...a.alternatives[0]!, groupIds: ['g'] }],
    }, /was added to group "g"/);
  });
});

describe('small shape holes', () => {
  it('refuses an empty supersededBy', () => {
    const a = analysis();
    const doc = { ...a, cells: [{ ...a.cells[0]!, assertions: [{ ...a.cells[0]!.assertions[0]!, supersededBy: '' }] }] };
    expect(validateAnalysis(doc).problems.map((p) => p.ruleId)).toContain('schema-shape');
  });

  it('reads an alias key set to undefined as not given', () => {
    const r = validateAnalysis({ id: 'a', subject: { question: 'q' }, aliases: { alternative: undefined, alternatives: 'vendors' } });
    expect(r.problems.map((p) => p.ruleId)).toEqual(['alias-pair-complete']);
  });
});
