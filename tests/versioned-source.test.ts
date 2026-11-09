/**
 * Version-checked writes and surfaced conflicts (#109, #290, ADR-0011 clause 6):
 * the analysis's source, and the collection mechanism it is one case of.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Analysis } from '../src/core/schema/analysis.js';
import {
  asVersioned, DEFAULT_COLLECTION_HISTORY_LIMIT, isVersioned, isVersionedCollection, inMemoryAnalysisSource, markVersioned, memoryCollection,
  savedViewStore, versionedAnalysisSource, versionedCollection, WriteConflict,
} from '../src/store/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const analysis = Analysis.parse(JSON.parse(readFileSync(join(root, 'examples', 'relocation.json'), 'utf8')));
const withNote = (n: string) => ({ subject: { ...analysis.subject, question: n } });

describe('versioned analysis source', () => {
  it('reads a version and accepts a write against it', async () => {
    const s = versionedAnalysisSource(analysis);
    const { version } = await s.getVersioned(analysis.id);
    const written = await s.updateIfVersion(analysis.id, withNote('A?'), version);
    expect(written.version).toBe(version + 1);
    expect(written.item.subject.question).toBe('A?');
  });

  it('rejects a stale write with a conflict a person can act on, and stores nothing', async () => {
    const s = versionedAnalysisSource(analysis);
    const { version } = await s.getVersioned(analysis.id);
    await s.updateIfVersion(analysis.id, withNote('theirs?'), version); // the other contributor
    const err = await s.updateIfVersion(analysis.id, withNote('mine?'), version).catch((e) => e);
    expect(err).toBeInstanceOf(WriteConflict);
    expect(err.expectedVersion).toBe(version);
    expect(err.actualVersion).toBe(version + 1);
    expect(err.theirChanges).toEqual(['subject']);
    expect(err.overlap).toEqual(['subject']);
    expect(err.current.subject.question).toBe('theirs?');
    expect(err.attempted.subject.question).toBe('mine?');
    expect(err.message).toMatch(/Nothing was written/);
    expect((await s.getOne(analysis.id)).subject.question).toBe('theirs?');
  });

  it('does not merge even a write to a different field', async () => {
    const s = versionedAnalysisSource(analysis);
    const { version } = await s.getVersioned(analysis.id);
    await s.updateIfVersion(analysis.id, withNote('theirs?'), version);
    const err = await s.updateIfVersion(analysis.id, { title: 'Mine' } as never, version).catch((e) => e);
    expect(err).toBeInstanceOf(WriteConflict);
    expect(err.overlap).toEqual([]);
    expect(err.message).toMatch(/never merged silently/);
  });

  it('an unchecked update moves the version, so a versioned writer is stopped by it', async () => {
    const s = versionedAnalysisSource(analysis);
    const { version } = await s.getVersioned(analysis.id);
    await s.update(analysis.id, withNote('unchecked?'));
    await expect(s.updateIfVersion(analysis.id, withNote('mine?'), version)).rejects.toBeInstanceOf(WriteConflict);
  });

  it('two writers who both read the same version: exactly one wins', async () => {
    const s = versionedAnalysisSource(analysis);
    const { version } = await s.getVersioned(analysis.id);
    const results = await Promise.allSettled([
      s.updateIfVersion(analysis.id, withNote('a?'), version),
      s.updateIfVersion(analysis.id, withNote('b?'), version),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
  });

  it('isVersioned tells the checked source from a plain one', () => {
    expect(isVersioned(versionedAnalysisSource(analysis))).toBe(true);
    expect(isVersioned(inMemoryAnalysisSource(analysis))).toBe(false);
  });

  it('says what the rejected write changed against what the writer read, not against the current document (#230)', async () => {
    const s = versionedAnalysisSource(analysis);
    const { version } = await s.getVersioned(analysis.id);
    const mine = { subject: { ...analysis.subject }, title: 'Mine' } as never; // subject: the same as read
    await s.updateIfVersion(analysis.id, withNote('theirs?'), version);
    const err = await s.updateIfVersion(analysis.id, mine, version).catch((e) => e);
    expect(err.yourChanges).toEqual(['title']);
    expect(err.overlap).toEqual([]);
  });

  it('compares structurally, so key order is not a change', async () => {
    const s = versionedAnalysisSource(analysis);
    const { version } = await s.getVersioned(analysis.id);
    const reordered = { subject: Object.fromEntries(Object.entries(analysis.subject).reverse()) } as never;
    const written = await s.updateIfVersion(analysis.id, reordered, version);
    expect(written.version).toBe(version);
  });

  it('a write that changes nothing moves no version and tells no subscriber', async () => {
    const s = versionedAnalysisSource(analysis);
    const heard: number[] = [];
    s.subscribe((e) => heard.push(e.version));
    const { version } = await s.getVersioned(analysis.id);
    await s.update(analysis.id, { subject: analysis.subject });
    expect((await s.getVersioned(analysis.id)).version).toBe(version);
    expect(heard).toEqual([]);
  });

  it('every change event carries the version it produced', async () => {
    const s = versionedAnalysisSource(analysis);
    const heard: number[] = [];
    s.subscribe((e) => heard.push(e.version));
    await s.update(analysis.id, withNote('1?'));
    await s.updateIfVersion(analysis.id, withNote('2?'), 1);
    expect(heard).toEqual([1, 2]);
  });

  it('keeps only the last historyLimit versions, and still names a conflict for an older writer', async () => {
    const s = versionedAnalysisSource(analysis, { historyLimit: 2 });
    for (const n of ['1?', '2?', '3?', '4?']) await s.update(analysis.id, withNote(n));
    const err = await s.updateIfVersion(analysis.id, withNote('mine?'), 0).catch((e) => e);
    expect(err).toBeInstanceOf(WriteConflict);
    expect(err.theirChanges).toEqual(['subject']); // versions 3 and 4 only: older ones were trimmed
    expect(err.yourChanges).toEqual(['subject']); // told against the current document
    expect(err.incomplete).toBe(true);
    expect(err.message).toMatch(/may be incomplete/);
  });

  it('a wrapper around a versioned source is not versioned, so it cannot be bypassed (#230)', () => {
    const inner = versionedAnalysisSource(analysis);
    const wrapped = { ...inner, update: inner.update };
    expect(isVersioned(wrapped)).toBe(false);
    expect(isVersioned(markVersioned(wrapped))).toBe(true);
  });

  it('a conflict within the kept history is not flagged incomplete', async () => {
    const s = versionedAnalysisSource(analysis);
    const { version } = await s.getVersioned(analysis.id);
    const err = await (async () => {
      await s.update(analysis.id, withNote('x?'));
      return s.updateIfVersion(analysis.id, { title: 'T' } as never, version).catch((e) => e);
    })();
    expect(err.incomplete).toBe(false);
  });
});

describe('versioned collection (#290): the same mechanism, for many records', () => {
  type Row = { id: string; n: number; note?: string };
  const rows = async () => {
    const c = versionedCollection(memoryCollection<Row>(), { describe: (r) => (r ? `row ${r.id}` : 'a row') });
    await c.create({ id: 'a', n: 1 });
    await c.create({ id: 'b', n: 1 });
    return c;
  };

  it('versions each record on its own: a write to one never makes another stale', async () => {
    const c = await rows();
    const a = await c.getVersioned('a');
    const b = await c.getVersioned('b');
    await c.updateIfVersion('b', { n: 2 }, b.version);
    await expect(c.updateIfVersion('a', { n: 2 }, a.version)).resolves.toMatchObject({ item: { n: 2 } });
  });

  it('names the record in the conflict, and says what each side changed', async () => {
    const c = await rows();
    const { version } = await c.getVersioned('a');
    await c.update('a', { n: 5 });
    const err = await c.updateIfVersion('a', { note: 'mine' }, version).catch((e) => e);
    expect(err).toBeInstanceOf(WriteConflict);
    expect(err.message).toMatch(/^conflict: someone else changed row a while you were editing/);
    expect([err.theirChanges, err.yourChanges, err.overlap]).toEqual([['n'], ['note'], []]);
    expect((await c.getOne('a')).note).toBeUndefined();
  });

  it('checks a removal too: a stale delete is a conflict, and a delete makes every earlier reader stale', async () => {
    const c = await rows();
    const { version } = await c.getVersioned('a');
    await c.update('a', { n: 9 });
    await expect(c.deleteIfVersion('a', version)).rejects.toBeInstanceOf(WriteConflict);
    expect((await c.getOne('a')).n).toBe(9);
    const now = await c.getVersioned('a');
    await c.deleteIfVersion('a', now.version);
    const gone = await c.updateIfVersion('a', { n: 1 }, now.version).catch((e) => e);
    expect(gone).toBeInstanceOf(WriteConflict);
    expect(gone.current).toBeUndefined();
    expect(gone.message).toMatch(/someone else removed row a while you were editing.*Nothing was written/);
  });

  it('a record removed and saved again under its id never comes back at a version a stale writer read', async () => {
    const c = await rows();
    const stale = await c.getVersioned('a');
    await c.delete('a');
    await c.create({ id: 'a', n: 100 });
    await expect(c.updateIfVersion('a', { n: 0 }, stale.version)).rejects.toBeInstanceOf(WriteConflict);
    expect((await c.getOne('a')).n).toBe(100);
  });

  it('unchecked bulk writes move the version too, so a checked writer is stopped by them', async () => {
    const c = await rows();
    const { version } = await c.getVersioned('a');
    await c.updateMany(['a', 'missing'], { n: 3 });
    await expect(c.updateIfVersion('a', { n: 4 }, version)).rejects.toBeInstanceOf(WriteConflict);
  });

  it('asVersioned: a versioned collection as it is, and one wrapper per plain provider, so its writers check each other', async () => {
    const plain = memoryCollection<Row>();
    const once = asVersioned(plain);
    expect(asVersioned(plain)).toBe(once);
    expect(asVersioned(once)).toBe(once);
    expect(isVersionedCollection(once)).toBe(true);
    expect(isVersionedCollection(plain)).toBe(false);
    await once.create({ id: 'a', n: 1 });
    const { version } = await once.getVersioned('a');
    await asVersioned(plain).update('a', { n: 2 });
    await expect(once.updateIfVersion('a', { n: 3 }, version)).rejects.toBeInstanceOf(WriteConflict);
  });

  it('wraps a provider whose methods live on a prototype', async () => {
    class Kept {
      private inner = memoryCollection<Row>();
      getList(p: Parameters<typeof this.inner.getList>[0]) { return this.inner.getList(p); }
      getOne(id: string) { return this.inner.getOne(id); }
      create(x: Partial<Row>) { return this.inner.create(x); }
      update(id: string, x: Partial<Row>) { return this.inner.update(id, x); }
      updateMany(ids: string[], x: Partial<Row>) { return this.inner.updateMany(ids, x); }
      delete(id: string) { return this.inner.delete(id); }
      deleteMany(ids: string[]) { return this.inner.deleteMany(ids); }
      getCapabilities() { return this.inner.getCapabilities!(); }
    }
    const c = versionedCollection<Row>(new Kept());
    await c.create({ id: 'a', n: 1 });
    expect((await c.getList({})).total).toBe(1);
    expect(c.getCapabilities!().canUpdate).toBe(true);
  });

  it('refuses a provider that other pages or processes write (multiWriter): versions kept here would never see their writes', () => {
    const plain = memoryCollection<Row>();
    const remote = { ...plain, getCapabilities: () => ({ ...plain.getCapabilities!(), multiWriter: true }) };
    const said = /reports multiWriter.*last would silently win.*getVersioned, updateIfVersion and deleteIfVersion over the backend's own etag or revision.*markVersioned/;
    expect(() => asVersioned(remote)).toThrow(said);
    expect(() => versionedCollection(remote)).toThrow(said);
    expect(() => savedViewStore({ shared: remote as never })).toThrow(said);
    // The host's own port over its revisions is taken as it is.
    const own = markVersioned({ ...versionedCollection(memoryCollection<Row>()), getCapabilities: () => ({ ...plain.getCapabilities!(), multiWriter: true }) });
    expect(asVersioned(own)).toBe(own);
  });

  it('refuses to wrap a provider versioned already but without a checked delete, rather than ignore its versions', () => {
    const half = markVersioned({ ...memoryCollection<Row>(), getVersioned: async () => ({ item: { id: 'a', n: 1 }, version: 7 }), updateIfVersion: async () => ({ item: { id: 'a', n: 1 }, version: 8 }) });
    expect(() => asVersioned(half)).toThrow(/versioned already, but does not check removals/);
  });

  it('keeps one clock per provider: a second wrapper is refused, and so are other options for the one there is', () => {
    const plain = memoryCollection<Row>();
    const describe = () => 'a row';
    const made = versionedCollection(plain, { describe });
    expect(asVersioned(plain)).toBe(made);
    expect(asVersioned(plain, { describe })).toBe(made);
    expect(() => versionedCollection(plain)).toThrow(/versioned already: two wrappers would keep two clocks/);
    expect(() => asVersioned(plain, { historyLimit: 3 })).toThrow(/versioned already with other options/);
    expect(() => asVersioned(plain, { describe: () => 'another' })).toThrow(/versioned already with other options/);
  });

  it('versions a created record under the id it was stored with, when the provider assigns it', async () => {
    const plain = memoryCollection<Row>();
    const assigning = { ...plain, create: (x: Partial<Row>) => plain.create({ ...x, id: x.id ?? 'given' }) };
    const c = versionedCollection(assigning);
    await c.create({ n: 1 });
    const { version } = await c.getVersioned('given');
    expect(version).toBeGreaterThan(0);
    await c.update('given', { n: 2 });
    await expect(c.updateIfVersion('given', { n: 3 }, version)).rejects.toBeInstanceOf(WriteConflict);
  });

  it(`keeps ${DEFAULT_COLLECTION_HISTORY_LIMIT} past versions per record by default: a collection holds many records, each a full copy`, async () => {
    const c = await rows();
    for (let n = 2; n <= DEFAULT_COLLECTION_HISTORY_LIMIT + 1; n++) await c.update('a', { n });
    const err = await c.updateIfVersion('a', { note: 'mine' }, 1).catch((e) => e);
    expect(err.incomplete).toBe(true);
  });
});
