/**
 * The migration harness, run for real.
 *
 * ADR-0006 and #54: "a deliberately-added version 2 in a test migrates a
 * version 1 fixture and back-reports the chain". The package is at version 1,
 * and the real chain refuses a step that would produce a version beyond the
 * current one -- so the test builds a chain towards version 2 (and 3) with
 * `createMigrationChain`, which is the same code with a different target.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createMigrationChain, migrate, needsMigration, registerMigration, registeredMigrations,
  _clearMigrations, type VersionedDocument,
} from '../src/core/migrations.js';
import { SCHEMA_VERSION, validateAnalysis } from '../src/core/schema/analysis.js';

const examples = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const languagesV1 = (): VersionedDocument =>
  JSON.parse(readFileSync(join(examples, 'languages.json'), 'utf8'));

/**
 * A plausible version 2: `subject.question` becomes `subject.questions`, a list.
 * Its inverse exists so the round trip can be checked by value, not by shape.
 */
const v1ToV2 = {
  from: 1,
  describes: 'subject.question becomes subject.questions, a list',
  migrate(doc: VersionedDocument): VersionedDocument {
    const { question, ...rest } = doc.subject as { question: string };
    return { ...doc, subject: { ...rest, questions: [question] } };
  },
};
const v2ToV1 = (doc: VersionedDocument): VersionedDocument => {
  const { questions, ...rest } = doc.subject as { questions: string[] };
  return { ...doc, subject: { ...rest, question: questions[0] }, schemaVersion: 1 };
};

describe('a deliberately-added version 2', () => {
  it('migrates the version-1 fixture and reports the chain it ran', () => {
    const chain = createMigrationChain({ currentVersion: 2 });
    chain.register(v1ToV2);

    const original = languagesV1();
    expect(original.schemaVersion).toBe(1);
    expect(chain.needsMigration(original)).toBe(true);

    const r = chain.migrate(original);
    expect(r.path).toEqual([1, 2]);
    expect(r.applied).toEqual([v1ToV2.describes]);
    expect(r.document.schemaVersion).toBe(2);
    expect((r.document.subject as { questions: string[] }).questions)
      .toEqual([(original.subject as { question: string }).question]);
    expect(chain.needsMigration(r.document)).toBe(false);

    // Round trip: the step lost nothing, and the input was not mutated.
    expect(v2ToV1(r.document)).toEqual(original);
    expect(original).toEqual(languagesV1());
  });

  it('composes steps and reports every one, in order', () => {
    const chain = createMigrationChain({ currentVersion: 3 });
    // Registered out of order on purpose: the chain is by version, not by call.
    chain.register({
      from: 2, describes: 'adds an empty tags list',
      migrate: (doc) => ({ ...doc, tags: [] }),
    });
    chain.register(v1ToV2);

    const r = chain.migrate(languagesV1());
    expect(r.path).toEqual([1, 2, 3]);
    expect(r.applied).toEqual([v1ToV2.describes, 'adds an empty tags list']);
    expect(r.document).toMatchObject({ schemaVersion: 3, tags: [] });
    expect(chain.registered().map((m) => m.from)).toEqual([1, 2]);
  });

  it('starts a document already at an intermediate version from there', () => {
    const chain = createMigrationChain({ currentVersion: 3 });
    chain.register(v1ToV2);
    chain.register({ from: 2, describes: 'second', migrate: (d) => d });
    const r = chain.migrate({ ...chain.migrate(languagesV1()).document, schemaVersion: 2 });
    expect(r.path).toEqual([2, 3]);
    expect(r.applied).toEqual(['second']);
  });
});

describe('refusals', () => {
  it('refuses a broken chain, naming the missing step', () => {
    const chain = createMigrationChain({ currentVersion: 3 });
    chain.register({ from: 2, describes: 'second', migrate: (d) => d });
    expect(() => chain.migrate(languagesV1())).toThrow(/no migration registered from schema version 1 to 2/);
  });

  it('refuses a document from the future with a message naming the version', () => {
    const chain = createMigrationChain({ currentVersion: 2 });
    expect(() => chain.migrate({ ...languagesV1(), schemaVersion: 7 }))
      .toThrow(/schema version 7; this build reads up to 2/);
  });

  it('refuses registering a step twice, or a step past the current version', () => {
    const chain = createMigrationChain({ currentVersion: 2 });
    chain.register(v1ToV2);
    expect(() => chain.register(v1ToV2)).toThrow(/already registered/);
    expect(() => chain.register({ ...v1ToV2, from: 2 })).toThrow(/at or beyond the current version 2/);
  });

  it('refuses a nonsense target version', () => {
    expect(() => createMigrationChain({ currentVersion: 0 })).toThrow(/positive integer/);
    expect(() => createMigrationChain({ currentVersion: 1.5 })).toThrow(/positive integer/);
  });
});

describe('the package chain, towards SCHEMA_VERSION', () => {
  afterEach(() => _clearMigrations());

  it('leaves a current document alone and reports an empty chain', () => {
    const doc = languagesV1();
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(needsMigration(doc)).toBe(false);
    const r = migrate(doc);
    expect(r.path).toEqual([SCHEMA_VERSION]);
    expect(r.applied).toEqual([]);
    expect(validateAnalysis(r.document).ok).toBe(true);
  });

  it('refuses a document from the future by version, not with a validation dump', () => {
    expect(() => migrate({ ...languagesV1(), schemaVersion: SCHEMA_VERSION + 1 }))
      .toThrow(new RegExp(`schema version ${SCHEMA_VERSION + 1}; this build reads up to ${SCHEMA_VERSION}`));
  });

  it('refuses a step past SCHEMA_VERSION, so a test cannot quietly extend the real chain', () => {
    expect(() => registerMigration({ ...v1ToV2, from: SCHEMA_VERSION }))
      .toThrow(/bump SCHEMA_VERSION first/);
    expect(registeredMigrations()).toEqual([]);
  });

  it('keeps separate chains separate', () => {
    // What lets view state migrate independently of the document: a chain built
    // for it shares nothing with this one.
    const other = createMigrationChain({ currentVersion: 2 });
    other.register(v1ToV2);
    expect(registeredMigrations()).toEqual([]);
    expect(needsMigration(languagesV1())).toBe(false);
  });
});
