/**
 * Annotation anchors: ids only, tombstones not deletion, repairHint never read
 * (#51, ADR-0011 as amended).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Analysis } from '../src/core/schema/analysis.js';
import { orphanedSuggestionsOf, orphanedThreadsOf, resolveAnchor, tombstone } from '../src/core/schema/anchors.js';

const doc = () => Analysis.parse({
  id: 'n', subject: { question: 'q' },
  authors: [{ id: 'ana', displayName: 'Ana', kind: 'human' }],
  alternatives: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }],
  criteria: [
    { id: 'reach', label: 'Reachability', defaultMeasurement: { level: 'ordinal', preference: 'increasing', range: { min: 1, max: 5 } } },
    { id: 'cost', label: 'Cost', defaultMeasurement: { level: 'ratio', preference: 'decreasing', range: { min: 0, max: 10 } } },
  ],
  groups: [{ id: 'g', label: 'G', axis: 'alternatives' }, { id: 'h', label: 'H', axis: 'criteria' }],
  threads: [
    { id: 't-crit', anchor: { scope: 'criterion', criterionId: 'reach', repairHint: 'Reachability' }, comments: [] },
    { id: 't-cell', anchor: { scope: 'cell', alternativeId: 'x', criterionId: 'reach', measure: 'score' }, comments: [] },
    { id: 't-alt', anchor: { scope: 'alternative', alternativeId: 'y' }, comments: [], resolved: true },
    { id: 't-pair', anchor: { scope: 'group-pair', groupId: 'g', otherGroupId: 'h' }, comments: [] },
    { id: 't-doc', anchor: { scope: 'analysis' }, comments: [] },
  ],
});

describe('renaming never moves an annotation', () => {
  it('keeps every thread live after a criterion is relabelled and the axis reordered', () => {
    const a = doc();
    const renamed = {
      ...a,
      criteria: [...a.criteria].reverse().map((c) => (c.id === 'reach' ? { ...c, label: 'Travel time' } : c)),
    };
    expect(orphanedThreadsOf(renamed)).toEqual([]);
    expect(resolveAnchor(renamed, renamed.threads[0]!.anchor)).toEqual({ status: 'live' });
  });
});

describe('deletion is a tombstone, and its threads are visibly orphaned', () => {
  it('tombstone() keeps the entity, marks it, and does not mutate the input', () => {
    const a = doc();
    const before = JSON.stringify(a);
    const b = tombstone(a, { kind: 'criterion', id: 'reach' }, { supersededBy: ['reach-road', 'reach-rail'] });
    expect(JSON.stringify(a)).toBe(before);
    expect(b.criteria.map((c) => c.id)).toEqual(['reach', 'cost']);
    expect(b.criteria[0]).toMatchObject({ tombstoned: true, supersededBy: ['reach-road', 'reach-rail'] });
  });

  it('reports each thread on the tombstoned criterion as orphaned, with the reason and successors', () => {
    const b = tombstone(doc(), { kind: 'criterion', id: 'reach' }, { supersededBy: ['reach-road'] });
    const orphans = orphanedThreadsOf(b);
    expect(orphans.map((o) => o.thread.id)).toEqual(['t-crit', 't-cell']);
    for (const o of orphans) {
      expect(o.resolution).toEqual({
        status: 'orphaned', reason: 'tombstoned', entity: { kind: 'criterion', id: 'reach' },
        supersededBy: ['reach-road'],
      });
    }
    // The threads are still in the document: orphaned, not gone.
    expect(b.threads).toHaveLength(5);
  });

  it('includes resolved threads in the tray: hiding them is the view\'s call', () => {
    const b = tombstone(doc(), { kind: 'alternative', id: 'y' });
    expect(orphanedThreadsOf(b).map((o) => o.thread.id)).toEqual(['t-alt']);
  });

  it('reports a hard-removed entity as missing rather than dropping the thread', () => {
    const a = doc();
    const hard = { ...a, groups: a.groups.filter((g) => g.id !== 'h') };
    expect(orphanedThreadsOf(hard).map((o) => [o.thread.id, o.resolution.reason, o.resolution.entity.id]))
      .toEqual([['t-pair', 'missing', 'h']]);
  });

  it('refuses to tombstone an id that does not exist, rather than silently doing nothing', () => {
    expect(() => tombstone(doc(), { kind: 'alternative', id: 'nope' })).toThrow(/nope/);
  });

  it('refuses a kind it cannot tombstone, rather than tombstoning a criterion', () => {
    expect(() => tombstone(doc(), { kind: 'group' as never, id: 'g' })).toThrow(/group/);
  });

  it('lists suggestions anchored to a tombstoned entity too (review finding)', () => {
    const a = Analysis.parse({
      ...doc(),
      suggestions: [
        { id: 's1', anchor: { scope: 'cell', alternativeId: 'x', criterionId: 'reach', measure: 'score' }, authorId: 'ana', at: '2026-08-22T00:00:00Z', proposed: {} },
        { id: 's2', anchor: { scope: 'criterion', criterionId: 'cost' }, authorId: 'ana', at: '2026-08-22T00:00:00Z', proposed: {}, status: 'declined' },
      ],
    });
    expect(orphanedSuggestionsOf(a)).toEqual([]);
    const b = tombstone(a, { kind: 'criterion', id: 'reach' });
    expect(orphanedSuggestionsOf(b).map((o) => [o.suggestion.id, o.resolution.reason])).toEqual([['s1', 'tombstoned']]);
    expect(b.suggestions).toHaveLength(2);
  });
});

describe('repairHint is stored and never consulted', () => {
  it('a misleading hint changes nothing, in either direction', () => {
    const a = doc();
    const live = { scope: 'criterion' as const, criterionId: 'reach' };
    // A hint naming a different, existing criterion does not redirect the anchor...
    expect(resolveAnchor(a, { ...live, repairHint: 'Cost' })).toEqual(resolveAnchor(a, live));
    // ...and a hint matching a live label does not rescue an orphan.
    const dead = { scope: 'criterion' as const, criterionId: 'gone' };
    expect(resolveAnchor(a, { ...dead, repairHint: 'Reachability' })).toEqual(resolveAnchor(a, dead));
    expect(resolveAnchor(a, dead).status).toBe('orphaned');
  });

  it('is not read anywhere in the resolution code', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, '..', 'src', 'core', 'schema', 'anchors.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/repairHint/);
  });
});

describe('the messy fixture', () => {
  it('has no orphaned threads', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const a = Analysis.parse(JSON.parse(readFileSync(join(here, '..', 'examples', 'relocation.json'), 'utf8')));
    expect(a.threads.length).toBeGreaterThan(0);
    expect(orphanedThreadsOf(a)).toEqual([]);
  });
});
