/**
 * Version-checked writes and surfaced conflicts (ADR-0011 clause 6, #109, #290).
 *
 * Last-write-wins is right for view state and wrong for shared data: two
 * contributors who each read a record and then write it would silently lose
 * whichever wrote first. Here every stored record has a **version**, a counter
 * that moves with each write to it; `updateIfVersion` (and `deleteIfVersion`)
 * writes only against the version the writer read, and otherwise rejects with
 * a `WriteConflict` that says what moved, so a person can decide. Nothing is
 * merged: not even writes that touch different parts are combined, because a
 * silent merge is exactly what the clause forbids and the editing granularity
 * (a cell, a thread, a saved view) makes conflicts rare enough to show.
 *
 * The mechanism is one, for any collection (`versionedCollection`): the
 * analysis is a collection of one document (`versionedAnalysisSource`), and
 * shared saved views and view sequences are collections of many (#290). Versions
 * are kept by the collection, per record, never in the record: a stored
 * record's shape does not change. They come from one counter per collection, so
 * a record deleted and saved again under the same id never comes back at a
 * version a stale writer read.
 *
 * This is the in-memory port; a deployed source implements the same
 * `VersionedProvider` port against its own store's etag or revision. Plain
 * `update` and `delete` stay available and move the version, so a versioned
 * writer is protected from them, but they are the unchecked path: callers that
 * write on a contributor's behalf (`mountMatrix`'s thread writes,
 * `savedViewStore`'s shared views) use the checked one.
 *
 * A write that changes nothing is not a write: it moves no version and tells no
 * subscriber. Every change event carries the version it produced, so a
 * subscriber that caches versions can place it. The base each recent version
 * had is kept (the last `historyLimit` per record), so a conflict says what the
 * rejected write changed *against what the writer read*, compared structurally.
 */
import type { DataChangeEvent, DataProvider } from '@zodal/store';

import type { Analysis } from '../core/schema/analysis.js';
import { inMemoryAnalysisSource, type AnalysisSource, type OneItemProviderOptions } from './index.js';

/** A record and the version it was read at. */
export interface Versioned<T> {
  item: T;
  version: number;
}

/** A change event from a versioned provider: the version the change produced. */
export type VersionedChangeEvent<T = Analysis> = DataChangeEvent<T> & { version: number };

/** A provider whose writes can be checked against the version the writer read. */
export interface VersionedProvider<T> extends DataProvider<T> {
  /** Hear every stored change with the version it produced, when the provider has changes to tell. */
  subscribe?(callback: (event: VersionedChangeEvent<T>) => void): () => void;
  /** The stored record and its version. */
  getVersioned(id: string): Promise<Versioned<T>>;
  /**
   * Write `data` only if the record is still at `expectedVersion`; otherwise
   * reject with a `WriteConflict` and change nothing.
   */
  updateIfVersion(id: string, data: Partial<T>, expectedVersion: number): Promise<Versioned<T>>;
}

/** A versioned provider of many records, any of which may be removed: removal is checked too. */
export interface VersionedCollection<T> extends VersionedProvider<T> {
  /** Remove the record only if it is still at `expectedVersion`; otherwise reject with a `WriteConflict`. */
  deleteIfVersion(id: string, expectedVersion: number): Promise<void>;
}

/** An analysis source whose writes can be checked against the version the writer read. */
export interface VersionedAnalysisSource extends AnalysisSource, VersionedProvider<Analysis> {
  /** Hear every stored change with the version it produced. */
  subscribe(callback: (event: VersionedChangeEvent) => void): () => void;
}

/** What a stale write carries: enough for a person to see what moved and act. */
export interface WriteConflictDetail<T = Analysis> {
  id: string;
  /** The version the writer read. */
  expectedVersion: number;
  /** The version the record is at now. */
  actualVersion: number;
  /** The record as it stands now: what the writer must reconcile with. `undefined` when someone else removed it. */
  current: T | undefined;
  /** What the writer tried to store: nothing, for a removal. */
  attempted: Partial<T>;
  /** Top-level fields other writers changed since `expectedVersion`. */
  theirChanges: readonly string[];
  /** Top-level fields the rejected write would have changed. */
  yourChanges: readonly string[];
  /** True when versions between the writer's and now were trimmed, so `theirChanges` (and `yourChanges`) may be incomplete. */
  incomplete?: boolean;
  /** The record, as the message names it: "this analysis" unless said otherwise. */
  what?: string;
}

/** A write made against a stale version. The message is for the person. */
export class WriteConflict<T = Analysis> extends Error implements WriteConflictDetail<T> {
  readonly id: string;
  readonly expectedVersion: number;
  readonly actualVersion: number;
  readonly current: T | undefined;
  readonly attempted: Partial<T>;
  readonly theirChanges: readonly string[];
  readonly yourChanges: readonly string[];
  /** Fields both sides changed: where the two edits actually collide. */
  readonly overlap: readonly string[];
  readonly incomplete: boolean;
  readonly what: string;

  constructor(detail: WriteConflictDetail<T>) {
    const overlap = detail.yourChanges.filter((k) => detail.theirChanges.includes(k));
    const what = detail.what ?? 'this analysis';
    const read = `you read version ${detail.expectedVersion}, it is now ${detail.actualVersion}`;
    super(
      detail.current === undefined
        ? `conflict: someone else removed ${what} while you were editing (${read}). Nothing was written.`
        : `conflict: someone else changed ${what} while you were editing (${read}). Nothing was written. ` +
          `They changed: ${list(detail.theirChanges)}; you were changing: ${list(detail.yourChanges)}` +
          (overlap.length ? `; both touched: ${overlap.join(', ')}` : '; the two do not overlap, but changes are never merged silently') +
          (detail.incomplete ? ' (older history was discarded, so these lists may be incomplete)' : '') +
          '. Reload the current version and apply your change again if it still makes sense.',
    );
    this.name = 'WriteConflict';
    this.id = detail.id;
    this.expectedVersion = detail.expectedVersion;
    this.actualVersion = detail.actualVersion;
    this.current = detail.current;
    this.attempted = detail.attempted;
    this.theirChanges = detail.theirChanges;
    this.yourChanges = detail.yourChanges;
    this.overlap = overlap;
    this.incomplete = detail.incomplete ?? false;
    this.what = what;
  }
}

const list = (keys: readonly string[]) => (keys.length ? keys.join(', ') : 'nothing recorded');

/** Structural equality for JSON-shaped values: key order does not matter, array order does. */
const same = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === (b as unknown[]).length && a.every((v, i) => same(v, (b as unknown[])[i]));
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = Object.keys(x).filter((k) => x[k] !== undefined);
  return keys.length === Object.keys(y).filter((k) => y[k] !== undefined).length && keys.every((k) => same(x[k], y[k]));
};

/** Top-level fields whose stored value differs between a record and what is written over it. */
const changedFields = (before: object, after: object): string[] =>
  Object.keys(after).filter((k) => !same((before as Record<string, unknown>)[k], (after as Record<string, unknown>)[k]));

/** The providers `versionedCollection` (or `markVersioned`) made: identity, not shape. */
const versionedSources = new WeakSet<object>();

/**
 * Declare that `source` honours the `VersionedProvider` port, for a deployed
 * source that implements it over its own store's revisions.
 */
export const markVersioned = <S extends Pick<VersionedProvider<unknown>, 'getVersioned' | 'updateIfVersion'>>(source: S): S => {
  versionedSources.add(source);
  return source;
};

/**
 * Type guard for hosts that hold a plain provider and want the checked path when there is one.
 *
 * By identity, not by shape: a host that wraps `{ ...versioned, update }` has a
 * source whose `update` it controls, and reaching `updateIfVersion` through the
 * copy would go around that wrapper. The copy is a plain source.
 */
export function isVersioned(source: AnalysisSource): source is VersionedAnalysisSource;
export function isVersioned<T>(source: DataProvider<T>): source is VersionedProvider<T>;
export function isVersioned(source: object): boolean {
  return versionedSources.has(source);
}

/** Whether `provider` is versioned and checks removals too: what a collection several clients write needs. */
export const isVersionedCollection = <T>(provider: DataProvider<T>): provider is VersionedCollection<T> =>
  isVersioned(provider) && typeof (provider as Partial<VersionedCollection<T>>).deleteIfVersion === 'function';

/** How many past versions' bases are kept per record, unless `historyLimit` says otherwise. */
export const DEFAULT_HISTORY_LIMIT = 50;

export interface VersionedCollectionOptions<T> {
  /** Past versions kept per record for describing a conflict. A writer older than this is told against the current record. */
  historyLimit?: number;
  /** How a conflict's message names the record (as it stands now, or as it was read when it is gone). Default: "this record". */
  describe?: (record: T | undefined) => string;
}

export interface VersionedSourceOptions extends OneItemProviderOptions {
  /** Past versions kept for describing a conflict. A writer older than this is told against the current document. */
  historyLimit?: number;
}

/** One record's kept past: the record as it stood at each version (none, once removed) and the fields the write that produced it changed. */
type History<T> = Map<number, { base: T | undefined; touched: string[] }>;

/** The id a change event is about. */
const idOf = (event: DataChangeEvent<unknown>): string => ('id' in event ? event.id : (event.item as { id: string }).id);

/**
 * `inner`, with versioned writes. Every record starts at version 0, and every
 * stored write to it through this wrapper (checked or not) moves its version to
 * the collection's next count. Writes go one at a time, so a check and the
 * write it allows are never split by another. Writes that go around the
 * wrapper, straight to `inner`, are not seen: hand the wrapper to every writer.
 */
export function versionedCollection<T extends { id: string }>(
  inner: DataProvider<T>,
  { historyLimit = DEFAULT_HISTORY_LIMIT, describe = () => 'this record' }: VersionedCollectionOptions<T> = {},
): VersionedCollection<T> {
  /** The last count handed out: every stored write takes the next. */
  let clock = 0;
  const versions = new Map<string, number>();
  const versionOf = (id: string) => versions.get(id) ?? 0;
  /** Removed through this wrapper and not saved again since. */
  const removed = new Set<string>();
  /** The id and version a write in flight will produce, so its events can carry it. */
  let producing: { id: string; version: number } | undefined;
  const histories = new Map<string, History<T>>();
  const historyOf = (id: string): History<T> => {
    let h = histories.get(id);
    if (!h) histories.set(id, (h = new Map()));
    return h;
  };
  const remember = (id: string, v: number, base: T | undefined, touched: string[]) => {
    const h = historyOf(id);
    h.set(v, { base, touched });
    // Oldest first: a Map keeps insertion order, and versions only grow.
    for (const old of h.keys()) {
      if (h.size <= historyLimit) break;
      h.delete(old);
    }
  };
  /** The record before its first write here is the base of the version it is at. */
  const keepBase = (id: string, before: T) => {
    if (!historyOf(id).has(versionOf(id))) remember(id, versionOf(id), structuredClone(before), []);
  };
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <R>(run: () => Promise<R>): Promise<R> => {
    const result = queue.then(run);
    queue = result.catch(() => undefined); // a refused write does not block the next
    return result;
  };
  /** Store under the next count: `store` makes the change, and the version moves only once it is made. */
  const stored = async <R>(id: string, store: () => Promise<R>, base: (r: R) => T | undefined, touched: string[]): Promise<{ result: R; version: number }> => {
    const next = clock + 1;
    producing = { id, version: next };
    try {
      const result = await store();
      clock = next;
      versions.set(id, clock);
      remember(id, clock, base(result), touched);
      return { result, version: clock };
    } finally {
      producing = undefined;
    }
  };
  const write = async (id: string, data: Partial<T>): Promise<Versioned<T>> => {
    const before = await inner.getOne(id);
    const fields = changedFields(before, data);
    // Nothing differs: not a write. No version, no event.
    if (fields.length === 0) return { item: before, version: versionOf(id) };
    keepBase(id, before);
    const { result: item, version } = await stored(id, () => inner.update(id, data), (r) => structuredClone(r), fields);
    return { item, version };
  };
  const remove = async (id: string) => {
    await stored(id, () => inner.delete(id), () => undefined, []);
    removed.add(id);
  };
  /** The conflict a stale write meets: what moved since the writer's version, against what they read when it is still kept. */
  const conflict = async (id: string, attempted: Partial<T>, expectedVersion: number): Promise<WriteConflict<T>> => {
    const actualVersion = versionOf(id);
    const current = removed.has(id) ? undefined : await inner.getOne(id);
    const kept = historyOf(id);
    const theirs = new Set<string>();
    for (const [v, { touched }] of kept) if (v > expectedVersion && v <= actualVersion) for (const k of touched) theirs.add(k);
    const read = kept.get(expectedVersion)?.base;
    return new WriteConflict<T>({
      id,
      expectedVersion,
      actualVersion,
      current,
      attempted,
      theirChanges: [...theirs],
      yourChanges: changedFields(read ?? current ?? {}, attempted),
      incomplete: read === undefined,
      what: describe(current ?? read),
    });
  };
  /** A checked write: made only when the record is still at the version the writer read. */
  const checked = <R>(id: string, attempted: Partial<T>, expectedVersion: number, run: () => Promise<R>) =>
    serial(async () => {
      if (expectedVersion !== versionOf(id)) throw await conflict(id, attempted, expectedVersion);
      return run();
    });

  // Its own methods too, for a provider whose methods live on a prototype; its subscribe only with versions added.
  const { subscribe: unversioned, ...rest } = inner;
  const subscribe = unversioned?.bind(inner);
  return markVersioned<VersionedCollection<T>>({
    ...rest,
    getList: (params) => inner.getList(params),
    getOne: (id) => inner.getOne(id),
    ...(inner.getCapabilities ? { getCapabilities: () => inner.getCapabilities!() } : {}),
    ...(subscribe
      ? {
        subscribe: (callback: (event: VersionedChangeEvent<T>) => void) => subscribe((event) => {
          const id = idOf(event);
          callback({ ...event, version: producing?.id === id ? producing.version : versionOf(id) });
        }),
      }
      : {}),
    create: (data) => serial(async () => {
      const { result } = await stored(String(data.id), () => inner.create(data), (r) => structuredClone(r), Object.keys(data));
      removed.delete(result.id);
      return result;
    }),
    update: (id, data) => serial(() => write(id, data)).then((r) => r.item),
    updateMany: (ids, data) => serial(async () => {
      const out: T[] = [];
      for (const id of ids) {
        // As the plain `updateMany`: an id not kept is passed over.
        const there = await inner.getOne(id).then(() => true, () => false);
        if (there) out.push((await write(id, data)).item);
      }
      return out;
    }),
    delete: (id) => serial(() => remove(id)),
    deleteMany: (ids) => serial(async () => {
      for (const id of ids) if (await inner.getOne(id).then(() => true, () => false)) await remove(id);
    }),
    getVersioned: (id) => serial(async () => ({ item: await inner.getOne(id), version: versionOf(id) })),
    updateIfVersion: (id, data, expectedVersion) => checked(id, data, expectedVersion, () => write(id, data)),
    deleteIfVersion: (id, expectedVersion) => checked(id, {}, expectedVersion, () => remove(id)),
  });
}

/** One wrapper per provider object: every writer in this page that is handed the same provider shares its versions. */
const wrappers = new WeakMap<object, VersionedCollection<never>>();

/**
 * `provider` itself when it already honours the port (by identity), else its
 * `versionedCollection`, made once per provider object and handed to every
 * caller after, so two stores given one plain provider check each other's
 * writes. `options` apply when the wrapper is first made. A provider that other
 * pages or processes write cannot be versioned from here: its host supplies the
 * port over its own revisions (`markVersioned`).
 */
export function asVersioned<T extends { id: string }>(provider: DataProvider<T>, options?: VersionedCollectionOptions<T>): VersionedCollection<T> {
  if (isVersionedCollection(provider)) return provider;
  let made = wrappers.get(provider) as VersionedCollection<T> | undefined;
  if (!made) wrappers.set(provider, (made = versionedCollection(provider, options)) as unknown as VersionedCollection<never>);
  return made;
}

/**
 * The analysis in memory, with versioned writes. Starts at version 0; every
 * stored write (checked or not) moves it by one. The `revisionProblems` rules
 * of `inMemoryAnalysisSource` apply to both paths.
 */
export function versionedAnalysisSource(analysis: Analysis, options: VersionedSourceOptions = {}): VersionedAnalysisSource {
  const { historyLimit = DEFAULT_HISTORY_LIMIT, ...providerOptions } = options;
  return versionedCollection(inMemoryAnalysisSource(analysis, providerOptions), { historyLimit, describe: () => 'this analysis' }) as VersionedAnalysisSource;
}
