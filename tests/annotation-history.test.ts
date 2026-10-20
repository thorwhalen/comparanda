/**
 * The write path guards the argument, not only the scores (#204).
 *
 * Each refusal here is a write `inMemoryAnalysisSource(...).update(...)`
 * accepted before #204; each acceptance is the sanctioned path for the same
 * change, so the guard cannot be satisfied by refusing everything.
 */
import { describe, it, expect } from 'vitest';

import { Analysis, validateAnalysis } from '../src/core/schema/analysis.js';
import { annotationHistoryProblems } from '../src/core/annotation-history.js';
import { removedEntityProblems, tombstone } from '../src/core/schema/anchors.js';
import { reopenThread, replyToThread, resolveThread, startThread } from '../src/core/threads.js';
import { inMemoryAnalysisSource } from '../src/store/index.js';

const ORDINAL = { level: 'ordinal', preference: 'increasing', range: { min: 1, max: 5 }, levels: [1, 2, 3, 4, 5] } as const;
const ANA = { id: 'ana', displayName: 'Ana', kind: 'human' } as const;
const BO = { id: 'bo', displayName: 'Bo', kind: 'human' } as const;
const AT = '2026-10-20T00:00:00Z';

const base = () => Analysis.parse({
  id: 'a', subject: { question: 'q' }, authors: [ANA, BO],
  alternatives: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }],
  criteria: [{ id: 'c', label: 'Support', defaultMeasurement: ORDINAL }],
  groups: [{ id: 'g', label: 'G', axis: 'alternatives' }],
  suggestions: [{
    id: 'sg', anchor: { scope: 'cell', alternativeId: 'x', criterionId: 'c', measure: 'score' }, authorId: 'bo', at: AT,
    proposed: { id: 'p1', authorId: 'bo', at: AT, value: 4, justification: 'j' },
  }],
});

/** Base with one thread on alternative y, and one on group g, each with one comment. */
const argued = () => {
  const one = startThread(base(), {
    threadId: 't1', anchor: { scope: 'alternative', alternativeId: 'y' },
    comment: { id: 'k1', at: AT, body: 'why is Y here?', author: ANA },
  });
  return startThread(one, {
    threadId: 't2', anchor: { scope: 'group', groupId: 'g' },
    comment: { id: 'k1', at: AT, body: 'what is G?', author: BO },
  });
};

const rejects = async (a: Analysis, data: Partial<Analysis>, why: RegExp) => {
  const src = inMemoryAnalysisSource(a);
  await expect(src.update('a', data)).rejects.toThrow(why);
  expect(await src.getOne('a')).toEqual(a);
};

const accepts = async (a: Analysis, data: Partial<Analysis>) => {
  const src = inMemoryAnalysisSource(a);
  await src.update('a', data);
};

describe('annotation history (#204)', () => {
  it('refuses deleting every thread, and one comment', async () => {
    const a = argued();
    await rejects(a, { threads: [] }, /thread "t1" was removed/);
    await rejects(a, { threads: a.threads.map((t) => ({ ...t, comments: [] })) }, /comment "k1" in thread "t1" was removed/);
  });

  it('refuses rewriting a comment in place, and accepts the same edit with editedAt', async () => {
    const a = argued();
    const edit = (over: Record<string, unknown>) =>
      ({ threads: a.threads.map((t) => ({ ...t, comments: t.comments.map((c) => ({ ...c, body: 'something else', ...over })) })) });
    await rejects(a, edit({}), /rewritten without recording the edit/);
    await accepts(a, edit({ editedAt: '2026-10-21T00:00:00Z' }));
  });

  it('refuses a reopen that drops the resolution, and accepts reopenThread', async () => {
    const resolved = resolveThread(argued(), 't1', { by: ANA, at: AT });
    await rejects(resolved, {
      threads: resolved.threads.map((t) => {
        const { resolvedBy: _b, resolvedAt: _a, ...rest } = t;
        return { ...rest, resolved: false };
      }),
    }, /resolution dropped or rewritten/);
    await rejects(resolved, { threads: resolved.threads.map((t) => ({ ...t, resolved: false })) }, /without a comment/);
    const reopened = reopenThread(resolved, 't1', { id: 'k2', by: BO, at: AT });
    await accepts(resolved, { threads: reopened.threads });
    // ...and resolving it again overwrites the resolution, which reopenThread recorded.
    await accepts(reopened, { threads: resolveThread(reopened, 't1', { by: BO, at: '2026-10-22T00:00:00Z' }).threads });
  });

  it('refuses deciding a suggestion twice, and deleting one', async () => {
    const a = base();
    const decided = { ...a, suggestions: a.suggestions.map((s) => ({ ...s, status: 'declined' as const, decidedBy: 'ana', decidedAt: AT })) };
    await accepts(a, { suggestions: decided.suggestions });
    await rejects(decided, { suggestions: a.suggestions }, /decided again or reopened/);
    await rejects(a, { suggestions: [] }, /suggestion "sg" was removed/);
    await rejects(a, { suggestions: a.suggestions.map((s) => ({ ...s, proposed: { ...s.proposed, value: 5 } })) }, /rewritten in place/);
  });

  it('refuses moving a live thread, and allows re-attaching an orphan', () => {
    const a = argued();
    const moved = (d: Analysis) => ({ ...d, threads: d.threads.map((t) => (t.id === 't1' ? { ...t, anchor: { scope: 'alternative' as const, alternativeId: 'x' } } : t)) });
    expect(annotationHistoryProblems(a, moved(a))[0]!.message).toMatch(/moved to another anchor/);
    const dead = tombstone(a, { kind: 'alternative', id: 'y' });
    expect(annotationHistoryProblems(dead, moved(dead))).toEqual([]);
  });

  it('lets a duplicated thread id be repaired by renaming one of the twins', () => {
    const a = argued();
    const twins = { ...a, threads: [a.threads[0]!, { ...a.threads[1]!, id: 't1' }] };
    expect(validateAnalysis(twins).problems.map((p) => p.ruleId)).toContain('unique-ids');
    expect(annotationHistoryProblems(twins, a)).toEqual([]);
  });

  it('refuses dropping both twins of a duplicated id (review)', () => {
    const a = argued();
    const twins = { ...a, threads: [a.threads[0]!, { ...a.threads[1]!, id: 't1' }] };
    expect(annotationHistoryProblems(twins, { ...a, threads: [] })[0]!.message).toMatch(/holds twice, was removed/);
  });

  it('keeps the last resolution after a reopen, refuses a reply to a resolved thread, and a backdated edit (review)', () => {
    const reopened = reopenThread(resolveThread(argued(), 't1', { by: ANA, at: AT }), 't1', { id: 'k2', by: BO, at: AT });
    const stripped = { ...reopened, threads: reopened.threads.map((t) => ({ ...t, resolvedBy: undefined, resolvedAt: undefined })) };
    expect(annotationHistoryProblems(reopened, stripped)[0]!.message).toMatch(/last resolution dropped/);
    const resolved = resolveThread(argued(), 't1', { by: ANA, at: AT });
    const answered = { ...resolved, threads: resolved.threads.map((t) => (t.id === 't1' ? { ...t, comments: [...t.comments, { ...t.comments[0]!, id: 'k9' }] } : t)) };
    expect(annotationHistoryProblems(resolved, answered)[0]!.message).toMatch(/resolved and was answered anyway/);
    const a = argued();
    const backdated = { ...a, threads: a.threads.map((t) => ({ ...t, comments: t.comments.map((c) => ({ ...c, body: 'new', editedAt: '1999-01-01T00:00:00Z' })) })) };
    expect(annotationHistoryProblems(a, backdated)[0]!.message).toMatch(/claims an edit at 1999/);
  });

  it('reads a stored document without threads or suggestions, rather than refusing every write (review)', () => {
    const { threads: _t, suggestions: _s, ...bare } = base();
    expect(annotationHistoryProblems(bare as Analysis, base())).toEqual([]);
    expect(removedEntityProblems(bare as Analysis, base())).toEqual([]);
  });

  it('accepts the thread functions: start, reply, resolve', async () => {
    const a = argued();
    await accepts(a, { threads: replyToThread(a, 't1', { id: 'k2', at: AT, body: 'because', author: BO }).threads });
    await accepts(a, { threads: resolveThread(a, 't2', { by: ANA, at: AT }).threads });
  });
});

describe('no hard delete of an annotated alternative or group (#204)', () => {
  it('refuses removing an alternative or a group a thread names, and accepts the tombstone', async () => {
    const a = argued();
    await rejects(a, { alternatives: a.alternatives.filter((x) => x.id !== 'y') }, /alternative "y" was removed/);
    await rejects(a, { groups: [] }, /group "g" was removed/);
    await accepts(a, { alternatives: tombstone(a, { kind: 'alternative', id: 'y' }).alternatives });
  });

  it('refuses removing an alternative only a suggestion names, and lets an unreferenced one go', () => {
    const a = base();
    expect(removedEntityProblems(a, { ...a, alternatives: a.alternatives.filter((x) => x.id !== 'x') })[0]!.message)
      .toMatch(/alternative "x" was removed/);
    expect(removedEntityProblems(a, { ...a, alternatives: a.alternatives.filter((x) => x.id !== 'y') })).toEqual([]);
  });
});

describe('validator: annotation ids and authors (#204)', () => {
  it('reports duplicate thread, suggestion and comment ids', () => {
    const a = argued();
    const doc = {
      ...a,
      threads: [...a.threads, a.threads[0]!].map((t, i) => (i === 1 ? { ...t, comments: [...t.comments, t.comments[0]!] } : t)),
      suggestions: [...a.suggestions, a.suggestions[0]!],
    };
    const dup = validateAnalysis(doc).problems.filter((p) => p.ruleId === 'unique-ids').map((p) => p.path);
    expect(dup).toEqual(expect.arrayContaining(['threads', 'suggestions', 'threads[1].comments']));
  });

  it('reports a comment, a resolution and a decision by an author the document does not describe', () => {
    const a = argued();
    const doc = {
      ...a,
      threads: a.threads.map((t, i) => (i === 0
        ? { ...t, comments: [{ ...t.comments[0]!, authorId: 'ghost' }] }
        : { ...t, resolved: true, resolvedBy: 'ghost', resolvedAt: AT })),
      suggestions: a.suggestions.map((s) => ({ ...s, status: 'declined' as const, decidedBy: 'ghost' })),
    };
    const paths = validateAnalysis(doc).problems.filter((p) => p.ruleId === 'annotation-attributed').map((p) => p.path);
    expect(paths.sort()).toEqual(['suggestions[0].decidedBy', 'threads[0].comments[0].authorId', 'threads[1].resolvedBy']);
    expect(validateAnalysis(a).problems.filter((p) => p.ruleId === 'annotation-attributed')).toEqual([]);
  });
});
