/**
 * Annotation threads at every scope (#106): which threads bear on a position,
 * and start / reply / resolve as pure writes. A criterion-anchored thread
 * survives a rename and a reorder; a resolved thread is kept and retrievable.
 */
import { describe, expect, it } from 'vitest';

import { Analysis, validateAnalysis } from '../src/core/schema/analysis.js';
import { commentTarget, editComment, reopenThread, replyToThread, resolveThread, startThread, threadsAt } from '../src/core/threads.js';
import type { Author } from '../src/core/schema/provenance.js';
import relocationJson from '../examples/relocation.json';

const relocation = Analysis.parse(relocationJson);
const dana: Author = { id: 'dana', displayName: 'Dana', kind: 'human' };
const note = (id: string, body = 'what do we mean by this?') => ({ id, at: '2026-10-13T00:00:00Z', body, author: dana });
const ids = (xs: { thread: { id: string } }[]) => xs.map((x) => x.thread.id);

describe('threadsAt', () => {
  it('finds a thread at its own scope, and only there', () => {
    const crit = relocation.threads.find((t) => t.anchor.scope === 'criterion')!;
    expect(ids(threadsAt(relocation, { criterionId: crit.anchor.criterionId }))).toEqual([crit.id]);
    expect(ids(threadsAt(relocation, { alternativeId: 'berlin', criterionId: crit.anchor.criterionId }))).not.toContain(crit.id);
    const cell = relocation.threads.filter((t) => t.anchor.scope === 'cell' && t.anchor.alternativeId === 'berlin' && t.anchor.criterionId === 'rent');
    expect(ids(threadsAt(relocation, { alternativeId: 'berlin', criterionId: 'rent' }))).toEqual(cell.map((t) => t.id));
  });

  it('lists resolved threads, marked, for the view to hide', () => {
    const at = threadsAt(relocation, { alternativeId: 'berlin', criterionId: 'rent' });
    expect(at.some((x) => x.thread.resolved)).toBe(true);
  });

  it('a criterion thread survives a rename and a reorder: ids, never labels or positions', () => {
    let a = startThread(relocation, { threadId: 't-new', anchor: { scope: 'criterion', criterionId: 'rent', repairHint: 'Rent' }, comment: note('c1') });
    a = { ...a, criteria: [...a.criteria].reverse().map((c) => (c.id === 'rent' ? { ...c, label: 'Monthly housing cost' } : c)) };
    expect(ids(threadsAt(a, { criterionId: 'rent' }))).toContain('t-new');
  });

  it('group threads show on members, group-pair threads on the cells they cover, and all of them at the analysis', () => {
    const europe = relocation.groups.find((g) => g.id === 'g-europe')!;
    const cost = relocation.groups.find((g) => g.id === 'g-cost')!;
    let a = startThread(relocation, { threadId: 'tg', anchor: { scope: 'group', groupId: europe.id }, comment: note('c1') });
    a = startThread(a, { threadId: 'tp', anchor: { scope: 'group-pair', groupId: europe.id, otherGroupId: cost.id }, comment: note('c2') });
    a = startThread(a, { threadId: 'ta', anchor: { scope: 'analysis' }, comment: note('c3') });
    const member = relocation.alternatives.find((x) => x.groupIds.includes(europe.id))!;
    const outsider = relocation.alternatives.find((x) => !x.groupIds.includes(europe.id))!;
    const costCrit = relocation.criteria.find((x) => x.groupIds.includes(cost.id))!;
    expect(threadsAt(a, { alternativeId: member.id })).toContainEqual(expect.objectContaining({ relation: 'group', thread: expect.objectContaining({ id: 'tg' }) }));
    expect(ids(threadsAt(a, { alternativeId: outsider.id }))).not.toContain('tg');
    expect(ids(threadsAt(a, { alternativeId: member.id, criterionId: costCrit.id }))).toContain('tp');
    expect(ids(threadsAt(a, { alternativeId: outsider.id, criterionId: costCrit.id }))).not.toContain('tp');
    expect(ids(threadsAt(a, {}))).toEqual(expect.arrayContaining(['tg', 'tp', 'ta']));
  });

  it('a thread on a parent group bears on the members of its subgroups', () => {
    const europe = relocation.groups.find((g) => g.id === 'g-europe')!;
    const lisbon = relocation.alternatives.find((a) => a.id === 'lisbon')!;
    let a: Analysis = {
      ...relocation,
      groups: [...relocation.groups, { ...europe, id: 'g-iberia', label: 'Iberia', parentId: europe.id } as never],
      alternatives: relocation.alternatives.map((x) => (x.id === lisbon.id ? { ...x, groupIds: ['g-iberia'] } : x)),
    };
    a = Analysis.parse(a);
    a = startThread(a, { threadId: 'tg', anchor: { scope: 'group', groupId: europe.id }, comment: note('c1') });
    a = startThread(a, { threadId: 'tp', anchor: { scope: 'group-pair', groupId: europe.id, otherGroupId: 'g-cost' }, comment: note('c2') });
    expect(ids(threadsAt(a, { alternativeId: lisbon.id }))).toContain('tg');
    expect(ids(threadsAt(a, { alternativeId: lisbon.id, criterionId: 'rent' }))).toContain('tp');
  });

  it('leaves an orphaned thread to the orphan tray', () => {
    const a = { ...relocation, criteria: relocation.criteria.map((c) => (c.id === 'school-quality' ? { ...c, tombstoned: true } : c)) };
    expect(threadsAt(a, { criterionId: 'school-quality' })).toEqual([]);
  });
});

describe('writes', () => {
  it('start, reply and resolve: the document stays valid and the author is described', () => {
    let a = startThread(relocation, { threadId: 't1', anchor: { scope: 'alternative', alternativeId: 'lisbon' }, comment: note('c1') });
    a = replyToThread(a, 't1', note('c2', 'the coastal rent, I think'));
    a = resolveThread(a, 't1', { by: dana, at: '2026-10-13T01:00:00Z' });
    const t = a.threads.find((x) => x.id === 't1')!;
    expect(t.comments.map((c) => c.body)).toEqual(['what do we mean by this?', 'the coastal rent, I think']);
    expect(t).toMatchObject({ resolved: true, resolvedBy: 'dana', resolvedAt: '2026-10-13T01:00:00Z' });
    expect(a.authors.filter((x) => x.id === 'dana')).toHaveLength(1);
    expect(validateAnalysis(a).ok).toBe(true);
    expect(relocation.threads.find((x) => x.id === 't1')).toBeUndefined(); // pure
  });

  it('refuses what would lose or garble the record', () => {
    expect(() => startThread(relocation, { threadId: 't1', anchor: { scope: 'criterion', criterionId: 'nope' }, comment: note('c') })).toThrow(/not live/);
    expect(() => startThread(relocation, { threadId: 't1', anchor: { scope: 'analysis' }, comment: note('c', '   ') })).toThrow(/empty/);
    const resolved = relocation.threads.find((t) => t.resolved)!;
    expect(() => replyToThread(relocation, resolved.id, note('c'))).toThrow(/resolved/);
    expect(() => resolveThread(relocation, resolved.id, { by: dana, at: 'x' })).toThrow(/resolved/);
    expect(() => replyToThread(relocation, 'missing', note('c'))).toThrow(/no thread/);
    expect(() => startThread(relocation, { threadId: resolved.id, anchor: { scope: 'analysis' }, comment: note('c') })).toThrow(/already used/);
  });

  it('never overwrites an author the document already describes', () => {
    const ana = relocation.authors.find((x) => x.id === 'ana')!;
    const a = startThread(relocation, { threadId: 't1', anchor: { scope: 'analysis' }, comment: { ...note('c'), author: { ...ana, displayName: 'Impostor' } } });
    expect(a.authors.find((x) => x.id === 'ana')!.displayName).toBe(ana.displayName);
  });
});

describe('reopening a resolved thread (#186)', () => {
  it('reopens it, and records the resolution it undoes as a comment by whoever reopens', () => {
    const ana: Author = { id: 'ana-r', displayName: 'Ana', kind: 'human' };
    let a = startThread(relocation, { threadId: 't1', anchor: { scope: 'analysis' }, comment: note('c1') });
    a = resolveThread(a, 't1', { by: dana, at: '2026-10-13T01:00:00Z' });
    a = reopenThread(a, 't1', { id: 'c2', by: ana, at: '2026-10-14T00:00:00Z' });
    const t = a.threads.find((x) => x.id === 't1')!;
    expect(t.resolved).toBe(false);
    expect(t.comments.at(-1)).toEqual({ id: 'c2', authorId: 'ana-r', at: '2026-10-14T00:00:00Z', body: 'Reopened. It had been resolved by Dana (human, unverified) [dana], 2026-10-13T01:00:00Z.' });
    expect(a.authors.some((x) => x.id === 'ana-r')).toBe(true);
    // Resolved again: the fields move on, the first resolution stays in the comments.
    a = resolveThread(a, 't1', { by: ana, at: '2026-10-15T00:00:00Z' });
    expect(a.threads.find((x) => x.id === 't1')).toMatchObject({ resolved: true, resolvedBy: 'ana-r' });
    expect(validateAnalysis(a).ok).toBe(true);
  });

  it('refuses an open thread, a missing one, and a used comment id', () => {
    let a = startThread(relocation, { threadId: 't1', anchor: { scope: 'analysis' }, comment: note('c1') });
    expect(() => reopenThread(a, 't1', { id: 'c2', by: dana, at: 'x' })).toThrow(/is open/);
    expect(() => reopenThread(a, 'nope', { id: 'c2', by: dana, at: 'x' })).toThrow(/no thread "nope"/);
    a = resolveThread(a, 't1', { by: dana, at: 'x' });
    expect(() => reopenThread(a, 't1', { id: 'c1', by: dana, at: 'x' })).toThrow(/already used/);
  });

  it('names the resolver by kind and id, so a model and a person of one name stay apart (review finding)', () => {
    const bot: Author = { id: 'dana-bot', displayName: 'Dana', kind: 'agent', agent: { name: 'scorer' } };
    let a = startThread(relocation, { threadId: 't1', anchor: { scope: 'analysis' }, comment: note('c1') });
    a = reopenThread(resolveThread(a, 't1', { by: bot, at: 'T1' }), 't1', { id: 'c2', by: dana, at: 'T2' });
    expect(a.threads.find((x) => x.id === 't1')!.comments.at(-1)!.body).toBe('Reopened. It had been resolved by Dana (agent scorer, unverified) [dana-bot], T1.');
    const ghost = { ...a, threads: a.threads.map((t) => (t.id === 't1' ? { ...t, resolved: true, resolvedBy: 'ghost', resolvedAt: 'T3' } : t)) };
    expect(reopenThread(ghost, 't1', { id: 'c3', by: dana, at: 'T4' }).threads.find((x) => x.id === 't1')!.comments.at(-1)!.body)
      .toBe('Reopened. It had been resolved by an author this analysis does not describe [ghost], T3.');
  });
});

describe('commentTarget: what the host is asked about, for every scope (sprint review)', () => {
  it('names the anchored entity by id, a cell and a block by both of theirs', () => {
    expect(commentTarget({ scope: 'analysis' })).toEqual({ kind: 'analysis' });
    expect(commentTarget({ scope: 'alternative', alternativeId: 'berlin' })).toEqual({ kind: 'alternative', id: 'berlin' });
    expect(commentTarget({ scope: 'criterion', criterionId: 'rent' })).toEqual({ kind: 'criterion', id: 'rent' });
    expect(commentTarget({ scope: 'cell', alternativeId: 'berlin', criterionId: 'rent', measure: 'score' }))
      .toEqual({ kind: 'cell', id: 'berlin/rent' });
    expect(commentTarget({ scope: 'group', groupId: 'eu' })).toEqual({ kind: 'group', id: 'eu' });
    expect(commentTarget({ scope: 'group-pair', groupId: 'eu', otherGroupId: 'cost' })).toEqual({ kind: 'group-pair', id: 'eu/cost' });
  });
});

describe('editComment (#195)', () => {
  const ana: Author = { id: 'ana', displayName: 'Ana', kind: 'human' };
  const started = startThread(relocation, { threadId: 'te', anchor: { scope: 'analysis' }, comment: note('c1', 'rent looks high') });

  it('rewrites the comment, marks it edited, and keeps the earlier wording as a comment by the editor', () => {
    const a = editComment(started, 'te', 'c1', { body: 'rent looks too high', id: 'c2', by: ana, at: '2026-10-14T00:00:00Z' });
    const [first, note2] = a.threads.find((t) => t.id === 'te')!.comments;
    expect(first).toMatchObject({ id: 'c1', body: 'rent looks too high', editedAt: '2026-10-14T00:00:00Z', authorId: 'dana' });
    expect(note2).toMatchObject({ id: 'c2', authorId: 'ana' });
    expect(note2!.body).toContain('"rent looks high"');
    expect(note2!.body).toContain('Dana (human, unverified) [dana]');
  });

  it('keeps the whole chain when edited twice', () => {
    let a = editComment(started, 'te', 'c1', { body: 'second', id: 'c2', by: dana, at: '2026-10-14T00:00:00Z' });
    a = editComment(a, 'te', 'c1', { body: 'third', id: 'c3', by: dana, at: '2026-10-15T00:00:00Z' });
    const bodies = a.threads.find((t) => t.id === 'te')!.comments.map((c) => c.body).join('\n');
    expect(bodies).toContain('"rent looks high"');
    expect(bodies).toContain('"second"');
    // The second note dates the wording it quotes from the edit that wrote it, not from the comment.
    expect(bodies).toContain('as it read since 2026-10-14T00:00:00Z. Its earlier wording: "second"');
  });

  it('refuses an unknown comment, an empty or unchanged body, a reused id, and a resolved thread', () => {
    const edit = (a: typeof started, over: Partial<Parameters<typeof editComment>[3]> & { comment?: string } = {}) =>
      editComment(a, 'te', over.comment ?? 'c1', { body: 'x', id: 'c9', by: dana, at: 'x', ...over });
    expect(() => edit(started, { comment: 'nope' })).toThrow(/no comment "nope"/);
    expect(() => edit(started, { body: '  ' })).toThrow(/empty/);
    expect(() => edit(started, { body: 'rent looks high' })).toThrow(/same as the old/);
    expect(() => edit(editComment(started, 'te', 'c1', { body: 'padded  ', id: 'c8', by: dana, at: 'y' }), { body: 'padded' })).toThrow(/same as the old/);
    expect(() => edit(started, { id: 'c1' })).toThrow(/already used/);
    expect(() => edit(resolveThread(started, 'te', { by: dana, at: 'x' }))).toThrow(/resolved/);
  });
});
