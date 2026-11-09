/**
 * A collection kept in browser storage: a `DataProvider<T>` over one key, with
 * the fallback chain `viewStateProvider` uses (#117, ADR-0006).
 *
 * `@zodal/store-localstorage` keeps a collection the same way, but reads the
 * global `localStorage` with no injection and no fallback: on the platforms
 * where it throws (private browsing, blocked site data) it would lose what it
 * was given without saying so. This one takes its storage, falls back to
 * memory with a notice the host must show (`browser-storage.ts`), and rejects a
 * write the storage refuses with words for the person. When the zodal adapter
 * takes an injected storage, this becomes a wrapper around it.
 *
 * Every operation reads the stored list, applies itself, and writes the list
 * back. Nothing is cached between operations, so another tab's write is seen on
 * the next read rather than overwritten by a stale copy; operations in this tab
 * go one at a time. A stored record this collection does not accept is never
 * handed out, and is written back as it was: a newer version's record survives
 * an older page.
 *
 * Queries are the caller's, as `DEFAULT_CAPABILITIES` says (no server-side
 * sort, filter, search or pagination): `getList` returns the whole collection.
 * That is what keeps `@zodal/store`'s in-memory query engine out of the
 * standalone page's byte budget; `memoryCollection` is the same collection
 * with nothing kept past the page.
 */
import { DEFAULT_CAPABILITIES, type DataProvider } from '@zodal/store';

import {
  memoryStorage, resolveStorage, statusChannel, writeOrSay, type StatusChannel, type StorageStatus,
} from './browser-storage.js';
import type { IdentityStorage } from './index.js';

export interface LocalCollectionOptions<T> {
  /** The key the list is kept under: one per collection, and per analysis where pages share an origin. */
  key: string;
  /** Where it is kept. Default: the browser's `localStorage`, when a write to it succeeds; else memory. */
  storage?: IdentityStorage;
  /** Whether a stored record is one this collection holds. Default: an object with a string `id`. */
  accept?: (raw: unknown) => raw is T;
  /** What the person is told when nothing can be kept past this tab. */
  memoryNotice?: string;
}

export interface LocalCollection<T> {
  provider: DataProvider<T>;
  status(): StorageStatus;
  /** The person has seen the notice. It returns on the next failure. */
  acknowledge(): void;
  /** Hear `status()` change. Returns the unsubscribe. */
  onStatus(listener: (status: StorageStatus) => void): () => void;
}

export const LOCAL_COLLECTION_MEMORY_NOTICE =
  'This browser is not letting the page save anything, so what you keep here will be lost when this tab closes.';

const hasId = <T>(raw: unknown): raw is T =>
  typeof raw === 'object' && raw !== null && typeof (raw as { id?: unknown }).id === 'string';

export function localCollectionProvider<T extends { id: string }>({
  key, storage, accept = hasId, memoryNotice = LOCAL_COLLECTION_MEMORY_NOTICE,
}: LocalCollectionOptions<T>): LocalCollection<T> {
  const resolved = resolveStorage(storage, key);
  const channel = statusChannel(resolved ? { backing: 'local-storage' } : { backing: 'memory', notice: memoryNotice });
  const provider = collectionIn(resolved ?? memoryStorage(), key, accept, channel);
  return { provider, status: channel.status, acknowledge: channel.acknowledge, onStatus: channel.onStatus };
}

/** A collection in memory, for as long as the page: the same records and refusals, with nothing to tell anyone. */
export function memoryCollection<T extends { id: string }>(): DataProvider<T> {
  return collectionIn<T>(memoryStorage(), 'collection', hasId, statusChannel({ backing: 'memory' }));
}

/** The collection's operations over one key of `store`; a refused write goes to `channel`. */
function collectionIn<T extends { id: string }>(
  store: IdentityStorage, key: string, accept: (raw: unknown) => raw is T, channel: StatusChannel,
): DataProvider<T> {
  /** The stored list, split into what this collection holds and what it leaves alone. Anything unreadable is an empty list. */
  const read = (): { held: T[]; kept: unknown[] } => {
    let raw: unknown;
    try {
      raw = JSON.parse(store.getItem(key) ?? '[]');
    } catch {
      raw = [];
    }
    const list = Array.isArray(raw) ? raw : [];
    return { held: list.filter(accept), kept: list.filter((x) => !accept(x)) };
  };
  const missing = (id: string) => new Error(`no record "${id}" is kept here.`);

  let chain: Promise<unknown> = Promise.resolve();
  /**
   * One operation at a time, on the list as stored now. `op` returns its result and, for a write, the list it leaves,
   * which is stored before the result is handed out: a write the storage refuses rejects, with nothing stored.
   */
  const run = <R>(op: (held: T[]) => { result: R; next?: T[] }): Promise<R> => {
    const go = async () => {
      const { held, kept } = read();
      const { result, next } = op(held);
      if (next) writeOrSay(store, key, JSON.stringify([...kept, ...next]), channel);
      return result;
    };
    const step = chain.then(go, go);
    chain = step.catch(() => undefined);
    return step;
  };
  /** Each record a copy: nobody holds a reference into the list. */
  const copy = (x: T): T => structuredClone(x);
  const merge = (held: T[], ids: readonly string[], data: Partial<T>) =>
    held.map((x) => (ids.includes(x.id) ? { ...x, ...data, id: x.id } : x));

  return {
    getList: () => run((held) => ({ result: { data: held.map(copy), total: held.length } })),
    getOne: (id) => run((held) => {
      const found = held.find((x) => x.id === id);
      if (!found) throw missing(id);
      return { result: copy(found) };
    }),
    create: (data) => run((held) => {
      const item = data as T;
      if (!item.id || held.some((x) => x.id === item.id)) throw new Error(`a record needs an id of its own; "${String(item.id)}" is not one.`);
      return { result: copy(item), next: [...held, copy(item)] };
    }),
    update: (id, data) => run((held) => {
      if (!held.some((x) => x.id === id)) throw missing(id);
      const next = merge(held, [id], data);
      return { result: copy(next.find((x) => x.id === id)!), next };
    }),
    updateMany: (ids, data) => run((held) => {
      const next = merge(held, ids, data);
      return { result: next.filter((x) => ids.includes(x.id)).map(copy), next };
    }),
    delete: (id) => run((held) => {
      if (!held.some((x) => x.id === id)) throw missing(id);
      return { result: undefined, next: held.filter((x) => x.id !== id) };
    }),
    deleteMany: (ids) => run((held) => ({ result: undefined, next: held.filter((x) => !ids.includes(x.id)) })),
    getCapabilities: () => ({ ...DEFAULT_CAPABILITIES }),
  };
}
