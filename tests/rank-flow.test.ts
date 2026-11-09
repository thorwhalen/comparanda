/**
 * Rank-flow's model (#98, ADR-0026): ranks, never values; ties kept as ties;
 * rows the coverage gate did not score shown as unscored, never ranked; only
 * the selection ranked, and refused above thirty; a caption that is a stability
 * statement and never names a winner -- and a view module that cannot rank
 * anything unless the weighted aggregation is handed to it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Analysis } from '../src/core/schema/analysis.js';
import { weightedSum } from '../src/core/analyses/weighted-sum.js';
import { sensitivity } from '../src/core/analyses/sensitivity.js';
import {
  firstOrderChange, rankFlow, raterCriteria, raterRanking, RANK_FLOW_MAX_ROWS, tooManyToRank, withSubstitutionWeight,
  type Rankable, type RankFlow, type RankScenario,
} from '../src/core/analyses/rank-flow.js';
import relocationJson from '../examples/relocation.json';
import { blindRound, NOW_OPEN } from './fixtures/blind-round.js';
import { weighted } from './support/weighted.js';

const here = dirname(fileURLToPath(import.meta.url));
const relocation = Analysis.parse(relocationJson);

const point = (alternativeId: string, value: number): Rankable => ({ alternativeId, status: 'point', value });
const span = (alternativeId: string, lo: number, hi: number): Rankable => ({ alternativeId, status: 'interval', interval: [lo, hi] });
const unscored = (alternativeId: string): Rankable => ({ alternativeId, status: 'not-scored', label: 'not scored -- insufficient coverage' });
const scenario = (id: string, rows: Rankable[]): RankScenario => ({ id, label: id, rows });

const usable = (m: RankFlow) => {
  if (!m.usable) throw new Error(`refused: ${m.reason}`);
  return m;
};
const placeOf = (m: RankFlow, column: number, id: string) => usable(m).columns[column]!.places.find((p) => p.alternativeId === id)!;
const moveOf = (m: RankFlow, id: string) => usable(m).steps[0]!.moves.find((x) => x.alternativeId === id)!.move;

/** The words a stability caption must never use: it is not a recommendation (ADR-0026). */
const ENDORSEMENT = /\b(best|winner|wins|top|recommend\w*|choose|first place)\b/i;

describe('ranks, never values', () => {
  it('carries rank positions and no score, so a view has no value to draw a slope from', () => {
    const m = usable(rankFlow([scenario('a', [point('x', 0.9), point('y', 0.4)]), scenario('b', [point('x', 0.2), point('y', 0.7)])]));
    expect(placeOf(m, 0, 'x')).toMatchObject({ status: 'ranked', rank: 1, lowest: 1, exact: true });
    expect(placeOf(m, 1, 'x')).toMatchObject({ status: 'ranked', rank: 2 });
    expect(JSON.stringify(m.columns)).not.toMatch(/"value"|"interval"|0\.9|0\.4/);
  });
});

describe('ties are kept as ties', () => {
  it('rows at the same point share a rank, and the next row takes the rank after them', () => {
    const m = rankFlow([scenario('a', [point('x', 0.5), point('y', 0.5), point('z', 0.1)]), scenario('b', [point('x', 0.5), point('y', 0.5), point('z', 0.1)])]);
    expect(placeOf(m, 0, 'x')).toMatchObject({ rank: 1, lowest: 2, sharedWith: ['y'], exact: true });
    expect(placeOf(m, 0, 'y')).toMatchObject({ rank: 1, sharedWith: ['x'], exact: true });
    expect(placeOf(m, 0, 'z')).toMatchObject({ rank: 3, lowest: 3, sharedWith: [] });
    expect(moveOf(m, 'x')).toBe('held');
  });

  it('rows the data cannot separate share a rank and are never tie-broken, and say they are not settled', () => {
    // y and z overlap each other; x is above both.
    const m = rankFlow([scenario('a', [point('x', 0.9), span('y', 0.3, 0.6), span('z', 0.5, 0.7)]), scenario('b', [point('x', 0.9), span('y', 0.3, 0.6), span('z', 0.5, 0.7)])]);
    expect(placeOf(m, 0, 'y')).toMatchObject({ rank: 2, lowest: 3, sharedWith: ['z'], exact: false });
    expect(placeOf(m, 0, 'z')).toMatchObject({ rank: 2, lowest: 3, sharedWith: ['y'], exact: false });
    // A point that an interval overlaps is not settled either.
    const n = rankFlow([scenario('a', [point('x', 0.8), span('y', 0.5, 0.85)]), scenario('b', [point('x', 0.8), span('y', 0.5, 0.85)])]);
    expect(placeOf(n, 0, 'x')).toMatchObject({ rank: 1, lowest: 2, exact: false });
  });
});

describe('rows outside the coverage gate are unscored, not ranked', () => {
  it('takes no position and keeps the label the ranking gave it', () => {
    const m = rankFlow([scenario('a', [point('x', 0.9), unscored('y'), point('z', 0.1)]), scenario('b', [point('x', 0.9), point('y', 0.5), point('z', 0.1)])]);
    expect(placeOf(m, 0, 'y')).toEqual({ alternativeId: 'y', status: 'unscored', label: 'not scored -- insufficient coverage' });
    // z is second of the two ranked, not third behind an unscored row.
    expect(placeOf(m, 0, 'z')).toMatchObject({ rank: 2 });
    expect(usable(m).columns[0]!.ranked).toBe(2);
    expect(moveOf(m, 'y')).toBe('entered');
    expect(usable(m).caption).toMatch(/1 alternative is ranked in one of them only/);
  });

  it('a row a ranking does not carry is unscored there, with why', () => {
    const m = rankFlow([scenario('a', [point('x', 1), point('y', 0)]), scenario('b', [point('x', 1)])]);
    expect(placeOf(m, 1, 'y')).toMatchObject({ status: 'unscored', label: 'not in this ranking' });
  });
});

describe('it ranks the current selection, and refuses above thirty', () => {
  it('ranks only the alternatives selected, in the selection\'s order', () => {
    const m = usable(rankFlow(
      [scenario('a', [point('x', 0.9), point('y', 0.5), point('z', 0.1)]), scenario('b', [point('x', 0.9), point('y', 0.5), point('z', 0.1)])],
      { alternativeIds: ['z', 'x'] },
    ));
    expect(m.alternatives).toEqual(['z', 'x']);
    expect(placeOf(m, 0, 'z')).toMatchObject({ rank: 2 });
    expect(m.columns[0]!.places.map((p) => p.alternativeId)).toEqual(['z', 'x']);
  });

  it('refuses a selection above the limit with the count and the reason, and honours a caller\'s own limit', () => {
    const rows = Array.from({ length: RANK_FLOW_MAX_ROWS + 1 }, (_, i) => point(`a${i}`, i));
    const m = rankFlow([scenario('a', rows), scenario('b', rows)]);
    expect(m.usable).toBe(false);
    expect(!m.usable && m.reason).toMatch(/at most 30 alternatives, and 31 are selected.*ADR-0026.*Hide some/);
    expect(usable(rankFlow([scenario('a', rows), scenario('b', rows)], { maxRows: 40 })).columns[0]!.ranked).toBe(31);
    expect(tooManyToRank(30)).toBeUndefined();
    expect(tooManyToRank(3, { maxRows: 2, words: { alternative: 'city', alternatives: 'cities' } })).toMatch(/at most 2 cities, and 3/);
  });

  it('needs two rankings to compare', () => {
    expect(rankFlow([scenario('a', [point('x', 1)])])).toEqual({ usable: false, reason: expect.stringMatching(/at least two rankings/) });
  });
});

describe('the caption is a stability statement, never a winner', () => {
  it('says how many change place and which pass each other', () => {
    const m = usable(rankFlow([scenario('As declared', [point('x', 0.9), point('y', 0.5), point('z', 0.1)]), scenario('Changed', [point('x', 0.4), point('y', 0.5), point('z', 0.1)])]));
    expect(m.steps[0]!.passed).toEqual([{ first: 'x', second: 'y' }]);
    expect([moveOf(m, 'x'), moveOf(m, 'y'), moveOf(m, 'z')]).toEqual(['fell', 'rose', 'held']);
    expect(m.caption).toBe('From "As declared" to "Changed", 2 of the 3 alternatives ranked in both change place and 1 pair passes each other: the order is not stable across these two rankings.');
  });

  it('says the order holds when nothing moves, in the analysis\'s own word for a row', () => {
    const rows = [point('x', 0.9), point('y', 0.5)];
    const m = usable(rankFlow([scenario('a', rows), scenario('b', rows)], { words: { alternative: 'city', alternatives: 'cities' } }));
    expect(m.caption).toBe('From "a" to "b", every one of the 2 cities ranked in both keeps its place: the order holds across these two rankings.');
  });

  it('a row entering above others shifts their numbers, and is said as its own count, not as the others moving', () => {
    const m = usable(rankFlow([scenario('a', [unscored('w'), point('x', 0.5), point('y', 0.2)]), scenario('b', [point('w', 0.9), point('x', 0.5), point('y', 0.2)])]));
    expect([placeOf(m, 0, 'x'), placeOf(m, 1, 'x')]).toMatchObject([{ rank: 1 }, { rank: 2 }]);
    expect([moveOf(m, 'w'), moveOf(m, 'x'), moveOf(m, 'y')]).toEqual(['entered', 'held', 'held']);
    expect(m.caption).toBe('From "a" to "b", 0 of the 2 alternatives ranked in both change place; 1 alternative is ranked in one of them only: the order is not stable across these two rankings.');
  });

  it('never names a best, a top or a winner, whatever moved', () => {
    const shapes: Rankable[][] = [
      [point('x', 1), point('y', 0)], [point('x', 0), point('y', 1)], [point('x', 0.5), point('y', 0.5)],
      [span('x', 0, 1), point('y', 0.5)], [unscored('x'), point('y', 1)], [unscored('x'), unscored('y')],
    ];
    for (const a of shapes) for (const b of shapes) {
      const m = rankFlow([scenario('a', a), scenario('b', b)]);
      expect(m.usable && m.caption, JSON.stringify([a, b])).not.toMatch(ENDORSEMENT);
    }
  });
});

describe('a changed weighting, from the weighted sum and its sensitivity', () => {
  const a = weighted(relocation);
  const opts = { measure: 'score' } as const;

  it('opens just past the first change sensitivity reports, where the order does change', () => {
    const s = sensitivity(a, opts);
    const change = firstOrderChange(s)!;
    expect(change.criterionId).toBe(s.weightPerturbation.smallest!.criterionId);
    const declared = weightedSum(a, opts);
    const past = weightedSum(withSubstitutionWeight(a, change.criterionId, change.weight), opts);
    const m = usable(rankFlow([{ id: 'd', label: 'As declared', rows: declared.rows }, { id: 'c', label: 'Changed', rows: past.rows }]));
    expect(m.caption).toMatch(/not stable/);
    // Short of the margin, nothing moves: the change shown is the first one there is.
    const short = (s.weightPerturbation.smallest!.at + s.weightPerturbation.criteria.find((c) => c.criterionId === change.criterionId)!.weight) / 2;
    const before = weightedSum(withSubstitutionWeight(a, change.criterionId, short), opts);
    expect(usable(rankFlow([{ id: 'd', label: 'As declared', rows: declared.rows }, { id: 'c', label: 'Short', rows: before.rows }])).caption).toMatch(/holds/);
  });

  it('for a named criterion, uses its own nearest change; where it has none, the fragile share', () => {
    const s = sensitivity(a, opts);
    for (const c of s.weightPerturbation.criteria) {
      const change = firstOrderChange(s, { criterionId: c.criterionId })!;
      expect(change.criterionId).toBe(c.criterionId);
      if (!c.nearest) expect(change.weight).toBeCloseTo(c.weight + s.weightPerturbation.fragileBelow * s.weightPerturbation.totalWeight);
      else expect(Math.sign(change.weight - c.nearest.at)).toBe(c.nearest.direction === 'up' ? 1 : -1);
    }
    expect(firstOrderChange(s, { criterionId: 'climate-type' })).toBeUndefined();
    expect(firstOrderChange(sensitivity(relocation, opts))).toBeUndefined();
  });

  it('never opens on a weighting that leaves nothing to rank: one weighted criterion opens on the fragile share', () => {
    const only = { ...a, criteria: a.criteria.map((c) => (c.id === 'rent' ? c : { ...c, weights: {} })) };
    const s = sensitivity(only, opts);
    // Its only order change is the weight going to nothing, which the weighted sum would refuse.
    expect(s.weightPerturbation.smallest).toMatchObject({ criterionId: 'rent', direction: 'down', at: 0 });
    expect(firstOrderChange(s)).toEqual({ criterionId: 'rent', weight: 2 + 0.05 * 2, opening: 'fragile-share' });
    expect(firstOrderChange(sensitivity(a, opts))!.opening).toBe('first-change');
  });

  it('withSubstitutionWeight changes one weight and nothing else', () => {
    const b = withSubstitutionWeight(a, 'rent', 7);
    expect(b.criteria.find((c) => c.id === 'rent')!.weights!.substitution).toBe(7);
    expect(a.criteria.find((c) => c.id === 'rent')!.weights!.substitution).toBe(2);
    expect(b.criteria.filter((c) => c.id !== 'rent')).toEqual(a.criteria.filter((c) => c.id !== 'rent'));
  });
});

describe('rater versus rater, the same model', () => {
  it('ranks one rater\'s own ratings by the criterion\'s direction, and leaves what they did not rate unscored', () => {
    const r = raterRanking(relocation, 'rent', 'ana', { measure: 'score' });
    if (typeof r === 'string') throw new Error(r);
    const m = usable(rankFlow([r, r]));
    // Rent is decreasing: the cheapest is ranked 1.
    expect(placeOf(m, 0, 'taipei')).toMatchObject({ rank: 1 });
    expect(placeOf(m, 0, 'lisbon')).toMatchObject({ rank: 4 });
    expect(placeOf(m, 0, 'seoul')).toMatchObject({ status: 'unscored', label: 'not rated by this rater' });
  });

  it('offers only criteria with an order and two raters, and refuses a criterion with no order', () => {
    const offered = raterCriteria(relocation, { measure: 'score' }).map((c) => c.criterionId);
    expect(offered).not.toContain('climate-type');
    expect(offered).toContain('rent');
    expect(raterRanking(relocation, 'climate-type', 'ana', { measure: 'score' })).toMatch(/no better-worse order/);
  });

  it('never ranks a rater an open anonymous round hides from this viewer', () => {
    const blind = blindRound();
    expect(raterCriteria(blind, { measure: 'score' })[0]!.raters).toEqual(['ana', 'ben', 'scorer']);
    const open = raterCriteria(blind, { measure: 'score', viewer: { now: NOW_OPEN } });
    expect(open).toEqual([]);
    expect(raterRanking(blind, 'rent', 'ben', { measure: 'score', viewer: { now: NOW_OPEN } })).toMatch(/not all ones you may see against their name/);
  });
});

describe('the panel is unreachable unless weighted aggregation is opted into', () => {
  it('the view module imports neither opt-in analysis as a value: it ranks only what the composition root hands it', () => {
    const source = readFileSync(join(here, '../src/view/rank-flow.tsx'), 'utf8');
    const imports = [...source.matchAll(/^import\s+(type\s+)?[^;]*?from\s+'([^']+)'/gms)];
    const fromAggregation = imports.filter(([, , from]) => /analyses\/(weighted-sum|sensitivity)\.js$/.test(from!));
    expect(fromAggregation.length).toBe(2);
    for (const [text, typeOnly] of fromAggregation) expect(typeOnly, text).toBe('type ');
    // Nor does the core model it draws: it imports the separability rule and nothing that aggregates.
    const core = readFileSync(join(here, '../src/core/analyses/rank-flow.ts'), 'utf8');
    expect(core).toMatch(/import \{ separability \} from '\.\/weighted-sum\.js'/);
    expect(core).toMatch(/import type \{ SensitivityResult \} from '\.\/sensitivity\.js'/);
  });
});
