/**
 * A collection kept in browser storage (#117): the standalone page's personal
 * saved views. Injected storage, the fallback to memory with a notice, a loud
 * refusal when the storage is full, another tab's writes never overwritten, and
 * a record this version does not read left as it was.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Analysis } from '../src/core/schema/analysis.js';
import { initialViewState } from '../src/core/view-state.js';
import {
  localCollectionProvider, localSavedViews, memoryCollection, savedViewStore, StorageQuotaError, LOCAL_COLLECTION_MEMORY_NOTICE,
} from '../src/store/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const relocation = Analysis.parse(JSON.parse(readFileSync(join(root, 'examples', 'relocation.json'), 'utf8')));
const base = initialViewState(relocation);
const ana = { by: 'ana', at: '2026-11-09T10:00:00Z' };

const mapStorage = (map = new Map<string, string>()) => ({
  map,
  getItem: (k: string) => map.get(k) ?? null,
  setItem: (k: string, v: string) => void map.set(k, v),
  removeItem: (k: string) => void map.delete(k),
});
const domError = (name: string) => Object.assign(new Error(name), { name });
type Row = { id: string; name: string };

describe('a local collection', () => {
  it('keeps its records under its key, so a page opened again reads them back', async () => {
    const storage = mapStorage();
    const first = localCollectionProvider<Row>({ key: 'k', storage });
    expect(first.status()).toEqual({ backing: 'local-storage' });
    await first.provider.create({ id: 'a', name: 'A' });
    await first.provider.update('a', { name: 'A2' });
    await first.provider.create({ id: 'b', name: 'B' });
    await first.provider.delete('b');
    const again = localCollectionProvider<Row>({ key: 'k', storage });
    expect((await again.provider.getList({})).data).toEqual([{ id: 'a', name: 'A2' }]);
    expect(JSON.parse(storage.map.get('k')!)).toEqual([{ id: 'a', name: 'A2' }]);
  });

  it('falls back to memory, with a notice, where the browser will not keep anything', async () => {
    const refusing = { getItem: () => null, setItem: () => { throw domError('SecurityError'); }, removeItem: () => {} };
    const c = localCollectionProvider<Row>({ key: 'k', storage: refusing, memoryNotice: 'gone when the tab closes' });
    expect(c.status()).toEqual({ backing: 'memory', notice: 'gone when the tab closes' });
    await c.provider.create({ id: 'a', name: 'A' });
    expect((await c.provider.getOne('a')).name).toBe('A');
    c.acknowledge();
    expect(c.status()).toEqual({ backing: 'memory' });
    expect(localCollectionProvider<Row>({ key: 'k', storage: refusing }).status().notice).toBe(LOCAL_COLLECTION_MEMORY_NOTICE);
  });

  it('refuses a write the storage has no room for, loudly, and keeps what was stored', async () => {
    const storage = mapStorage();
    const c = localCollectionProvider<Row>({ key: 'k', storage });
    await c.provider.create({ id: 'a', name: 'A' });
    const heard: (string | undefined)[] = [];
    c.onStatus((s) => heard.push(s.notice));
    const set = storage.setItem;
    storage.setItem = () => { throw domError('QuotaExceededError'); };
    await expect(c.provider.create({ id: 'b', name: 'B' })).rejects.toBeInstanceOf(StorageQuotaError);
    expect(heard).toEqual([expect.stringMatching(/storage is full/)]);
    storage.setItem = set;
    expect((await c.provider.getList({})).data.map((r) => r.id)).toEqual(['a']);
    // A later write that succeeds clears it: "NOT saved" is no longer true.
    await c.provider.create({ id: 'b', name: 'B' });
    expect(c.status()).toEqual({ backing: 'local-storage' });
  });

  it('keeps the memory notice through writes that succeed: nothing is kept past the tab still', async () => {
    const refusing = { getItem: () => null, setItem: (): undefined => { throw domError('SecurityError'); }, removeItem: () => undefined };
    const c = localCollectionProvider<Row>({ key: 'k', storage: refusing });
    await c.provider.create({ id: 'a', name: 'A' });
    expect(c.status().notice).toBe(LOCAL_COLLECTION_MEMORY_NOTICE);
  });

  it('moves stored text it cannot read aside before writing over it, and refuses rather than lose a second one', async () => {
    const storage = mapStorage(new Map([['k', '{"v":2,"views":{}}']]));
    const c = localCollectionProvider<Row>({ key: 'k', storage });
    expect((await c.provider.getList({})).data).toEqual([]);
    await c.provider.create({ id: 'a', name: 'A' });
    expect(storage.map.get('k.unreadable')).toBe('{"v":2,"views":{}}');
    expect(JSON.parse(storage.map.get('k')!)).toEqual([{ id: 'a', name: 'A' }]);
    storage.map.set('k', 'not json');
    await expect(c.provider.create({ id: 'b', name: 'B' })).rejects.toThrow(/cannot read, and "k.unreadable" is taken: nothing was written/);
    expect(storage.map.get('k')).toBe('not json');
    expect(storage.map.get('k.unreadable')).toBe('{"v":2,"views":{}}');
  });

  it('reads the stored list on every operation, so another tab\'s record is not overwritten', async () => {
    const storage = mapStorage();
    const here = localCollectionProvider<Row>({ key: 'k', storage });
    const there = localCollectionProvider<Row>({ key: 'k', storage });
    await here.provider.create({ id: 'a', name: 'A' });
    await there.provider.create({ id: 'b', name: 'B' });
    await here.provider.create({ id: 'c', name: 'C' });
    expect((await there.provider.getList({})).data.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('never hands out a record it does not accept, and writes it back as it was', async () => {
    const storage = mapStorage(new Map([['k', JSON.stringify([{ id: 'a', name: 'A' }, { future: true }, 'odd'])]]));
    const c = localCollectionProvider<Row>({ key: 'k', storage });
    expect((await c.provider.getList({})).data).toEqual([{ id: 'a', name: 'A' }]);
    await c.provider.create({ id: 'b', name: 'B' });
    expect(JSON.parse(storage.map.get('k')!)).toEqual([{ future: true }, 'odd', { id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
  });

  it('refuses a record with no id of its own, or an unknown id, and hands out copies', async () => {
    const c = memoryCollection<Row>();
    await c.create({ id: 'a', name: 'A' });
    await expect(c.create({ id: 'a', name: 'again' })).rejects.toThrow(/an id of its own/);
    await expect(c.create({ name: 'none' })).rejects.toThrow(/an id of its own/);
    await expect(c.update('x', { name: 'X' })).rejects.toThrow(/no record "x"/);
    await expect(c.delete('x')).rejects.toThrow(/no record "x"/);
    const got = await c.getOne('a');
    got.name = 'tampered';
    expect((await c.getOne('a')).name).toBe('A');
    // An update never moves a record to another id.
    expect(await c.update('a', { id: 'b', name: 'A2' } as Partial<Row>)).toEqual({ id: 'a', name: 'A2' });
  });
});

describe('a reader\'s personal saved views, kept locally', () => {
  it('survive the page being opened again, one key per analysis', async () => {
    const storage = mapStorage();
    const store = () => savedViewStore({ personal: localSavedViews(relocation.id, { storage }).provider });
    const v = await store().create(base, { analysisId: relocation.id, name: 'Cost first', ...ana });
    expect(await store().get(v.id, 'ana')).toMatchObject({ name: 'Cost first', mode: 'personal' });
    expect([...storage.map.keys()]).toEqual([`comparanda.saved-views.${relocation.id}`]);
    expect(await savedViewStore({ personal: localSavedViews('another', { storage }).provider }).list(relocation.id, 'ana')).toEqual([]);
  });

  it('list what this version can read, leaving a view it cannot read stored as it was', async () => {
    const storage = mapStorage();
    const store = savedViewStore({ personal: localSavedViews(relocation.id, { storage }).provider });
    const v = await store.create(base, { analysisId: relocation.id, name: 'Cost first', ...ana });
    const key = `comparanda.saved-views.${relocation.id}`;
    const newer = { ...v, id: 'newer', name: 'From a newer page', pinnedTo: 'board' };
    storage.map.set(key, JSON.stringify([newer, ...JSON.parse(storage.map.get(key)!)]));
    expect((await store.list(relocation.id, 'ana')).map((x) => x.name)).toEqual(['Cost first']);
    await store.rename(v.id, 'Cheapest', ana);
    expect(JSON.parse(storage.map.get(key)!)[0]).toEqual(newer);
  });
});
