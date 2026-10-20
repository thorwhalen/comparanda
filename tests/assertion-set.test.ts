/**
 * Three raters and three draws of one model must never read alike (#64).
 *
 * Two halves. At the boundary, a cell holding more than one live assertion
 * must say how independent each one is -- an honesty rule, so no flag turns it
 * off. In the core, `describeAssertionSet` names what kind of set a cell holds,
 * and its `label` is ADR-0024's text alternative: the count, what the
 * assertions are, then the exact multiset.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Analysis, validateAnalysis } from '../src/core/schema/analysis.js';
import { Cell, reduce } from '../src/core/schema/values.js';
import { describeAssertionSet } from '../src/core/assertion-set.js';
import { describeAssertionSet as fromRoot } from '../src/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const relocation = () => Analysis.parse(JSON.parse(readFileSync(join(root, 'examples', 'relocation.json'), 'utf8')));

const AUTHORS = [
  { id: 'ana', displayName: 'Ana', kind: 'human' as const },
  { id: 'ben', displayName: 'Ben', kind: 'human' as const },
  { id: 'ana:buyer', displayName: 'as the buyer', kind: 'human' as const, principalId: 'ana' },
  { id: 'bot', displayName: 'run 1', kind: 'agent' as const },
];

const assertion = (id: string, authorId: string, over: Record<string, unknown> = {}) => ({
  id, authorId, at: '2026-08-22T00:00:00Z', value: 3, justification: 'x', ...over,
});

const doc = (assertions: unknown[]) => ({
  id: 'd', subject: { question: 'q' }, authors: AUTHORS,
  alternatives: [{ id: 'x', label: 'X' }],
  criteria: [{
    id: 'c', label: 'C',
    defaultMeasurement: { level: 'ordinal', preference: 'increasing', range: { min: 1, max: 5 }, levels: [1, 2, 3, 4, 5] },
  }],
  cells: [{ alternativeId: 'x', criterionId: 'c', measure: 'score', assertions }],
});

const ruleHits = (input: unknown, opts: { includeCompleteness?: boolean } = {}) =>
  validateAnalysis(input, opts).problems.filter((p) => p.ruleId === 'independence-recorded');

describe('independence is required once a cell holds more than one live assertion', () => {
  it('rejects a multi-assertion cell with an unrecorded rung, naming the assertion', () => {
    const r = validateAnalysis(doc([
      assertion('a1', 'ana', { independence: 'independent' }),
      assertion('a2', 'ben'),
    ]));
    expect(r.ok).toBe(false);
    const hits = r.problems.filter((p) => p.ruleId === 'independence-recorded');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      path: 'cells[0].assertions[1].independence', family: 'honesty', severity: 'error', adr: 'ADR-0022',
    });
    expect(hits[0]!.message).toMatch(/2 raters from 2 draws of one model/);
    expect(hits[0]!.fix).toMatch(/resampled/);
  });

  it('reports every unrecorded member, not the first', () => {
    expect(ruleHits(doc([assertion('a1', 'ana'), assertion('a2', 'ben'), assertion('a3', 'bot')]))).toHaveLength(3);
  });

  it('is an honesty rule: dropping completeness does not drop it', () => {
    expect(ruleHits(doc([assertion('a1', 'ana'), assertion('a2', 'ben')]), { includeCompleteness: false }))
      .toHaveLength(2);
  });

  it('does not ask a single assertion for a rung: one is not a set', () => {
    const r = validateAnalysis(doc([assertion('a1', 'ana')]));
    expect(r.ok).toBe(true);
    expect(ruleHits(doc([assertion('a1', 'ana')]))).toHaveLength(0);
  });

  it('counts only the live set: a superseded assertion is history, not a rater', () => {
    const cell = [
      assertion('a1', 'ana', { supersededBy: 'a2' }),
      assertion('a2', 'ana'),
    ];
    expect(ruleHits(doc(cell))).toHaveLength(0);
  });

  it('accepts a multi-assertion cell whose every member records a rung, at any rung', () => {
    const r = validateAnalysis(doc([
      assertion('a1', 'bot', { independence: 'resampled' }),
      assertion('a2', 'bot', { independence: 'resampled' }),
    ]));
    expect(ruleHits(doc([
      assertion('a1', 'bot', { independence: 'resampled' }),
      assertion('a2', 'bot', { independence: 'resampled' }),
    ]))).toHaveLength(0);
    expect(r.ok).toBe(true);
  });

  it('counts an absence as a member of the set', () => {
    expect(ruleHits(doc([
      assertion('a1', 'ana', { independence: 'independent' }),
      { id: 'a2', authorId: 'ben', at: '2026-08-22T00:00:00Z', missing: { code: 'not-assessed' } },
    ]))).toHaveLength(1);
  });
});

const cellOf = (assertions: unknown[]) => Cell.parse({
  alternativeId: 'x', criterionId: 'c', measure: 'score', assertions,
});
const LEVELS = [1, 2, 3, 4, 5];

describe('describeAssertionSet names what kind of set a cell holds', () => {
  it('reads three independent people as three raters, with the multiset in full', () => {
    const d = describeAssertionSet(cellOf([
      assertion('a1', 'ana', { value: 5, independence: 'independent' }),
      assertion('a2', 'ben', { value: 2, independence: 'independent' }),
      assertion('a3', 'bot', { value: 2, independence: 'independent' }),
    ]), { authors: AUTHORS, levels: LEVELS });
    expect(d).toMatchObject({ n: 3, reading: 'raters', principals: 3, values: [2, 2, 5], independence: 'independent' });
    expect(d.label).toBe('3 raters: 2, 2, 5.');
  });

  it('reads three draws of one model as draws, never as raters, with the same multiset', () => {
    const d = describeAssertionSet(cellOf([
      assertion('a1', 'bot', { value: 5, independence: 'resampled' }),
      assertion('a2', 'bot', { value: 2, independence: 'resampled' }),
      assertion('a3', 'bot', { value: 2, independence: 'resampled' }),
    ]), { authors: AUTHORS, levels: LEVELS });
    expect(d).toMatchObject({ n: 3, reading: 'draws', principals: 1, sourceKind: 'agent', values: [2, 2, 5] });
    expect(d.label).toBe('3 draws of one model: 2, 2, 5.');
  });

  it('reads draws as draws even when each one claims independent', () => {
    // A producer that wrote `independent` on every draw is wrong; one principal
    // is one head, and the persona collapse is what catches it.
    const d = describeAssertionSet(cellOf([
      assertion('a1', 'bot', { independence: 'independent' }),
      assertion('a2', 'bot', { independence: 'independent' }),
    ]), { authors: AUTHORS });
    expect(d.reading).toBe('draws');
  });

  it('reads one person under two personas as one person, and keeps the kind of the principal', () => {
    const d = describeAssertionSet(cellOf([
      assertion('a1', 'ana', { value: 4, independence: 'independent' }),
      assertion('a2', 'ana:buyer', { value: 2, independence: 'independent' }),
    ]), { authors: AUTHORS, levels: LEVELS });
    expect(d).toMatchObject({ reading: 'draws', principals: 1, sourceKind: 'human' });
    expect(d.label).toBe('2 assertions by one person: 2, 4.');
  });

  it('reads several people below the independent rung as correlated, naming the rung', () => {
    const d = describeAssertionSet(cellOf([
      assertion('a1', 'ana', { value: 1, independence: 'shared-context' }),
      assertion('a2', 'ben', { value: 4, independence: 'independent' }),
    ]), { authors: AUTHORS, levels: LEVELS });
    expect(d).toMatchObject({ reading: 'correlated', independence: 'shared-context' });
    expect(d.label).toBe('2 assertions, not independent (shared-context): 1, 4.');
  });

  it('reads an unrecorded rung as unknown, never as raters', () => {
    const d = describeAssertionSet(cellOf([
      assertion('a1', 'ana', { independence: 'independent' }),
      assertion('a2', 'ben'),
    ]), { authors: AUTHORS });
    expect(d).toMatchObject({ reading: 'correlated', independence: 'unknown' });
    expect(d.label).toMatch(/independence not recorded/);
  });

  it('says why when a repeated principal is what lowered the rung', () => {
    const d = describeAssertionSet(cellOf([
      assertion('a1', 'ana', { value: 2, independence: 'independent' }),
      assertion('a2', 'ana:buyer', { value: 3, independence: 'independent' }),
      assertion('a3', 'ben', { value: 5, independence: 'independent' }),
    ]), { authors: AUTHORS, levels: LEVELS });
    expect(d).toMatchObject({ reading: 'correlated', principals: 2 });
    expect(d.label).toBe('3 assertions from 2 sources: 2, 3, 5.');
  });

  it('does not count a consensus verdict as one more rater', () => {
    const d = describeAssertionSet(cellOf([
      assertion('a1', 'ana', { independence: 'independent' }),
      assertion('a2', 'ben', { independence: 'consensus' }),
    ]), { authors: AUTHORS });
    expect(d.reading).toBe('correlated');
    expect(d.label).toMatch(/consensus verdict/);
  });

  it('keeps absences in the text alternative rather than dropping them', () => {
    const d = describeAssertionSet(cellOf([
      assertion('a1', 'ana', { value: 4, independence: 'independent' }),
      { id: 'a2', authorId: 'ben', at: '2026-08-22T00:00:00Z', missing: { code: 'not-evidenced' }, independence: 'independent' },
    ]), { authors: AUTHORS });
    expect(d).toMatchObject({ reading: 'raters', values: [4], absences: ['not-evidenced'] });
    expect(d.label).toBe('2 raters: 4; 1 absent (not-evidenced).');
  });

  it('reads absences as what their codes mean when given a resolver, keeping the codes for machines (#209)', () => {
    const d = describeAssertionSet(cellOf([
      { id: 'a1', authorId: 'ana', at: '2026-08-22T00:00:00Z', missing: { code: 'not-evidenced' }, independence: 'independent' },
      { id: 'a2', authorId: 'ben', at: '2026-08-22T00:00:00Z', missing: { code: 'not-evidenced' }, independence: 'independent' },
      { id: 'a3', authorId: 'bot', at: '2026-08-22T00:00:00Z', missing: { code: 'mystery' }, independence: 'independent' },
    ]), { authors: AUTHORS, means: (code) => (code === 'not-evidenced' ? 'We looked; the sources are silent.' : undefined) });
    expect(d.absences).toEqual(['not-evidenced', 'not-evidenced', 'mystery']);
    expect(d.label).toMatch(/absent \(“We looked; the sources are silent” ×2, mystery\)\.$/);
  });

  it('ignores superseded assertions and calls one live assertion a single', () => {
    const d = describeAssertionSet(cellOf([
      assertion('a1', 'ana', { value: 1, supersededBy: 'a2' }),
      assertion('a2', 'ana', { value: 4 }),
    ]), { authors: AUTHORS });
    expect(d).toMatchObject({ n: 1, reading: 'single', values: [4] });
    expect(d.independence).toBeUndefined();
    expect(d.label).toBe('1 assertion: 4.');
  });

  it('sorts by the declared level order, and keeps an undeclared value at the end', () => {
    const d = describeAssertionSet(cellOf([
      assertion('a1', 'ana', { value: 'low', independence: 'independent' }),
      assertion('a2', 'ben', { value: 'off-scale', independence: 'independent' }),
      assertion('a3', 'bot', { value: 'high', independence: 'independent' }),
    ]), { authors: AUTHORS, levels: ['high', 'mid', 'low'] });
    expect(d.values).toEqual(['high', 'low', 'off-scale']);
  });

  it('is exported from the package root', () => {
    expect(fromRoot).toBe(describeAssertionSet);
  });
});

describe('the messy fixture exercises both readings (#64)', () => {
  const a = relocation();
  const cellAt = (alt: string, crit: string) =>
    a.cells.find((c) => c.alternativeId === alt && c.criterionId === crit)!;
  const describe_ = (alt: string, crit: string) => describeAssertionSet(cellAt(alt, crit), {
    authors: a.authors,
    levels: a.criteria.find((c) => c.id === crit)!.defaultMeasurement?.levels,
  });

  it('still validates, now that independence is required on every multi-assertion cell', () => {
    const r = validateAnalysis(JSON.parse(readFileSync(join(root, 'examples', 'relocation.json'), 'utf8')));
    expect(r.problems.filter((p) => p.ruleId === 'independence-recorded')).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('holds three raters and three draws of one model, and labels them differently', () => {
    const raters = describe_('berlin', 'winter-daylight');
    const draws = describe_('seoul', 'school-quality');
    expect(raters.n).toBe(3);
    expect(draws.n).toBe(3);
    expect(raters.label).toBe('3 raters: 1, 1, 3.');
    expect(draws.label).toBe('3 draws of one model: 3, 3, 4.');
  });

  it('reads the persona disagreement as one person, not two raters', () => {
    expect(describe_('lisbon', 'rent').label).toBe('2 assertions by one person: 1450, 1900.');
  });

  it('reduces the draws by their declared mode, over the live set only', () => {
    const r = reduce(cellAt('seoul', 'school-quality'), {
      authors: a.authors, defaultReduction: a.defaultReduction, level: 'ordinal',
    });
    expect(r.value).toBe(3);
    expect(r.contributing).toHaveLength(3);
    expect(r.independence).toMatchObject({ weakest: 'resampled', flagged: true });
  });
});
