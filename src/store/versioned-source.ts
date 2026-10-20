/**
 * Version-checked writes and surfaced conflicts (ADR-0011 clause 6, #109).
 *
 * Last-write-wins is right for view state and wrong for the analysis: two
 * contributors who each read the document and then write it would silently
 * lose whichever wrote first. Here every stored document has a **version**, a
 * counter that moves with each write; `updateIfVersion` writes only against
 * the version the writer read, and otherwise rejects with a `WriteConflict`
 * that says what moved, so a person can decide. Nothing is merged: not even
 * writes that touch different parts are combined, because a silent merge is
 * exactly what the clause forbids and the editing granularity (a cell, a
 * thread) makes conflicts rare enough to show.
 *
 * This is the in-memory source; a deployed source implements the same
 * `VersionedAnalysisSource` port against its own store's etag or revision.
 * Plain `update` stays available and bumps the version, so a versioned writer
 * is protected from it, but it is the unchecked path: callers that edit on a
 * contributor's behalf (`mountMatrix`'s thread writes) use the checked one.
 *
 * A write that changes nothing is not a write: it moves no version and tells no
 * subscriber. Every change event carries the version it produced, so a
 * subscriber that caches versions can place it. The base each recent version
 * had is kept (the last `historyLimit`), so a conflict says what the rejected
 * write changed *against what the writer read*, compared structurally.
 */
import type { Analysis } from '../core/schema/analysis.js';
import { inMemoryAnalysisSource, type AnalysisSource, type DataChangeEvent, type OneItemProviderOptions } from './index.js';

/** A document and the version it was read at. */
export interface Versioned<T> {
  item: T;
  version: number;
}

/** A change event from a versioned source: the version the change produced. */
export type VersionedChangeEvent = DataChangeEvent<Analysis> & { version: number };

/** An analysis source whose writes can be checked against the version the writer read. */
export interface VersionedAnalysisSource extends AnalysisSource {
  /** Hear every stored change with the version it produced. */
  subscribe(callback: (event: VersionedChangeEvent) => void): () => void;
  /** The stored document and its version. */
  getVersioned(id: string): Promise<Versioned<Analysis>>;
  /**
   * Write `data` only if the document is still at `expectedVersion`; otherwise
   * reject with a `WriteConflict` and change nothing.
   */
  updateIfVersion(id: string, data: Partial<Analysis>, expectedVersion: number): Promise<Versioned<Analysis>>;
}

/** What a stale write carries: enough for a person to see what moved and act. */
export interface WriteConflictDetail {
  id: string;
  /** The version the writer read. */
  expectedVersion: number;
  /** The version the document is at now. */
  actualVersion: number;
  /** The document as it stands now: what the writer must reconcile with. */
  current: Analysis;
  /** What the writer tried to store. */
  attempted: Partial<Analysis>;
  /** Top-level fields other writers changed since `expectedVersion`. */
  theirChanges: readonly string[];
  /** Top-level fields the rejected write would have changed. */
  yourChanges: readonly string[];
  /** True when versions between the writer's and now were trimmed, so `theirChanges` (and `yourChanges`) may be incomplete. */
  incomplete?: boolean;
}

/** A write made against a stale version. The message is for the person. */
export class WriteConflict extends Error implements WriteConflictDetail {
  readonly id: string;
  readonly expectedVersion: number;
  readonly actualVersion: number;
  readonly current: Analysis;
  readonly attempted: Partial<Analysis>;
  readonly theirChanges: readonly string[];
  readonly yourChanges: readonly string[];
  /** Fields both sides changed: where the two edits actually collide. */
  readonly overlap: readonly string[];
  readonly incomplete: boolean;

  constructor(detail: WriteConflictDetail) {
    const overlap = detail.yourChanges.filter((k) => detail.theirChanges.includes(k));
    super(
      `conflict: someone else changed this analysis while you were editing (you read version ${detail.expectedVersion}, ` +
        `it is now ${detail.actualVersion}). Nothing was written. They changed: ${list(detail.theirChanges)}; ` +
        `you were changing: ${list(detail.yourChanges)}` +
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

/** Top-level fields whose stored value differs between a document and what is written over it. */
const changedFields = (before: Analysis, after: Partial<Analysis>): string[] =>
  Object.keys(after).filter((k) => !same((before as Record<string, unknown>)[k], (after as Record<string, unknown>)[k]));

/** The sources `versionedAnalysisSource` (or `markVersioned`) made: identity, not shape. */
const versionedSources = new WeakSet<object>();

/**
 * Declare that `source` honours the `VersionedAnalysisSource` port, for a deployed
 * source that implements it over its own store's revisions.
 */
export const markVersioned = <S extends VersionedAnalysisSource>(source: S): S => {
  versionedSources.add(source);
  return source;
};

/**
 * Type guard for hosts that hold a plain `AnalysisSource` and want the checked path when there is one.
 *
 * By identity, not by shape: a host that wraps `{ ...versioned, update }` has a
 * source whose `update` it controls, and reaching `updateIfVersion` through the
 * copy would go around that wrapper. The copy is a plain source.
 */
export const isVersioned = (source: AnalysisSource): source is VersionedAnalysisSource => versionedSources.has(source);

/** How many past versions' bases are kept, unless `historyLimit` says otherwise. */
export const DEFAULT_HISTORY_LIMIT = 50;

export interface VersionedSourceOptions extends OneItemProviderOptions {
  /** Past versions kept for describing a conflict. A writer older than this is told against the current document. */
  historyLimit?: number;
}

/**
 * The analysis in memory, with versioned writes. Starts at version 0; every
 * stored write (checked or not) moves it by one. The `revisionProblems` rules
 * of `inMemoryAnalysisSource` apply to both paths.
 */
export function versionedAnalysisSource(analysis: Analysis, options: VersionedSourceOptions = {}): VersionedAnalysisSource {
  const { historyLimit = DEFAULT_HISTORY_LIMIT, ...providerOptions } = options;
  const inner = inMemoryAnalysisSource(analysis, providerOptions);
  let version = 0;
  /** The version a write in flight will produce, so its events can carry it. */
  let producing: number | undefined;
  /** `history.get(v)`: the document as it stood at version `v` and the fields the write that produced `v` changed. */
  const history = new Map<number, { base: Analysis; touched: string[] }>();
  const remember = (v: number, base: Analysis, touched: string[]) => {
    history.set(v, { base, touched });
    history.delete(v - historyLimit);
  };
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <R>(run: () => Promise<R>): Promise<R> => {
    const result = queue.then(run);
    queue = result.catch(() => undefined); // a refused write does not block the next
    return result;
  };
  const write = async (id: string, data: Partial<Analysis>): Promise<Versioned<Analysis>> => {
    const before = await inner.getOne(id);
    const fields = changedFields(before, data);
    // Nothing differs: not a write. No version, no event.
    if (fields.length === 0) return { item: before, version };
    producing = version + 1;
    try {
      const item = await inner.update(id, data);
      version = producing;
      remember(version, item, fields);
      return { item, version };
    } finally {
      producing = undefined;
    }
  };
  // The document at version 0 is the base of the first write.
  history.set(0, { base: structuredClone(analysis), touched: [] });
  return markVersioned({
    ...inner,
    subscribe: (callback) => inner.subscribe!((event) => callback({ ...event, version: producing ?? version })),
    update: (id, data) => serial(() => write(id, data)).then((r) => r.item),
    getVersioned: (id) => serial(async () => ({ item: await inner.getOne(id), version })),
    updateIfVersion: (id, data, expectedVersion) =>
      serial(async () => {
        if (expectedVersion !== version) {
          const current = await inner.getOne(id);
          const theirs = new Set<string>();
          for (let v = expectedVersion + 1; v <= version; v++) for (const k of history.get(v)?.touched ?? []) theirs.add(k);
          // Against what the writer read, when it is still kept; otherwise against the document as it stands.
          const read = history.get(expectedVersion)?.base;
          throw new WriteConflict({
            id,
            expectedVersion,
            actualVersion: version,
            current,
            attempted: data,
            theirChanges: [...theirs],
            yourChanges: changedFields(read ?? current, data),
            incomplete: read === undefined,
          });
        }
        return write(id, data);
      }),
  });
}
