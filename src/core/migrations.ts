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

export interface MigrationResult {
  document: VersionedDocument;
  /** Versions traversed, e.g. `[1, 2, 3]` for a document that started at 1. */
  path: number[];
  applied: string[];
}

/**
 * A migration chain towards one current version.
 *
 * The functions this module exports are one such chain, towards
 * `SCHEMA_VERSION`. The factory exists for two reasons, both of which a single
 * hard-wired registry could not serve:
 *
 * 1. **A test can add version 2 without bumping the package.** The rule that a
 *    migration may not produce a version beyond the current one is right for the
 *    real chain and makes it impossible to exercise a step while the schema is
 *    at version 1. A chain built with `currentVersion: 2` is the same code with
 *    a different target, so the round trip it tests is the round trip the
 *    package will run.
 * 2. **View state migrates independently of the analysis document** (ADR-0006,
 *    #54): it gets its own chain, with its own version, rather than a second
 *    table bolted onto this one.
 */
export interface MigrationChain {
  readonly currentVersion: number;
  register(m: Migration): void;
  registered(): Migration[];
  migrate(doc: VersionedDocument): MigrationResult;
  needsMigration(doc: VersionedDocument): boolean;
  /**
   * The versions in `1 .. currentVersion - 1` with no registered step. Empty
   * means a document at any earlier version reaches the current one.
   *
   * The enforceable form of "every version bump registers a step, even a
   * no-op" (ADR-0006): at version 1 it is vacuously empty, and the moment the
   * version is bumped without a step it is not, so a test over it fails the
   * build instead of `migrate` failing on a reader's stored document.
   */
  missingSteps(): number[];
  /**
   * Forget every step registered after construction. The steps the chain was
   * built with stay: they are what ships, and a test seam that removed them
   * would make the completeness test above fail exactly when a real step exists.
   */
  clear(): void;
}

export function createMigrationChain(
  { currentVersion, steps = [] }: {
    currentVersion: number;
    /** The steps that ship with this chain. `clear()` keeps these. */
    steps?: readonly Migration[];
  },
): MigrationChain {
  if (!Number.isInteger(currentVersion) || currentVersion < 1) {
    throw new Error(`currentVersion must be a positive integer (got ${currentVersion})`);
  }
  const registry = new Map<number, Migration>();
  const versionOf = (doc: VersionedDocument) =>
    (typeof doc.schemaVersion === 'number' ? doc.schemaVersion : 1);

  /**
   * Register a migration. Explicit rather than self-registering at module scope:
   * a self-registering module is deleted by a bundler under `sideEffects: false`
   * and the failure is silent -- you get an empty registry and no error.
   */
  function register(m: Migration): void {
    if (registry.has(m.from)) {
      throw new Error(`a migration from version ${m.from} is already registered`);
    }
    if (m.from >= currentVersion) {
      throw new Error(
        `migration from version ${m.from} would produce ${m.from + 1}, at or beyond the current ` +
        `version ${currentVersion}; bump SCHEMA_VERSION first`,
      );
    }
    registry.set(m.from, m);
  }

  /**
   * Bring a document up to the current version.
   *
   * Throws rather than guessing in two cases. A document from the *future* cannot
   * be down-migrated -- we do not know what it added, and silently dropping the
   * fields we do not recognise would lose data on a round-trip. A gap in the
   * registry means the chain is broken, and applying the steps either side of a
   * missing one produces a document that validates and is wrong, which is worse
   * than an error.
   */
  function migrate(doc: VersionedDocument): MigrationResult {
    const start = versionOf(doc);

    if (start > currentVersion) {
      throw new Error(
        `document is at schema version ${start}; this build reads up to ${currentVersion}. ` +
        'Down-migration is not supported: the fields a newer version added are unknown here, ' +
        'and dropping them would lose data silently.',
      );
    }

    let current = doc;
    const path = [start];
    const applied: string[] = [];

    for (let v = start; v < currentVersion; v += 1) {
      const step = registry.get(v);
      if (!step) {
        throw new Error(
          `no migration registered from schema version ${v} to ${v + 1}. The chain from ${start} to ` +
          `${currentVersion} is broken; register the missing step rather than skipping it.`,
        );
      }
      current = { ...step.migrate(current), schemaVersion: v + 1 };
      path.push(v + 1);
      applied.push(step.describes);
    }

    return { document: current, path, applied };
  }

  const chain: MigrationChain = {
    currentVersion,
    register,
    registered: () => [...registry.values()].sort((a, b) => a.from - b.from),
    migrate,
    needsMigration: (doc) => versionOf(doc) < currentVersion,
    missingSteps: () => Array.from({ length: currentVersion - 1 }, (_, i) => i + 1).filter((v) => !registry.has(v)),
    clear: () => {
      registry.clear();
      steps.forEach(register);
    },
  };

  steps.forEach(register);
  return chain;
}

/**
 * The analysis document's shipped migration steps, one per version bump.
 *
 * Empty at version 1, because there is no version 0 to migrate from: a
 * document with no `schemaVersion` reads as 1. The first entry arrives with the
 * first bump, `{ from: 1, ... }`, and the completeness test fails the build
 * until it does. Data rather than a registration call at module scope, so a
 * bundler under `sideEffects: false` cannot drop it.
 */
export const DOCUMENT_MIGRATIONS: readonly Migration[] = Object.freeze([]);

/** The analysis document's chain, towards `SCHEMA_VERSION`. */
const documentChain = createMigrationChain({ currentVersion: SCHEMA_VERSION, steps: DOCUMENT_MIGRATIONS });

/** Register a migration on the analysis document's chain. */
export function registerMigration(m: Migration): void {
  documentChain.register(m);
}

export function registeredMigrations(): Migration[] {
  return documentChain.registered();
}

/**
 * Testing seam: forget steps registered at runtime, keeping the shipped ones.
 * Exported from the package entry point too (`export *`), so the leading
 * underscore is the only warning.
 */
export function _clearMigrations(): void {
  documentChain.clear();
}

/** Bring an analysis document up to `SCHEMA_VERSION`. See `MigrationChain.migrate`. */
export function migrate(doc: VersionedDocument): MigrationResult {
  return documentChain.migrate(doc);
}

/** Versions on the analysis document's chain with no registered step. See `MigrationChain.missingSteps`. */
export function missingMigrationSteps(): number[] {
  return documentChain.missingSteps();
}

/** Whether a document needs migrating. Cheap; safe to call on every load. */
export function needsMigration(doc: VersionedDocument): boolean {
  return documentChain.needsMigration(doc);
}
