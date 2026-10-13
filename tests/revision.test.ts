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
    }, /edited in place/);
  });

  it('refuses editing a stored value in place, and changing supersededBy once set', () => {
    const a = analysis();
    const edited = { ...a, cells: a.cells.map((c) => ({ ...c, assertions: [{ ...c.assertions[0]!, value: 4 }] })) };
    expect(scoreHistoryProblems(a, edited)[0]!.message).toMatch(/edited in place/);
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

describe('second adversarial pass (#165)', () => {
  it('refuses editing any asserted field in place: independence, justification, evidence', () => {
    const a = analysis();
    for (const patch of [{ independence: 'independent' }, { justification: 'rewritten' }, { roundId: 'r9' }]) {
      const b = { ...a, cells: a.cells.map((c) => ({ ...c, assertions: [{ ...c.assertions[0]!, ...patch }] })) };
      expect(scoreHistoryProblems(a, b as Analysis)[0]?.message, JSON.stringify(patch)).toMatch(/edited in place/);
    }
    // What may change: the concurrency token and disclosure.
    const ok = { ...a, cells: a.cells.map((c) => ({ ...c, assertions: [{ ...c.assertions[0]!, version: 2, disclosure: { audience: 'internal' } }] })) };
    expect(scoreHistoryProblems(a, ok as Analysis)).toEqual([]);
  });

  it('does not let a new error hide behind an old one with the same message', async () => {
    const two = analysis({
      alternatives: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }],
      cells: [{ alternativeId: 'x', criterionId: 'c', measure: 'score', assertions: [score('s1', 99, { criteriaVersion: '3' })] }],
    });
    const src = inMemoryAnalysisSource(two);
    await expect(src.update('a', { cells: [...two.cells, { alternativeId: 'y', criterionId: 'c', measure: 'score', assertions: [
      { ...score('s1', 99, { criteriaVersion: '3' }), version: 1, evidence: [] },
    ] }] })).rejects.toThrow(/value-admitted|new assertion/);
  });

  it('holds a new unversioned score to the current scale once the criterion has changed meaning', async () => {
    const b = reviseCriterion(analysis(), 'c', { label: 'Dated support' }, { material: true });
    const src = inMemoryAnalysisSource(b);
    await expect(src.update('a', { cells: [{ ...b.cells[0]!, assertions: [...b.cells[0]!.assertions,
      { ...score('s2', 99), version: 1, evidence: [] }] }] })).rejects.toThrow(/new assertion "s2"/);
  });

  it('treats a rewritten scale declaration as a change of the criteria authored to it', () => {
    const decl = { id: 'support-5', broader: 'stevens', means: 'five dated levels', params: {} };
    const a = analysis({
      scales: [decl],
      criteria: [{ id: 'c', label: 'Support', defaultMeasurement: { ...ORDINAL, scale: 'support-5' } }],
    });
    const b = { ...a, scales: [{ ...decl, means: 'five undated levels' }] };
    expect(revisionProblems(a, b).map((p) => p.message).join(' ')).toMatch(/scale declaration/);
    expect(revisionProblems(a, { ...b, criteriaVersion: '4' })).toEqual([]);
  });

  it('lets a document flagged by the new rules be repaired', async () => {
    const cyc = analysis({ cells: [{ alternativeId: 'x', criterionId: 'c', measure: 'score', assertions: [
      score('s1', 3, { supersededBy: 's2', independence: 'independent' }), score('s2', 3, { supersededBy: 's1', independence: 'independent' }),
    ] }] });
    expect(validateAnalysis(cyc).ok).toBe(false);
    const fixed = cyc.cells.map((c) => ({ ...c, assertions: [c.assertions[0]!, { ...c.assertions[1]!, supersededBy: undefined }] }));
    await expect(inMemoryAnalysisSource(cyc).update('a', { cells: fixed })).resolves.toBeDefined();

    const dup = analysis({ cells: [{ alternativeId: 'x', criterionId: 'c', measure: 'score', assertions: [
      score('s1', 3, { independence: 'independent' }), score('s1', 4, { independence: 'independent' }),
    ] }] });
    const renamed = dup.cells.map((c) => ({ ...c, assertions: [c.assertions[0]!, { ...c.assertions[1]!, id: 's1b' }] }));
    await expect(inMemoryAnalysisSource(dup).update('a', { cells: renamed })).resolves.toBeDefined();
  });

  it('a stored document that no longer parses accepts its repair, then everything else, and stays guarded', async () => {
    const raw = { ...analysis(), cells: [{ alternativeId: 'x', criterionId: 'c', measure: 'score', assertions: [
      { ...score('s1', 3, { criteriaVersion: '3' }), version: 1, evidence: [], supersededBy: '', independence: 'independent' },
      { ...score('s2', 4, { criteriaVersion: '3' }), version: 1, evidence: [], independence: 'independent' },
    ] }] } as unknown as Analysis;
    // Still guarded: a relabel without a bump and an in-place rewrite are refused (third pass, finding 1).
    expect(revisionProblems(raw, {
      ...raw, criteria: raw.criteria.map((c, i) => (i === 0 ? { ...c, label: 'Other' } : c)),
      cells: [{ ...raw.cells[0]!, assertions: [{ ...raw.cells[0]!.assertions[0]!, supersededBy: undefined }, { ...raw.cells[0]!.assertions[1]!, value: 1 }] }],
    }).map((p) => p.message).join(' ')).toMatch(/changed its label[\s\S]*edited in place/);
    const src = inMemoryAnalysisSource(raw);
    await expect(src.update('a', { title: 'renamed' } as Partial<Analysis>)).rejects.toThrow(/schema-shape/);
    await src.update('a', { cells: [{ ...raw.cells[0]!, assertions: [{ ...raw.cells[0]!.assertions[0]!, supersededBy: undefined }, raw.cells[0]!.assertions[1]!] }] });
    await expect(src.update('a', { title: 'renamed' } as Partial<Analysis>)).resolves.toBeDefined();
  });

  it('a duplicate id makes only the reported copy repairable, not its healthy twin', () => {
    const dup = analysis({ cells: [{ alternativeId: 'x', criterionId: 'c', measure: 'score', assertions: [
      score('s1', 3, { independence: 'independent' }), score('s1', 4, { independence: 'independent' }),
    ] }] });
    const rewriteOriginal = { ...dup, cells: dup.cells.map((c) => ({ ...c, assertions: [{ ...c.assertions[0]!, value: 5 }, { ...c.assertions[1]!, id: 's1b' }] })) };
    expect(revisionProblems(dup, rewriteOriginal).map((p) => p.message).join(' ')).toMatch(/edited in place/);
    // An unrelated write to the same document is not refused for the twin.
    expect(revisionProblems(dup, { ...dup, title: 't' })).toEqual([]);
  });

  it('refuses re-declaring a missingness code in place without a version bump', () => {
    const a = analysis({ missingCodes: [{ id: 'vendor-silent', broader: 'not-evidenced', means: 'no answer', params: {} }] });
    const b = { ...a, missingCodes: [{ id: 'vendor-silent', broader: 'not-applicable', structural: true, means: 'no answer', params: {} }] };
    expect(revisionProblems(a, b as Analysis).map((p) => p.path)).toContain('missingCodes[0]');
    expect(revisionProblems(a, { ...b, criteriaVersion: '4' } as Analysis)).toEqual([]);
  });

  it('lets a citation be appended to a stored score, but not changed', () => {
    const a = analysis();
    const ev = { id: 'e1', target: 'doc:1', sourceType: 'primary', stance: 'supports', derivedFrom: [], selectors: [{ type: 'TextQuoteSelector', exact: 'q' }] };
    const withEv = (evidence: unknown[]) => ({ ...a, cells: a.cells.map((c) => ({ ...c, assertions: [{ ...c.assertions[0]!, evidence }] })) }) as Analysis;
    expect(scoreHistoryProblems(a, withEv([ev]))).toEqual([]);
    expect(scoreHistoryProblems(withEv([ev]), withEv([{ ...ev, stance: 'contradicts' }]))[0]!.message).toMatch(/edited in place/);
  });

  it('lets a criterion go together with its only, empty, cell', () => {
    const a = analysis({ cells: [{ alternativeId: 'x', criterionId: 'd', measure: 'score', assertions: [] }] });
    expect(revisionProblems(a, { ...a, criteria: [a.criteria[0]!], cells: [] })).toEqual([]);
  });
});


describe('a stored document the history checks cannot read (sprint review)', () => {
  it('refuses the write with a way out, rather than throwing from inside a check', () => {
    const unreadable = { ...analysis(), criteria: 'not a list' } as unknown as Analysis;
    const problems = revisionProblems(unreadable, analysis());
    expect(problems).toEqual([expect.objectContaining({ path: '(root)', message: expect.stringMatching(/cannot read/) })]);
    expect(problems[0]!.fix).toMatch(/repairs only the stored document's shape errors/);
  });
});
