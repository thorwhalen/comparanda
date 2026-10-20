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
import { describeOrphans } from '../src/core/orphans.js';
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
