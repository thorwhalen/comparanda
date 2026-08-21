/**
 * The migration harness.
 *
 * Written *with* version 1, not when a migration is first needed (ADR-0006).
 * The reason is not tidiness: a harness retrofitted after the first breaking
 * change has to reconstruct what the old shape was from memory, and the shape
 * you remember is never quite the shape you shipped.
 *
 * Migrations compose. A document at any registered version reaches the current
 * one by running each registered step in order, and every step is tested against
 * a fixture captured at *its* version rather than regenerated from the current
 * one -- a regenerated fixture proves only that the current code agrees with
 * itself.
 */
import { SCHEMA_VERSION } from './schema/analysis.js';

/** A document at some schema version, before validation. */
export type VersionedDocument = Record<string, unknown> & { schemaVersion?: number };

export interface Migration {
  /** Version this migrates *from*. Produces `from + 1`. */
  from: number;
  /** One line, present tense, describing the shape change. */
  describes: string;
  migrate(doc: VersionedDocument): VersionedDocument;
}

const registry = new Map<number, Migration>();

/**
 * Register a migration. Explicit rather than self-registering at module scope:
 * a self-registering module is deleted by a bundler under `sideEffects: false`
 * and the failure is silent -- you get an empty registry and no error.
 */
export function registerMigration(m: Migration): void {
  if (registry.has(m.from)) {
    throw new Error(`a migration from version ${m.from} is already registered`);
  }
  if (m.from >= SCHEMA_VERSION) {
    throw new Error(
      `migration from version ${m.from} would produce ${m.from + 1}, at or beyond the current ` +
      `version ${SCHEMA_VERSION}; bump SCHEMA_VERSION first`,
    );
  }
  registry.set(m.from, m);
}

export function registeredMigrations(): Migration[] {
  return [...registry.values()].sort((a, b) => a.from - b.from);
}

/** Testing seam. Not exported from the package entry point. */
export function _clearMigrations(): void {
  registry.clear();
}

export interface MigrationResult {
  document: VersionedDocument;
  /** Versions traversed, e.g. `[1, 2, 3]` for a document that started at 1. */
  path: number[];
  applied: string[];
}

/**
 * Bring a document up to the current schema version.
 *
 * Throws rather than guessing in two cases. A document from the *future* cannot
 * be down-migrated -- we do not know what it added, and silently dropping the
 * fields we do not recognise would lose data on a round-trip. A gap in the
 * registry means the chain is broken, and applying the steps either side of a
 * missing one produces a document that validates and is wrong, which is worse
 * than an error.
 */
export function migrate(doc: VersionedDocument): MigrationResult {
  const start = typeof doc.schemaVersion === 'number' ? doc.schemaVersion : 1;

  if (start > SCHEMA_VERSION) {
    throw new Error(
      `document is at schema version ${start}; this build reads up to ${SCHEMA_VERSION}. ` +
      'Down-migration is not supported: the fields a newer version added are unknown here, ' +
      'and dropping them would lose data silently.',
    );
  }

  let current = doc;
  const path = [start];
  const applied: string[] = [];

  for (let v = start; v < SCHEMA_VERSION; v += 1) {
    const step = registry.get(v);
    if (!step) {
      throw new Error(
        `no migration registered from schema version ${v} to ${v + 1}. The chain from ${start} to ` +
        `${SCHEMA_VERSION} is broken; register the missing step rather than skipping it.`,
      );
    }
    current = { ...step.migrate(current), schemaVersion: v + 1 };
    path.push(v + 1);
    applied.push(step.describes);
  }

  return { document: current, path, applied };
}

/** Whether a document needs migrating. Cheap; safe to call on every load. */
export function needsMigration(doc: VersionedDocument): boolean {
  const v = typeof doc.schemaVersion === 'number' ? doc.schemaVersion : 1;
  return v < SCHEMA_VERSION;
}
