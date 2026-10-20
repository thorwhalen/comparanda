/**
 * Version-checked writes and surfaced conflicts (#109, ADR-0011 clause 6).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Analysis } from '../src/core/schema/analysis.js';
import { isVersioned, inMemoryAnalysisSource, markVersioned, versionedAnalysisSource, WriteConflict } from '../src/store/index.js';

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
