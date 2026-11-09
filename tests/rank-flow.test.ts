/**
 * Rank-flow's model (#98, ADR-0026): ranks, never values; ties kept as ties;
 * rows the coverage gate did not score shown as unscored, never ranked; only
 * the selection ranked, and refused above thirty; a caption that is a stability
 * statement and never names a winner -- and a view module that cannot aggregate
 * anything unless the weighted aggregation is handed to it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Analysis } from '../src/core/schema/analysis.js';
import { weightedSum, withSubstitutionWeight } from '../src/core/analyses/weighted-sum.js';
import { firstOrderChange, sensitivity } from '../src/core/analyses/sensitivity.js';
import { rankFlow, RANK_FLOW_MAX_ROWS, tooManyToRank, type Rankable, type RankFlow, type RankScenario } from '../src/core/analyses/rank-flow.js';
import { raterCriteria, raterRanking } from '../src/core/analyses/rater-ranking.js';
import relocationJson from '../examples/relocation.json';
import { blindRound, NOW_OPEN } from './fixtures/blind-round.js';
import { reversal, weighted } from './support/weighted.js';

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
  });

  it('says a caller\'s own limit, and no number it did not set', () => {
    const said = tooManyToRank(13, { maxRows: 12, words: { alternative: 'city', alternatives: 'cities' } })!;
    expect(said).toBe('A rank-flow ranks at most 12 cities, and 13 are selected: with many ranked rows the lines of a bump chart '
      + 'are reported to become untraceable (ADR-0026). Hide some in the matrix to rank the rest.');
    expect(said).not.toMatch(/thirty|30/);
  });

  it('needs two rankings to compare', () => {
    expect(rankFlow([scenario('a', [point('x', 1)])])).toEqual({ usable: false, reason: expect.stringMatching(/at least two rankings/) });
  });
});

describe('what moves, read against the rows ranked in both', () => {
  it('says how many change place and which pass each other, and calls that unstable', () => {
    const m = usable(rankFlow([scenario('As declared', [point('x', 0.9), point('y', 0.5), point('z', 0.1)]), scenario('Changed', [point('x', 0.4), point('y', 0.5), point('z', 0.1)])]));
    expect(m.steps[0]!.passed).toEqual([{ first: 'x', second: 'y' }]);
    expect([moveOf(m, 'x'), moveOf(m, 'y'), moveOf(m, 'z')]).toEqual(['fell', 'rose', 'held']);
    expect(m.caption).toBe('From "As declared" to "Changed", 2 of the 3 alternatives ranked in both change place and 1 pair passes each other: the order is not stable across these two rankings.');
  });

  it('counts pairs of intervals that pass each other, and not pairs that only come to overlap', () => {
    const m = usable(rankFlow([
      scenario('a', [span('x', 0.6, 0.8), point('y', 0.5), span('z', 0.1, 0.2)]),
      scenario('b', [span('x', 0.1, 0.3), point('y', 0.5), span('z', 0.15, 0.25)]),
    ]));
    // x passes y (separated both times, the other way round); x and z go from separated to overlapping, which is no pass.
    expect(m.steps[0]!.passed).toEqual([{ first: 'x', second: 'y' }]);
  });

  it('says the order holds when nothing moves, in the analysis\'s own word for a row', () => {
    const rows = [point('x', 0.9), point('y', 0.5)];
    const m = usable(rankFlow([scenario('a', rows), scenario('b', rows)], { words: { alternative: 'city', alternatives: 'cities' } }));
    expect(m.caption).toBe('From "a" to "b", every one of the 2 cities ranked in both keeps its place: the order holds across these two rankings.');
  });

  it('a row crossing the gate shifts the others\' numbers, is counted as its own, and does not make the order unstable', () => {
    const m = usable(rankFlow([scenario('a', [unscored('w'), point('x', 0.5), point('y', 0.2)]), scenario('b', [point('w', 0.9), point('x', 0.5), point('y', 0.2)])]));
    expect([placeOf(m, 0, 'x'), placeOf(m, 1, 'x')]).toMatchObject([{ rank: 1 }, { rank: 2 }]);
    expect([moveOf(m, 'w'), moveOf(m, 'x'), moveOf(m, 'y')]).toEqual(['entered', 'held', 'held']);
    expect(m.caption).toBe('From "a" to "b", the order of the 2 alternatives ranked in both holds; 1 alternative is ranked in one of them only.');
  });

  it('a row the data stop separating from a neighbour, at the same rank, has lost separability, not moved', () => {
    // x is clearly above y, then x's interval comes to overlap y's: same rank, a lower lowest.
    const m = usable(rankFlow([scenario('a', [point('x', 0.9), point('y', 0.5)]), scenario('b', [span('x', 0.4, 0.9), point('y', 0.5)])]));
    expect([placeOf(m, 0, 'x'), placeOf(m, 1, 'x')]).toMatchObject([{ rank: 1, lowest: 1 }, { rank: 1, lowest: 2 }]);
    expect(moveOf(m, 'x')).toBe('unsettled');
    expect(m.caption).toBe('From "a" to "b", the order of the 2 alternatives ranked in both holds; the data no longer separate 2 alternatives from their neighbours.');
    // And the other way round.
    const back = usable(rankFlow([scenario('b', [span('x', 0.4, 0.9), point('y', 0.5)]), scenario('a', [point('x', 0.9), point('y', 0.5)])]));
    expect(moveOf(back, 'x')).toBe('settled');
    expect(back.caption).toMatch(/holds; the data now separate 2 alternatives from their neighbours\.$/);
  });

  it('says so when no row is ranked in both', () => {
    expect(usable(rankFlow([scenario('a', [unscored('x')]), scenario('b', [point('x', 1)])])).caption)
      .toBe('From "a" to "b", no alternative is ranked in both; 1 alternative is ranked in one of them only.');
    expect(usable(rankFlow([scenario('a', [unscored('x')]), scenario('b', [unscored('x')])])).caption)
      .toBe('From "a" to "b", no alternative is ranked in either, so there is no order to compare.');
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

/** Criteria with measurements and weights; rows of values, one per criterion. */
function doc(weights: number[], rows: Record<string, number[]>) {
  return Analysis.parse({
    id: 's', subject: { question: 'q' }, authors: [{ id: 'a', displayName: 'a', kind: 'human' }],
    alternatives: Object.keys(rows).map((id) => ({ id, label: id })),
    criteria: weights.map((w, j) => ({
      id: `c${j}`, label: `C${j}`, weights: { substitution: w },
      defaultMeasurement: { level: 'ordinal', preference: 'increasing', range: { min: 1, max: 5 }, levels: [1, 2, 3, 4, 5] },
    })),
    cells: Object.entries(rows).flatMap(([alt, vals]) => vals.map((v, j) => ({
      alternativeId: alt, criterionId: `c${j}`, measure: 'score',
      assertions: [{ id: `${alt}${j}`, authorId: 'a', at: '2026-01-01T00:00:00Z', version: 1, evidence: [], value: v, justification: 'j' }],
    }))),
  });
}

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
    // Here the first change is a pair the data stop separating (sensitivity's "stops being ordered"): no row passes another.
    expect(s.weightPerturbation.smallest!.cause).toBe('pair-stops-being-ordered');
    expect(m.caption).toBe('From "As declared" to "Changed", the order of the 3 alternatives ranked in both holds; the data no longer separate 2 alternatives from their neighbours.');
    // Short of the margin, nothing changes at all: the change shown is the first one there is.
    const short = (s.weightPerturbation.smallest!.at + s.weightPerturbation.criteria.find((c) => c.criterionId === change.criterionId)!.weight) / 2;
    const before = weightedSum(withSubstitutionWeight(a, change.criterionId, short), opts);
    expect(usable(rankFlow([{ id: 'd', label: 'As declared', rows: declared.rows }, { id: 'c', label: 'Short', rows: before.rows }])).caption).toMatch(/keeps its place: the order holds/);
  });

  it('where the first change is a pass, just past it the two rows change place, and the order is called unstable', () => {
    const r = reversal();
    const s = sensitivity(r, opts);
    const change = firstOrderChange(s)!;
    const m = usable(rankFlow([
      { id: 'd', label: 'As declared', rows: weightedSum(r, opts).rows },
      { id: 'c', label: 'Changed', rows: weightedSum(withSubstitutionWeight(r, change.criterionId, change.weight), opts).rows },
    ]));
    expect([moveOf(m, 'oak'), moveOf(m, 'pine'), moveOf(m, 'steel')]).toEqual(['fell', 'rose', 'held']);
    expect(m.steps[0]!.passed).toEqual([{ first: 'oak', second: 'pine' }]);
    expect(m.caption).toMatch(/2 of the 3 alternatives ranked in both change place and 1 pair passes each other: the order is not stable/);
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

  it('a change down to nothing is clamped at zero, never a negative weight', () => {
    // x beats y on c0 and ties on c1: the pair stops being ordered only when c0's weight reaches 0.
    const s = sensitivity(doc([1, 1], { x: [5, 3], y: [4, 3] }), opts);
    const c0 = s.weightPerturbation.criteria.find((c) => c.criterionId === 'c0')!;
    expect(c0.nearest).toMatchObject({ direction: 'down', at: 0 });
    expect(firstOrderChange(s, { criterionId: 'c0' })).toEqual({ criterionId: 'c0', weight: 0, opening: 'first-change' });
  });

  it('never opens on a weighting that leaves nothing to rank: one weighted criterion opens on the fragile share', () => {
    const only = { ...a, criteria: a.criteria.map((c) => (c.id === 'rent' ? c : { ...c, weights: {} })) };
    const s = sensitivity(only, opts);
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

/** Two raters on one ordinal criterion, a declared block, and the cells given. */
function rated(cells: { alt: string; author: string; value?: number; missing?: string; id: string; supersededBy?: string }[]) {
  return Analysis.parse({
    id: 'r', subject: { question: 'Which bench?' },
    authors: [{ id: 'ana', displayName: 'Ana', kind: 'human' }, { id: 'ben', displayName: 'Ben', kind: 'human' }],
    alternatives: [{ id: 'x', label: 'X', groupIds: ['g-wood'] }, { id: 'y', label: 'Y', groupIds: ['g-wood'] }, { id: 'z', label: 'Z', groupIds: ['g-steel'] }],
    groups: [{ id: 'g-wood', label: 'Wood', axis: 'alternatives' }, { id: 'g-steel', label: 'Steel', axis: 'alternatives' }, { id: 'g-finish', label: 'Finish', axis: 'criteria' }],
    criteria: [{ id: 'grain', label: 'Grain', groupIds: ['g-finish'], defaultMeasurement: { level: 'ordinal', preference: 'increasing', range: { min: 1, max: 5 }, levels: [1, 2, 3, 4, 5] } }],
    inapplicable: [{ alternativeGroupId: 'g-steel', criterionGroupId: 'g-finish', reason: 'steel has no grain' }],
    cells: ['x', 'y', 'z'].map((alt) => ({
      alternativeId: alt, criterionId: 'grain', measure: 'score',
      assertions: cells.filter((c) => c.alt === alt).map((c) => ({
        id: c.id, authorId: c.author, at: '2026-01-01T00:00:00Z', version: 1, evidence: [],
        ...(c.missing ? { missing: { code: c.missing } } : { value: c.value, justification: 'j' }),
        ...(c.supersededBy ? { supersededBy: c.supersededBy } : {}),
      })),
    })),
  });
}

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

  it('says why a row is unscored: a recorded absence, two live ratings, a declared block', () => {
    const a = rated([
      { alt: 'x', author: 'ana', value: 4, id: 'ax' }, { alt: 'x', author: 'ben', value: 2, id: 'bx' },
      { alt: 'y', author: 'ana', missing: 'not-assessed', id: 'ay' }, { alt: 'y', author: 'ben', value: 3, id: 'by' },
      { alt: 'y', author: 'ben', value: 5, id: 'by2' },
    ]);
    const ana = raterRanking(a, 'grain', 'ana', { measure: 'score' }) as RankScenario;
    const ben = raterRanking(a, 'grain', 'ben', { measure: 'score' }) as RankScenario;
    const label = (s: RankScenario, alt: string) => { const r = s.rows.find((x) => x.alternativeId === alt)!; return r.status === 'not-scored' ? r.label : r.status; };
    expect(label(ana, 'x')).toBe('point');
    // The absence in the matrix's words, never the bare code.
    expect(label(ana, 'y')).not.toBe('not-assessed');
    expect(label(ana, 'y')).toMatch(/\w+ \w+/);
    expect(label(ben, 'y')).toBe('more than one live rating from this rater');
    expect(label(ana, 'z')).toMatch(/\(steel has no grain\)$/);
  });

  it('a superseded rating is not a second live one', () => {
    const a = rated([
      { alt: 'x', author: 'ana', value: 4, id: 'ax' }, { alt: 'x', author: 'ben', value: 2, id: 'bx', supersededBy: 'bx2' },
      { alt: 'x', author: 'ben', value: 3, id: 'bx2' },
    ]);
    const ben = raterRanking(a, 'grain', 'ben', { measure: 'score' }) as RankScenario;
    expect(ben.rows.find((r) => r.alternativeId === 'x')).toEqual({ alternativeId: 'x', status: 'point', value: 3 });
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
  /** Every import of a module, with whether each named binding is type-only. */
  const importsOf = (source: string) => [...source.matchAll(/^import\s+(type\s+)?([\s\S]*?)\s+from\s+'([^']+)'/gm)].map(([, wholeType, clause, from]) => ({
    from: from!, clause: clause!,
    values: wholeType ? [] : (clause!.match(/\{([\s\S]*)\}/)?.[1] ?? '').split(',').map((s) => s.trim()).filter((s) => s && !s.startsWith('type ')).map((s) => s.split(/\s+as\s+/)[0]!),
  }));
  const AGGREGATIONS = ['weightedSum', 'sensitivity'];

  it('the view module never takes either opt-in analysis as a value, from any module, statically or dynamically', () => {
    const source = readFileSync(join(here, '../src/view/rank-flow.tsx'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/\bimport\s*\(/);
    expect(code).not.toMatch(/\brequire\s*\(/);
    const imports = importsOf(source);
    // Nowhere: not from their own modules, not through the analyses barrel or the package root.
    for (const { from, values, clause } of imports) {
      for (const name of AGGREGATIONS) expect(values, `${from}: ${clause}`).not.toContain(name);
      // A namespace import would carry them by another name.
      if (/analyses|\/index\.js$|^\.\.\/index\.js$/.test(from)) expect(clause, from).not.toMatch(/\*\s+as\s+/);
    }
    // The opt-in is only ever read off the argument the composition root handed over.
    expect(code.match(/(?<![.\w])(weightedSum|sensitivity)\(/g) ?? []).toEqual([]);
    expect(code).toMatch(/optIn\.weightedSum\(/);
    expect(code).toMatch(/optIn\.sensitivity\(/);
  });

  it('the detector would catch the ways round it', () => {
    const caught = (src: string) => importsOf(src).some(({ values }) => AGGREGATIONS.some((n) => values.includes(n)));
    expect(caught("import { weightedSum } from '../core/analyses/weighted-sum.js';")).toBe(true);
    expect(caught("import { rankFlow, sensitivity as s } from '../core/analyses/index.js';")).toBe(true);
    expect(caught("import { sensitivity } from '../index.js';")).toBe(true);
    expect(caught("import { firstOrderChange, type sensitivity } from '../core/analyses/sensitivity.js';")).toBe(false);
    expect(caught("import type { weightedSum } from '../core/analyses/weighted-sum.js';")).toBe(false);
  });

  it('the core model imports no aggregation, only the separability rule', () => {
    const core = readFileSync(join(here, '../src/core/analyses/rank-flow.ts'), 'utf8');
    expect(importsOf(core).map((i) => [i.from, i.values])).toEqual([['./weighted-sum.js', ['separability']]]);
  });
});
