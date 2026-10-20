/**
 * The orphaned-annotations tray in words (#108): tombstoning an annotated
 * entity lists its threads and suggestions, with what they were about and why,
 * resolved and decided ones included; a live anchor lists nothing.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Analysis } from '../src/core/schema/analysis.js';
import { tombstone } from '../src/core/schema/anchors.js';
import { resolveThread, startThread } from '../src/core/threads.js';
import { describeOrphans, reattach, reattachChoices } from '../src/core/orphans.js';
import { resolveAnchor } from '../src/core/schema/anchors.js';
import { annotationHistoryProblems } from '../src/core/annotation-history.js';
import { makeAffordances } from '../src/core/affordances.js';
import { commentTarget } from '../src/core/threads.js';
import { describeOrphans as fromRoot } from '../src/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const relocation = () => Analysis.parse(JSON.parse(readFileSync(join(root, 'examples', 'relocation.json'), 'utf8')));
const ANA = { id: 'ana-108', displayName: 'Ana', kind: 'human' } as const;

const argued = () => startThread(relocation(), {
  threadId: 't-rent', anchor: { scope: 'criterion', criterionId: 'rent', repairHint: 'Rent' },
  comment: { id: 'k1', at: 'T0', body: 'before or after utilities?', author: ANA },
});

describe('describeOrphans', () => {
  it('lists nothing while every anchor is live', () => {
    expect(describeOrphans(argued()).filter((o) => o.id === 't-rent')).toEqual([]);
    expect(fromRoot).toBe(describeOrphans);
  });

  it('lists a tombstoned criterion\'s thread, with its comments and why it lost its place', () => {
    const [entry] = describeOrphans(tombstone(argued(), { kind: 'criterion', id: 'rent' })).filter((o) => o.id === 't-rent');
    expect(entry).toMatchObject({ kind: 'thread', standing: 'open', comments: [{ who: expect.stringContaining('Ana'), body: 'before or after utilities?' }] });
    expect(entry!.said).toMatch(/^A thread on the criterion Rent .*: the criterion was deleted \(tombstoned\)\.$/);
  });

  it('keeps a resolved thread, names successors of a split, and says when the entity is gone altogether', () => {
    const resolved = resolveThread(argued(), 't-rent', { by: ANA, at: 'T1' });
    const split = tombstone(resolved, { kind: 'criterion', id: 'rent' }, { supersededBy: ['income-tax'] });
    const [entry] = describeOrphans(split).filter((o) => o.id === 't-rent');
    expect(entry!.standing).toMatch(/^resolved by .*Ana.*, T1$/);
    expect(entry!.said).toMatch(/replaced by .*, and which one this was about is a person's call\.$/);
    const gone = { ...argued(), threads: [{ ...argued().threads.at(-1)!, anchor: { scope: 'criterion' as const, criterionId: 'ghost', repairHint: 'Old' } }] };
    expect(describeOrphans(gone)[0]!.said).toMatch(/“ghost” \(when it was attached: “Old”\): the criterion "ghost" is not in this analysis\./);
  });
});

describe('re-attaching an orphan (#249)', () => {
  const split = () => tombstone(argued(), { kind: 'criterion', id: 'rent' }, { supersededBy: ['income-tax'] });
  const thread = { kind: 'thread', id: 't-rent' } as const;

  it('offers the successors first, then every other live criterion, then the analysis', () => {
    const choices = reattachChoices(split(), thread);
    expect(choices[0]).toMatchObject({ anchor: { scope: 'criterion', criterionId: 'income-tax' }, successor: true });
    expect(choices[0]!.said).toMatch(/^The criterion Income tax burden \(what it was split or merged into\)$/);
    expect(choices.at(-1)).toEqual({ anchor: { scope: 'analysis' }, successor: false, said: 'The analysis as a whole' });
    const ids = choices.slice(1, -1).map((c) => (c.anchor as { criterionId: string }).criterionId);
    expect(ids).not.toContain('rent');
    expect(ids).not.toContain('income-tax');
    expect(choices.every((c) => resolveAnchor(split(), c.anchor).status === 'live')).toBe(true);
  });

  it('offers nothing for a live annotation, and refuses to move one', () => {
    expect(reattachChoices(argued(), thread)).toEqual([]);
    expect(() => reattach(argued(), thread, { scope: 'analysis' })).toThrow(/attached to something live/);
  });

  it('moves the orphan to a live anchor, and the history check accepts it', () => {
    const before = split();
    const after = reattach(before, thread, { scope: 'criterion', criterionId: 'income-tax' });
    expect(after.threads.find((t) => t.id === 't-rent')!.anchor).toEqual({ scope: 'criterion', criterionId: 'income-tax' });
    expect(annotationHistoryProblems(before, after)).toEqual([]);
    expect(() => reattach(before, thread, { scope: 'criterion', criterionId: 'rent' })).toThrow(/does not resolve/);
  });

  it('asks the reattach affordance of the new anchor, and refuses for a live thread', () => {
    const aff = makeAffordances(split());
    expect(aff.comment(commentTarget({ scope: 'criterion', criterionId: 'income-tax' }), 'reattach', { threadId: 't-rent' })).toEqual({ enabled: true });
    expect(aff.comment(commentTarget({ scope: 'criterion', criterionId: 'rent' }), 'reattach', { threadId: 't-rent' }).enabled).toBe(false);
    expect(makeAffordances(argued()).comment(commentTarget({ scope: 'analysis' }), 'reattach', { threadId: 't-rent' }).reason).toMatch(/only an orphaned thread/);
  });
});
