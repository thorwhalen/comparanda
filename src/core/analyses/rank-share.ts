/**
 * `rankShare` (#343, ADR-0015 "Rank acceptability is `rankShare`, and it renders inside `RankFlow`"): per
 * alternative and per rank, the share of sampled weight vectors that put it there. The joint answer to the
 * question `sensitivity` answers one weight at a time: is this order stable under a different weighting, all of
 * it at once. (SMAA's own name for the share is the "rank acceptability index" [13, 14]; here `acceptability` is
 * the screening floor and nothing else.)
 *
 * It is the weighted sum's, sampled, and it keeps every rule the weighted sum has:
 *
 * - **Weights are sampled uniformly from the simplex** over the criteria that carry a positive substitution
 *   weight, so every weighting is equally likely: the sample says nothing about which one the author meant. The
 *   declared weights decide only which rows take part.
 * - **A row the coverage gate does not score, at the declared weights, takes no share**, as in `rankFlow`: it is
 *   listed in `unscored` with its label, never ranked last.
 * - **An interval is never given a midpoint.** Under each sampled weighting a row's aggregate is an interval over
 *   every completion of its blanks (the weighted sum's rule). Rows are ordered by `separability`; a row the data
 *   leave open between ranks `rank` and `lowest` spreads its one unit of that sample *evenly* over those ranks
 *   (a stated rule, not a tie-break), and `unsettled` says in what share of samples that happened.
 * - **The coverage floor is applied once, at the declared weights.** Under a sampled weighting a row's coverage
 *   can differ; it is not re-gated per sample.
 * - **The central weight vector** of a row is the mean of the sampled weightings under which it is *settled* first
 *   (no other row can reach it): where in weight space it wins. Absent if there was no such sample.
 *
 * The random number generator and the sample count are seams: `random` replaces the generator, `seed` seeds the
 * default one, so a result reproduces. No DOM; the rank-flow panel draws it.
 */
import type { Analysis } from '../schema/analysis.js';
import { measurementFor } from '../schema/structure.js';
import { makeReadings } from './readings.js';
import type { AnalysisResult } from './registry.js';
import { positionInRange, weightedSum, type WeightedSumOptions, type WeightedSumRefusal } from './weighted-sum.js';

/** Working default: the share's noise at this count is about 0.5 percentage points. */
export const DEFAULT_RANK_SHARE_SAMPLES = 10_000;
/** The default generator's seed, so a result reproduces unless the caller varies it. */
export const DEFAULT_RANK_SHARE_SEED = 1;

export interface RankShareOptions extends WeightedSumOptions {
  /** Weightings to sample. Default `DEFAULT_RANK_SHARE_SAMPLES`. */
  samples?: number;
  /** Seed of the default generator. Default `DEFAULT_RANK_SHARE_SEED`. Ignored when `random` is given. */
  seed?: number;
  /** Uniform draws in [0, 1): replaces the default seeded generator. */
  random?: () => number;
}

export interface RankShareRow {
  alternativeId: string;
  /** `shares[r - 1]` is the share of samples that put it at rank `r`; they sum to 1. */
  shares: number[];
  /** The share of samples in which the data left its rank open between several ranks. */
  unsettled: number;
  /** The mean weighting under which it is settled first, per weighted criterion; absent if none was. */
  centralWeights?: { criterionId: string; weight: number }[];
}

export interface RankShareResult extends AnalysisResult {
  method: 'rank-share';
  /** Set when the weighted sum refused to run. `rows` is then empty. */
  refused?: WeightedSumRefusal;
  samples: number;
  /** Seed of the default generator; absent when the caller gave `random`. */
  seed?: number;
  /** The weighted criteria whose weights were sampled, as declared. */
  basis: { criterionId: string; weight: number }[];
  /** How many rows take part: the ranks there are. */
  ranks: number;
  rows: RankShareRow[];
  /** Rows the coverage gate did not score at the declared weights: no share, and why. */
  unscored: { alternativeId: string; label: string }[];
  warnings: string[];
}

/** A small seeded generator (mulberry32): uniform in [0, 1), reproducible. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One row's reading of each weighted criterion: a position in [0, 1], a blank (anywhere in it), or not applicable. */
type Cell = { kind: 'position'; at: number } | { kind: 'blank' } | { kind: 'structural' };

export function rankShare(a: Analysis, opts: RankShareOptions): RankShareResult {
  const { samples = DEFAULT_RANK_SHARE_SAMPLES, seed = DEFAULT_RANK_SHARE_SEED } = opts;
  if (!Number.isInteger(samples) || samples < 1) throw new RangeError(`rankShare needs a whole number of samples of at least 1; it was given ${samples}.`);
  const random = opts.random ?? seededRandom(seed);
  const declared = weightedSum(a, opts);
  const assumptions: RankShareResult['assumptions'] = [
    `Each of ${samples} weightings is drawn uniformly from all the ways to split the total weight over the weighted criteria, so none is favoured: the declared weights decide only which rows take part.`,
    'Each row is scored as in the weighted sum: positions within declared ranges, an interval over every completion of its blanks. Rows are ordered only where the data separate them.',
    'A row whose rank the data leave open spreads its share evenly over the ranks it could take. That is a stated rule, not a tie-break; the share of samples where it applies is reported.',
    'The coverage floor is applied once, at the declared weights, and not again under each sampled weighting.',
    'Weights are the substitution weights (ADR-0020), never the voting weights.',
  ];
  const base = { method: 'rank-share' as const, samples, ...(opts.random ? {} : { seed }), assumptions, widenedByDisclosure: declared.widenedByDisclosure };
  if (declared.refused) return { ...base, refused: declared.refused, basis: declared.basis, ranks: 0, rows: [], unscored: [], warnings: [] };

  const scored = declared.rows.filter((r) => r.status !== 'not-scored');
  const unscored = declared.rows.flatMap((r) => (r.status === 'not-scored' ? [{ alternativeId: r.alternativeId, label: r.label }] : []));
  const positive = declared.basis.filter((b) => b.weight > 0);
  const read = makeReadings(a, opts.measure);
  const grid: Cell[][] = scored.map((row) => positive.map(({ criterionId }): Cell => {
    const m = measurementFor(a.criteria.find((c) => c.id === criterionId)!, opts.measure)!;
    const r = read(row.alternativeId, criterionId, m);
    if (r.kind === 'structural') return { kind: 'structural' };
    return r.kind === 'value' && r.numeric !== undefined ? { kind: 'position', at: positionInRange(r.numeric, m) } : { kind: 'blank' };
  }));

  const n = scored.length;
  const k = positive.length;
  const counts = scored.map(() => new Array<number>(n).fill(0));
  const unsettled = new Array<number>(n).fill(0);
  const firstSum = scored.map(() => new Array<number>(k).fill(0));
  const firstN = new Array<number>(n).fill(0);
  const lo = new Array<number>(n).fill(0);
  const hi = new Array<number>(n).fill(0);
  const w = new Array<number>(k).fill(0);
  for (let s = 0; s < samples; s += 1) {
    // Uniform on the simplex: normalised unit exponentials (1 - U avoids log 0).
    let total = 0;
    for (let c = 0; c < k; c += 1) { w[c] = -Math.log(1 - random()); total += w[c]!; }
    for (let c = 0; c < k; c += 1) w[c] = w[c]! / total;
    for (let i = 0; i < n; i += 1) {
      let applicable = 0;
      let low = 0;
      let high = 0;
      for (let c = 0; c < k; c += 1) {
        const cell = grid[i]![c]!;
        if (cell.kind === 'structural') continue;
        applicable += w[c]!;
        if (cell.kind === 'position') { low += w[c]! * cell.at; high += w[c]! * cell.at; } else high += w[c]!;
      }
      lo[i] = applicable > 0 ? low / applicable : 0;
      hi[i] = applicable > 0 ? high / applicable : 0;
    }
    for (let i = 0; i < n; i += 1) {
      let above = 0;
      let below = 0;
      for (let j = 0; j < n; j += 1) {
        if (j === i) continue;
        if (lo[j]! > hi[i]!) above += 1;
        else if (lo[i]! > hi[j]!) below += 1;
      }
      const rank = above + 1;
      const lowest = n - below;
      const spread = 1 / (lowest - rank + 1);
      for (let r = rank; r <= lowest; r += 1) counts[i]![r - 1]! += spread;
      if (lowest > rank) unsettled[i]! += 1;
      if (lowest === 1) { firstN[i]! += 1; for (let c = 0; c < k; c += 1) firstSum[i]![c]! += w[c]!; }
    }
  }
  const rows = scored.map((row, i): RankShareRow => ({
    alternativeId: row.alternativeId,
    shares: counts[i]!.map((x) => x / samples),
    unsettled: unsettled[i]! / samples,
    ...(firstN[i]! > 0 ? { centralWeights: positive.map((b, c) => ({ criterionId: b.criterionId, weight: firstSum[i]![c]! / firstN[i]! })) } : {}),
  }));
  return { ...base, basis: declared.basis, ranks: n, rows, unscored, warnings: declared.warnings };
}
