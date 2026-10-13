/**
 * The detail panel's content, headless (#94): `cellDetail` says everything a
 * cell holds -- assertions, authors, evidence, provenance, absence reason and
 * note, the level distribution -- and `alternativeStanding` names an
 * alternative's strongest and weakest criteria by order comparisons only.
 */
import { describe, expect, it } from 'vitest';

import { Analysis, vocabularyOf } from '../src/core/schema/analysis.js';
import { alternativeStanding, cellDetail } from '../src/core/detail.js';
import relocationJson from '../examples/relocation.json';

const relocation = Analysis.parse(relocationJson);
const vocabulary = vocabularyOf(relocation);
const detail = (alt: string, crit: string) => cellDetail(relocation, alt, crit, 'score', { vocabulary });

describe('cellDetail', () => {
  it('lists every assertion with its author, justification and evidence', () => {
    const d = detail('berlin', 'rent');
    expect(d.assertions.map((x) => x.author?.displayName)).toHaveLength(2);
    expect(d.assertions.every((x) => x.assertion.justification)).toBe(true);
    expect(d.assertions.flatMap((x) => x.evidence).length).toBe(3);
    expect(d.assertions.flatMap((x) => x.evidence).every((e) => e.label.length > 0)).toBe(true);
    expect(d.reduction).toBe('lower-median');
    expect(d.reduced?.value).toBe(1600);
  });

  it('names the principal behind a persona', () => {
    const persona = detail('lisbon', 'rent').assertions.find((x) => x.assertion.authorId === 'ana:the-frugal-one');
    expect(persona?.principal).toBe(relocation.authors.find((x) => x.id === 'ana')!.displayName);
  });

  it('reads a recorded absence through the vocabulary, with its note', () => {
    const d = detail('berlin', 'income-tax');
    expect(d.absence?.code).toBe('paywalled');
    expect(d.absence?.note).toMatch(/subscription/);
    expect(d.absence?.means).toBeTruthy();
    expect(d.assertions[0]!.absence?.code).toBe('paywalled');
  });

  it('gives an unrecorded cell the absence the matrix shows, never a bare blank', () => {
    const recorded = new Set(relocation.cells.map((c) => `${c.alternativeId}/${c.criterionId}`));
    const blank = relocation.alternatives.flatMap((a) => relocation.criteria.map((c) => [a.id, c.id] as const))
      .find(([a, c]) => !recorded.has(`${a}/${c}`));
    expect(blank).toBeDefined();
    const d = detail(blank![0], blank![1]);
    expect(d.assertions).toEqual([]);
    expect(['not-assessed', 'not-applicable']).toContain(d.absence?.code);
    expect(d.absence?.standing).not.toBe('undeclared');
  });

  it('lists superseded assertions after the live ones, marked', () => {
    const d = detail('seoul', 'school-quality');
    const firstSuperseded = d.assertions.findIndex((x) => x.superseded);
    expect(firstSuperseded).toBeGreaterThan(0);
    expect(d.assertions.slice(firstSuperseded).every((x) => x.superseded)).toBe(true);
    expect(d.set.reading).toBe('draws');
  });

  it('places several values over the declared levels, in order, uncentred', () => {
    const d = detail('berlin', 'winter-daylight');
    expect(d.distribution?.levels.map((l) => l.count)).toEqual([2, 0, 1, 0, 0]);
    expect(d.distribution?.n).toBe(3);
    expect(d.distribution?.ordered).toBe(true);
    expect(detail('lisbon', 'income-tax').distribution).toBeUndefined();
  });

  it('reads each citation check through the injected standing, and flags an unfounded inference', () => {
    const a = Analysis.parse({
      id: 'x', subject: { question: 'q' },
      alternatives: [{ id: 'a', label: 'A' }], criteria: [{ id: 'c', label: 'C' }],
      authors: [{ id: 'bot', displayName: 'Bot', kind: 'agent' }],
      cells: [{
        alternativeId: 'a', criterionId: 'c', measure: 'score',
        assertions: [{ id: 's', authorId: 'bot', at: '2026-01-01', value: 1, evidence: [
          { id: 'e1', target: 'https://example.org', sourceType: 'agent-inference' },
          { id: 'e2', target: 'doc:1', sourceType: 'agent-inference', derivedFrom: ['e1'], label: 'Derived' },
        ] }],
      }],
    });
    const seen: unknown[] = [];
    const d = cellDetail(a, 'a', 'c', 'score', {
      vocabulary: vocabularyOf(a),
      standing: (check) => { seen.push(check); return { freshness: 'unchecked' } as never; },
    });
    const [e1, e2] = d.assertions[0]!.evidence;
    expect(e1!.unfounded).toBe(true);
    expect(e2!.unfounded).toBe(false);
    expect(e1!.label).toBe('https://example.org');
    expect(e2!.label).toBe('Derived');
    expect(seen).toHaveLength(2);
  });
});

describe('alternativeStanding', () => {
  const analysis = (extra: object = {}) => Analysis.parse({
    id: 'x', subject: { question: 'q' },
    alternatives: ['a', 'b', 'c'].map((id) => ({ id, label: id.toUpperCase() })),
    criteria: [
      { id: 'up', label: 'Up', defaultMeasurement: { level: 'ordinal', preference: 'increasing', range: { min: 1, max: 5 }, levels: [1, 2, 3, 4, 5] } },
      { id: 'down', label: 'Down', defaultMeasurement: { level: 'ratio', preference: 'decreasing', range: { min: 0, max: 100 }, thresholds: { indifference: 5 } } },
      { id: 'kind', label: 'Kind', defaultMeasurement: { level: 'nominal', preference: 'none', levels: ['x', 'y'] } },
    ],
    authors: [{ id: 'u', displayName: 'U', kind: 'human' }],
    cells: Object.entries({ 'a/up': 5, 'b/up': 3, 'c/up': 1, 'a/down': 50, 'b/down': 52, 'c/down': 20, 'a/kind': 'x' })
      .map(([k, value], i) => {
        const [alternativeId, criterionId] = k.split('/');
        return { alternativeId, criterionId, measure: 'score', assertions: [{ id: `s${i}`, authorId: 'u', at: '2026-01-01', value }] };
      }),
    ...extra,
  });

  it('names the strongest and weakest by order comparisons, honouring direction and indifference', () => {
    const s = alternativeStanding(analysis(), 'a', 'score');
    expect(s.strongest.map((x) => x.criterionId)).toEqual(['up']);
    expect(s.weakest.map((x) => x.criterionId)).toEqual(['down']);
    // 50 vs 52 is within the indifference threshold of 5; 50 vs 20 is worse (lower is better).
    expect(s.standings.find((x) => x.criterionId === 'down')).toMatchObject({ better: 0, worse: 1, compared: 2, net: -0.5 });
    expect(s.excluded).toEqual([{ criterionId: 'kind', reason: 'no-direction' }]);
  });

  it('says why a criterion with no value takes no part, and names nothing when all stand alike', () => {
    const s = alternativeStanding(analysis(), 'b', 'score');
    expect(s.strongest.map((x) => x.criterionId)).toEqual(['up']);
    expect(s.weakest.map((x) => x.criterionId)).toEqual(['down']);
    expect(s.excluded).toContainEqual({ criterionId: 'kind', reason: 'no-direction' });
    // One criterion taking part is not a strongest and a weakest.
    const one = analysis();
    one.cells = one.cells.filter((c) => c.criterionId === 'up');
    const alone = alternativeStanding(one, 'a', 'score');
    expect(alone.standings).toHaveLength(1);
    expect(alone.strongest).toEqual([]);
    expect(alone.weakest).toEqual([]);
    const blank = alternativeStanding(analysis({ cells: [] }), 'a', 'score');
    expect(blank.standings).toEqual([]);
    expect(blank.excluded.filter((e) => e.reason === 'no-value').map((e) => e.criterionId)).toEqual(['up', 'down']);
  });

  it('runs over the messy fixture without guessing at blanks', () => {
    for (const alt of relocation.alternatives) {
      const s = alternativeStanding(relocation, alt.id, 'score');
      for (const x of s.standings) expect(x.better + x.worse).toBeLessThanOrEqual(x.compared);
      expect(s.standings.length + s.excluded.length).toBe(relocation.criteria.filter((c) => !c.tombstoned).length);
    }
  });
});
