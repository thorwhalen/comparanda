/**
 * Changing a criterion's definition bumps the criteria-set version rather than
 * silently rewriting history (#62).
 *
 * `reviseCriterion` always moves the set version; `material` decides whether the
 * criterion's `definedInVersion` moves too, and so whether `supersededCells`
 * reports the scores given before. `criteriaRevisionProblems` is the write-path
 * check, and the in-memory analysis source runs it on every update.
 */
import { describe, it, expect } from 'vitest';

import { Analysis, supersededCells } from '../src/core/schema/analysis.js';
import {
  reviseCriterion, criteriaRevisionProblems, nextCriteriaVersion, CRITERION_MEANING_FIELDS,
} from '../src/core/criteria-revision.js';
import { reviseCriterion as fromRoot } from '../src/index.js';
import { inMemoryAnalysisSource } from '../src/store/index.js';

const ORDINAL = { level: 'ordinal', preference: 'increasing', range: { min: 1, max: 5 }, levels: [1, 2, 3, 4, 5] };

const analysis = (over: Record<string, unknown> = {}) => Analysis.parse({
  id: 'a', subject: { question: 'q' }, authors: [{ id: 'ana', displayName: 'Ana', kind: 'human' }],
  alternatives: [{ id: 'x', label: 'X' }],
  criteria: [{ id: 'c', label: 'Support', defaultMeasurement: ORDINAL, definition: { question: 'Is support published?' } }],
  cells: [{
    alternativeId: 'x', criterionId: 'c', measure: 'score',
    assertions: [{ id: 's1', authorId: 'ana', at: '2026-08-22T00:00:00Z', value: 3, justification: 'j', criteriaVersion: '3' }],
  }],
  criteriaVersion: '3',
  ...over,
});

describe('nextCriteriaVersion', () => {
  it('bumps the last segment of a dotted integer, exactly at any size', () => {
    expect(nextCriteriaVersion('3')).toBe('4');
    expect(nextCriteriaVersion('1.9')).toBe('1.10');
    expect(nextCriteriaVersion('v2')).toBe('v3');
    expect(nextCriteriaVersion('9007199254740993')).toBe('9007199254740994');
  });

  it('reads an absent version as 1', () => {
    expect(nextCriteriaVersion(undefined)).toBe('2');
  });

  it('refuses to guess the successor of a version it cannot order', () => {
    expect(() => nextCriteriaVersion('spring-draft')).toThrow(/nextVersion/);
  });
});

describe('reviseCriterion', () => {
  it('a material change bumps the set version, moves definedInVersion, and supersedes earlier scores', () => {
    const a = analysis();
    expect(supersededCells(a).count).toBe(0);
    const b = reviseCriterion(a, 'c', { definition: { question: 'Is a dated support window published?' } }, { material: true });
    expect(b.criteriaVersion).toBe('4');
    expect(b.criteria[0]!.definedInVersion).toBe('4');
    expect(b.criteria[0]!.definition?.question).toMatch(/dated/);
    expect(supersededCells(b).count).toBe(1);
    expect(a.criteriaVersion).toBe('3');
    expect(a.criteria[0]!.definition?.question).toBe('Is support published?');
  });

  it('an immaterial change still bumps the set version, and supersedes nothing', () => {
    const b = reviseCriterion(analysis(), 'c', { label: 'Vendor support' }, { material: false });
    expect(b.criteriaVersion).toBe('4');
    expect(b.criteria[0]!.definedInVersion).toBeUndefined();
    expect(supersededCells(b).count).toBe(0);
  });

  it('takes an explicit next version, and refuses one that does not come after the current', () => {
    expect(reviseCriterion(analysis(), 'c', { label: 'L' }, { material: true, nextVersion: '10' }).criteriaVersion).toBe('10');
    expect(() => reviseCriterion(analysis(), 'c', { label: 'L' }, { material: true, nextVersion: '2' })).toThrow(/does not come after/);
  });

  it('refuses an unknown criterion, and a field that is not part of a criterion\'s meaning', () => {
    expect(() => reviseCriterion(analysis(), 'nope', { label: 'L' }, { material: true })).toThrow(/no criterion "nope"/);
    expect(() => reviseCriterion(analysis(), 'c', { weights: { voting: 2 } } as never, { material: true })).toThrow(/weights/);
  });

  it('produces a revision the write-path check accepts', () => {
    const a = analysis();
    const b = reviseCriterion(a, 'c', { defaultMeasurement: { ...a.criteria[0]!.defaultMeasurement!, thresholds: { indifference: 1 } } }, { material: true });
    expect(criteriaRevisionProblems(a, b)).toEqual([]);
  });

  it('is exported from the package root', () => {
    expect(fromRoot).toBe(reviseCriterion);
  });
});

describe('criteriaRevisionProblems refuses a silent rewrite', () => {
  const edit = (a: Analysis, patch: Record<string, unknown>, over: Partial<Analysis> = {}): Analysis =>
    ({ ...a, ...over, criteria: [{ ...a.criteria[0]!, ...patch }] });

  it('flags every meaning field changed without a version bump', () => {
    const a = analysis();
    for (const [field, value] of [
      ['label', 'Other'], ['definition', { question: 'new?' }], ['defaultMeasurement', { ...ORDINAL, levels: [1, 2, 3] }],
      ['measurements', { confidence: ORDINAL }], ['acceptability', { threshold: 2, rationale: 'r' }],
      ['missingCodes', [{ id: 'paywalled', broader: 'not-evidenced', means: 'm', params: {} }]],
    ] as const) {
      const p = criteriaRevisionProblems(a, edit(a, { [field]: value }));
      expect(p, field).toHaveLength(1);
      expect(p[0]!.message, field).toMatch(new RegExp(`changed its ${field}`));
      expect(p[0]!.fix).toMatch(/reviseCriterion/);
    }
    expect(CRITERION_MEANING_FIELDS).toHaveLength(6);
  });

  it('flags it when the set was never versioned, too', () => {
    const a = analysis({ criteriaVersion: undefined });
    expect(criteriaRevisionProblems(a, edit(a, { label: 'Other' }))[0]!.message).toMatch(/was not set/);
  });

  it('accepts the same change once the version moves forward', () => {
    const a = analysis();
    expect(criteriaRevisionProblems(a, edit(a, { label: 'Other' }, { criteriaVersion: '4' }))).toEqual([]);
  });

  it('ignores edits that do not change meaning, and key order', () => {
    const a = analysis();
    expect(criteriaRevisionProblems(a, edit(a, { weights: { voting: 3 }, groupIds: ['g'] }))).toEqual([]);
    const reordered = { ...a.criteria[0]!.defaultMeasurement! };
    const flipped = Object.fromEntries(Object.entries(reordered).reverse());
    expect(criteriaRevisionProblems(a, edit(a, { defaultMeasurement: flipped }))).toEqual([]);
  });

  it('refuses moving definedInVersion backwards, or past the set version', () => {
    const a = analysis({ criteria: [{ id: 'c', label: 'S', defaultMeasurement: ORDINAL, definedInVersion: '3' }] });
    expect(criteriaRevisionProblems(a, edit(a, { definedInVersion: '2' }))[0]!.path).toBe('criteria[0].definedInVersion');
    expect(criteriaRevisionProblems(a, edit(a, { definedInVersion: undefined }))).toHaveLength(1);
    expect(criteriaRevisionProblems(a, edit(a, { definedInVersion: '5' }, { criteriaVersion: '4' }))
      .map((p) => p.message).join(' ')).toMatch(/later than the criteria-set version/);
  });

  it('reads an unversioned set as "1": a bump to "1" or "0" has not moved (#165)', () => {
    const a = analysis({ criteriaVersion: undefined });
    for (const v of ['1', '0', '01']) {
      const p = criteriaRevisionProblems(a, edit(a, { label: 'Other' }, { criteriaVersion: v }));
      expect(p.map((x) => x.message).join(' '), v).toMatch(/changed its label/);
    }
    expect(criteriaRevisionProblems(a, edit(a, { label: 'Other' }, { criteriaVersion: '2' }))).toEqual([]);
    expect(() => reviseCriterion(a, 'c', { label: 'L' }, { material: true, nextVersion: '0' })).toThrow(/reads as "1"/);
    expect(() => reviseCriterion(a, 'c', { label: 'L' }, { material: true, nextVersion: '1' })).toThrow(/does not come after/);
    expect(reviseCriterion(a, 'c', { label: 'L' }, { material: true }).criteriaVersion).toBe('2');
  });

  it('refuses a set version that moves backwards or is dropped, even with no meaning change (#165)', () => {
    const a = analysis();
    expect(criteriaRevisionProblems(a, { ...a, criteriaVersion: '2' })[0]!.path).toBe('criteriaVersion');
    expect(criteriaRevisionProblems(a, { ...a, criteriaVersion: undefined })[0]!.message).toMatch(/reads as "1"/);
    expect(criteriaRevisionProblems(a, { ...a, criteriaVersion: '3' })).toEqual([]);
  });

  it('refuses removing a criterion, so it cannot come back with another meaning (#165, path A)', () => {
    const a = analysis();
    const removed = { ...a, criteria: [] };
    const p = criteriaRevisionProblems(a, removed);
    expect(p).toHaveLength(1);
    expect(p[0]!.fix).toMatch(/tombstone/);
    // The second half of the bypass is then never reachable from a stored state;
    // and tombstoning, the sanctioned delete, is accepted.
    expect(criteriaRevisionProblems(a, { ...a, criteria: [{ ...a.criteria[0]!, tombstoned: true }] })).toEqual([]);
  });

  it('refuses renaming a criterion id with its cells carried along (#165, path B)', () => {
    const a = analysis();
    const renamed = {
      ...a,
      criteria: [{ ...a.criteria[0]!, id: 'c2', label: 'Something else' }],
      cells: a.cells.map((c) => ({ ...c, criterionId: 'c2' })),
    };
    expect(criteriaRevisionProblems(a, renamed).map((x) => x.message).join(' ')).toMatch(/"c" was removed/);
  });

  it('does not compare criteria that were added', () => {
    const a = analysis();
    const b = { ...a, criteria: [...a.criteria, { ...a.criteria[0]!, id: 'new' }] };
    expect(criteriaRevisionProblems(a, b)).toEqual([]);
  });
});

describe('the in-memory analysis source enforces it on update', () => {
  it('refuses a silent rewrite and keeps the stored document', async () => {
    const a = analysis();
    const src = inMemoryAnalysisSource(a);
    await expect(src.update('a', { criteria: [{ ...a.criteria[0]!, label: 'Other' }] })).rejects.toThrow(/refused: criteria\[0\]/);
    expect((await src.getOne('a')).criteria[0]!.label).toBe('Support');
  });

  it('accepts a revision made through reviseCriterion', async () => {
    const a = analysis();
    const src = inMemoryAnalysisSource(a);
    const b = reviseCriterion(a, 'c', { label: 'Other' }, { material: true });
    await src.update('a', { criteria: b.criteria, criteriaVersion: b.criteriaVersion });
    const stored = await src.getOne('a');
    expect(stored.criteriaVersion).toBe('4');
    expect(supersededCells(stored).count).toBe(1);
  });

  it('refuses both halves of the remove-then-re-add bypass (#165)', async () => {
    const a = analysis();
    const src = inMemoryAnalysisSource(a);
    await expect(src.update('a', { criteria: [] })).rejects.toThrow(/was removed/);
    const stored = await src.getOne('a');
    expect(stored.criteria).toHaveLength(1);
    expect(stored.criteria[0]!.label).toBe('Support');
  });

  it('still lets an update that does not touch criteria through', async () => {
    const src = inMemoryAnalysisSource(analysis());
    await expect(src.update('a', { title: 'renamed' } as Partial<Analysis>)).resolves.toMatchObject({ title: 'renamed' });
  });
});
