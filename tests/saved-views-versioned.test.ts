/**
 * Several clients over one shared provider (#290, ADR-0011 clause 6): a shared
 * or locked view, and a sequence, is written only against the version its
 * writer read, so a lost race is a `WriteConflict`, never an overwrite. Each
 * race here is two `savedViewStore`s, two readers' clients, over one provider.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Analysis } from '../src/core/schema/analysis.js';
import { createView, type SavedView, type ViewSequence } from '../src/core/saved-views.js';
import { initialViewState, setEncoding } from '../src/core/view-state.js';
import {
  emptyReadOnlyProvider, isVersionedCollection, markVersioned, memoryCollection, savedViewStore, versionedCollection,
  versionedSavedViewStore, WriteConflict, type DataProvider, type VersionedCollection,
} from '../src/store/index.js';

const examples = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const relocation = Analysis.parse(JSON.parse(readFileSync(join(examples, 'relocation.json'), 'utf8')));
const base = initialViewState(relocation);
const encoded = setEncoding(base, 'missingness');
const ana = { by: 'ana', at: '2026-11-09T10:00:00Z' };
const ben = { by: 'ben', at: '2026-11-09T10:00:01Z' };
/** How the store names a view in a conflict, given to a collection made here (the store names the ones it versions itself). */
const named = { describe: (v: SavedView | undefined) => (v ? `the view "${v.name}"` : 'this view') };
const argument = () => createView(base, { id: 'v1', analysisId: relocation.id, name: 'The argument', mode: 'shared', ...ana });

/** Two readers' clients: each its own personal store, both over one shared provider and one sequence provider. */
const clients = (shared: DataProvider<SavedView>, sequences: DataProvider<ViewSequence> = memoryCollection<ViewSequence>()) =>
  [savedViewStore({ shared, sequences }), savedViewStore({ shared, sequences })] as const;

/**
 * The race at its worst, every time: no checked write is let through until `readers` reads have been made, so
 * both clients read the record before either writes.
 */
function raced<T>(inner: VersionedCollection<T>, readers = 2): VersionedCollection<T> {
  let reads = 0;
  let open = () => {};
  const allRead = new Promise<void>((resolve) => { open = resolve; });
  return markVersioned({
    ...inner,
    getVersioned: async (id) => {
      const read = await inner.getVersioned(id);
      if ((reads += 1) >= readers) open();
      return read;
    },
    updateIfVersion: async (id, data, version) => { await allRead; return inner.updateIfVersion(id, data, version); },
    deleteIfVersion: async (id, version) => { await allRead; return inner.deleteIfVersion(id, version); },
  });
}

/** The race's verdict: exactly one write landed, the other was told, and the stored view is the winner's, whole. */
async function oneWins(results: PromiseSettledResult<unknown>[]) {
  expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
  return (results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason as Error;
}

describe('a lock racing an update, through two clients over one shared provider (#290)', () => {
  it('ends locked, or reports a conflict: never shared and updated with the lock gone (a plain provider, as a host might pass)', async () => {
    const shared = memoryCollection<SavedView>();
    const [a, b] = clients(shared);
    const v = await a.create(base, { analysisId: relocation.id, name: 'The argument', mode: 'shared', ...ana });
    const results = await Promise.allSettled([a.lock(v.id, ana), b.update(v.id, encoded, ben)]);
    const lost = await oneWins(results);
    const after = (await a.get(v.id, 'ana'))!;
    if (results[0]!.status === 'fulfilled') {
      expect(after).toMatchObject({ mode: 'locked', snapshot: { encoding: base.encoding } });
      expect(lost.message).toMatch(/conflict|is locked/);
    } else {
      expect(after).toMatchObject({ mode: 'shared', snapshot: { encoding: 'missingness' } });
      expect(lost).toBeInstanceOf(WriteConflict);
    }
    // Whoever won, the record holds its whole history and nothing of the loser's.
    expect(after.events.map((e) => e.act)).toEqual(['created', results[0]!.status === 'fulfilled' ? 'locked' : 'updated']);
  });

  it('when both read before either writes, the second write is a conflict that names the view and what moved', async () => {
    const inner = versionedCollection(memoryCollection<SavedView>(), named);
    await inner.create(argument());
    const [a, b] = clients(raced(inner));
    const results = await Promise.allSettled([a.lock('v1', ana), b.update('v1', encoded, ben)]);
    const lost = await oneWins(results);
    expect(results[0]!.status).toBe('fulfilled'); // the first to write wins: the lock
    expect(lost).toBeInstanceOf(WriteConflict);
    const conflict = lost as WriteConflict<SavedView>;
    expect(conflict.message).toMatch(/^conflict: someone else changed the view "The argument" while you were editing .* Nothing was written\./);
    expect(conflict.theirChanges).toEqual(expect.arrayContaining(['mode', 'events']));
    expect(conflict.yourChanges).toEqual(expect.arrayContaining(['snapshot', 'events']));
    expect(conflict.current).toMatchObject({ mode: 'locked' });
    expect((await b.get('v1', 'ben'))!).toMatchObject({ mode: 'locked', snapshot: { encoding: base.encoding } });
    // Read again, the update is refused for the lock, with the reason: the loser is never left to overwrite.
    await expect(b.update('v1', encoded, ben)).rejects.toThrow(/is locked/);
  });

  it('a delete racing a lock never deletes a locked view', async () => {
    const inner = versionedCollection(memoryCollection<SavedView>(), named);
    await inner.create(argument());
    const [a, b] = clients(raced(inner));
    const lost = await oneWins(await Promise.allSettled([a.lock('v1', ana), b.delete('v1', ben)]));
    expect(lost).toBeInstanceOf(WriteConflict);
    expect((await a.get('v1', 'ana'))!.mode).toBe('locked');
  });

  it('an update to a view another client removed says it was removed, and saves nothing', async () => {
    const inner = versionedCollection(memoryCollection<SavedView>(), named);
    await inner.create(argument());
    const [a, b] = clients(raced(inner));
    const lost = await oneWins(await Promise.allSettled([a.delete('v1', ana), b.update('v1', encoded, ben)]));
    expect(lost).toBeInstanceOf(WriteConflict);
    expect(lost.message).toMatch(/someone else removed the view "The argument"/);
    expect(await a.get('v1', 'ana')).toBeUndefined();
  });

  it('two clients changing one sequence: one wins, the other is a conflict', async () => {
    const views = memoryCollection<SavedView>();
    const sequences = versionedCollection(memoryCollection<ViewSequence>());
    const [a, b] = clients(views, raced(sequences));
    const v = await a.create(base, { analysisId: relocation.id, name: 'A', mode: 'shared', ...ana });
    await sequences.create({ id: 's1', analysisId: relocation.id, name: 'Walk', steps: [{ viewId: v.id }] });
    const results = await Promise.allSettled([
      a.sequences.update('s1', { name: 'The walk' }, ana),
      b.sequences.update('s1', { steps: [] }, ben),
    ]);
    expect(await oneWins(results)).toBeInstanceOf(WriteConflict);
    expect(await a.sequences.get('s1')).toEqual({ id: 's1', analysisId: relocation.id, name: 'The walk', steps: [{ viewId: v.id }] });
  });

  it('one client, as before: a lock and an update sent together end locked, the update refused for the lock', async () => {
    const [a] = clients(memoryCollection<SavedView>());
    const v = await a.create(base, { analysisId: relocation.id, name: 'The argument', mode: 'shared', ...ana });
    const [locked, updated] = await Promise.allSettled([a.lock(v.id, ana), a.update(v.id, encoded, ben)]);
    expect(locked.status).toBe('fulfilled');
    expect((updated as PromiseRejectedResult).reason.message).toMatch(/is locked/);
  });
});

describe('the versioned port the store needs', () => {
  it('versionedSavedViewStore refuses a shared provider that does not honour it, saying what to pass instead', () => {
    expect(() => versionedSavedViewStore({ shared: memoryCollection<SavedView>() as never, sequences: emptyReadOnlyProvider() }))
      .toThrow(/"shared" must be a versioned collection .*savedViewStore versions a plain one/);
  });

  it('a provider that holds nothing honours it trivially: every checked write is refused as its plain one is', async () => {
    const empty = emptyReadOnlyProvider<SavedView>();
    expect(isVersionedCollection(empty)).toBe(true);
    await expect(empty.updateIfVersion('x', {}, 0)).rejects.toThrow(/read-only/);
    const store = versionedSavedViewStore({ shared: empty, sequences: emptyReadOnlyProvider() });
    expect(await store.list(relocation.id, 'ana')).toEqual([]);
  });
});
