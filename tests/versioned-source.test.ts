/**
 * Version-checked writes and surfaced conflicts (#109, ADR-0011 clause 6).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Analysis } from '../src/core/schema/analysis.js';
import { isVersioned, inMemoryAnalysisSource, versionedAnalysisSource, WriteConflict } from '../src/store/index.js';

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
});
