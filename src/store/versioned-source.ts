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
 */
import type { Analysis } from '../core/schema/analysis.js';
import { inMemoryAnalysisSource, type AnalysisSource, type OneItemProviderOptions } from './index.js';

/** A document and the version it was read at. */
export interface Versioned<T> {
  item: T;
  version: number;
}

/** An analysis source whose writes can be checked against the version the writer read. */
export interface VersionedAnalysisSource extends AnalysisSource {
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

  constructor(detail: WriteConflictDetail) {
    const overlap = detail.yourChanges.filter((k) => detail.theirChanges.includes(k));
    super(
      `conflict: someone else changed this analysis while you were editing (you read version ${detail.expectedVersion}, ` +
        `it is now ${detail.actualVersion}). Nothing was written. They changed: ${list(detail.theirChanges)}; ` +
        `you were changing: ${list(detail.yourChanges)}` +
        (overlap.length ? `; both touched: ${overlap.join(', ')}` : '; the two do not overlap, but changes are never merged silently') +
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
  }
}

const list = (keys: readonly string[]) => (keys.length ? keys.join(', ') : 'nothing recorded');

/** Top-level fields whose stored value differs between two documents. */
const changedFields = (before: Analysis, after: Partial<Analysis>): string[] =>
  Object.keys(after).filter((k) => JSON.stringify((before as Record<string, unknown>)[k]) !== JSON.stringify((after as Record<string, unknown>)[k]));

/** Type guard for hosts that hold a plain `AnalysisSource` and want the checked path when there is one. */
export const isVersioned = (source: AnalysisSource): source is VersionedAnalysisSource =>
  typeof (source as Partial<VersionedAnalysisSource>).updateIfVersion === 'function';

/**
 * The analysis in memory, with versioned writes. Starts at version 0; every
 * stored write (checked or not) moves it by one. The `revisionProblems` rules
 * of `inMemoryAnalysisSource` apply to both paths.
 */
export function versionedAnalysisSource(analysis: Analysis, options?: OneItemProviderOptions): VersionedAnalysisSource {
  const inner = inMemoryAnalysisSource(analysis, options);
  let version = 0;
  /** `touched[v]`: the fields the write that produced version `v` changed. */
  const touched = new Map<number, string[]>();
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <R>(run: () => Promise<R>): Promise<R> => {
    const result = queue.then(run);
    queue = result.catch(() => undefined); // a refused write does not block the next
    return result;
  };
  const write = async (id: string, data: Partial<Analysis>): Promise<Versioned<Analysis>> => {
    const before = await inner.getOne(id);
    const fields = changedFields(before, data);
    const item = await inner.update(id, data);
    version += 1;
    touched.set(version, fields);
    return { item, version };
  };
  return {
    ...inner,
    update: (id, data) => serial(() => write(id, data)).then((r) => r.item),
    getVersioned: (id) => serial(async () => ({ item: await inner.getOne(id), version })),
    updateIfVersion: (id, data, expectedVersion) =>
      serial(async () => {
        if (expectedVersion !== version) {
          const current = await inner.getOne(id);
          const theirs = new Set<string>();
          for (let v = expectedVersion + 1; v <= version; v++) for (const k of touched.get(v) ?? []) theirs.add(k);
          throw new WriteConflict({
            id,
            expectedVersion,
            actualVersion: version,
            current,
            attempted: data,
            theirChanges: [...theirs],
            yourChanges: changedFields(current, data),
          });
        }
        return write(id, data);
      }),
  };
}
