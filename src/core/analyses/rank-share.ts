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
 * - **Rows the data tie, or leave open, are not blamed on the weights.** `tied` is the share of samples in which a
 *   row shares its rank with complete rows only (equal scores); `unsettled`, the share in which a blank leaves it
 *   open. The caption's stability statement counts a row as holding when one rank takes at least `holdsAtShare`
 *   of the samples where its rank is settled, and says separately how many rows the data leave open.
 * - **The central weight vector** of a row is the mean of the sampled weightings under which it is *settled* first
 *   (no other row can reach it): where in weight space it wins. Absent if there was no such sample.
 *
 * The random number generator and the sample count are seams: `random` replaces the generator, `seed` seeds the
 * default one, so a result reproduces. No DOM; the rank-flow panel draws it.
 */
import type { Analysis } from '../schema/analysis.js';
import { measurementFor } from '../schema/structure.js';
import { seededRandom } from './seeded-random.js';
import { makePlacements, type Placed } from './readings.js';
import type { RowWords } from './rank-flow.js';
import type { AnalysisResult } from './registry.js';
import { weightedSum, type WeightedSumOptions, type WeightedSumRefusal } from './weighted-sum.js';

/** Working default: the share's noise at this count is about 0.5 percentage points. */
export const DEFAULT_RANK_SHARE_SAMPLES = 10_000;
/** The default generator's seed, so a result reproduces unless the caller varies it. */
export const DEFAULT_RANK_SHARE_SEED = 1;

/** Scores closer than this are one score: a tie is not split by float noise (`sensitivity`'s order comparisons do the same). */
const EPS = 1e-9;
/** A row holds its rank when one rank takes this share of the samples that settle its rank, or more. */
export const DEFAULT_HOLDS_AT_SHARE = 0.9;
const ROW_WORDS: RowWords = Object.freeze({ alternative: 'alternative', alternatives: 'alternatives' });

export interface RankShareOptions extends WeightedSumOptions {
  /** Weightings to sample. Default `DEFAULT_RANK_SHARE_SAMPLES`. */
  samples?: number;
  /** Seed of the default generator. Default `DEFAULT_RANK_SHARE_SEED`. Ignored when `random` is given. */
  seed?: number;
  /** Uniform draws in [0, 1): replaces the default seeded generator. */
  random?: () => number;
  /** The share of settled samples at one rank that makes a row "hold" it, in the caption. Default `DEFAULT_HOLDS_AT_SHARE`. */
  holdsAtShare?: number;
  /** The word for a row and for several, for the caption. Default "alternative" / "alternatives". */
  words?: RowWords;
}

export interface RankShareRow {
  alternativeId: string;
  /** `shares[r - 1]` is the share of samples that put it at rank `r`; they sum to 1. */
  shares: number[];
  /** The share of samples in which a blank left its rank open between several ranks. */
  unsettled: number;
  /** The share of samples in which it shared its rank with complete rows only: equal scores, a tie kept. */
  tied: number;
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
  /** The criteria whose weights were sampled (those with a positive substitution weight), as declared. */
  basis: { criterionId: string; weight: number }[];
  coverageFloor: number;
  rows: RankShareRow[];
  /** Rows the coverage gate did not score at the declared weights: no share, and why. */
  unscored: { alternativeId: string; label: string }[];
  warnings: string[];
  /**
   * The stability statement, and what the data leave open, in words: how many rows keep one rank across the
   * weightings. Never which row is first, so a view cannot recaption it as an endorsement.
   */
  caption: string;
}

export function rankShare(a: Analysis, opts: RankShareOptions): RankShareResult {
  const {
    samples = DEFAULT_RANK_SHARE_SAMPLES, seed = DEFAULT_RANK_SHARE_SEED, holdsAtShare = DEFAULT_HOLDS_AT_SHARE, words = ROW_WORDS,
  } = opts;
  if (!Number.isInteger(samples) || samples < 1) throw new RangeError(`rankShare needs a whole number of samples of at least 1; it was given ${samples}.`);
  if (!Number.isSafeInteger(seed)) throw new RangeError(`rankShare needs a whole-number seed; it was given ${seed}.`);
  const random = opts.random ?? seededRandom(seed);
  const declared = weightedSum(a, opts);
  const said = samples.toLocaleString('en');
  const assumptions: RankShareResult['assumptions'] = [
    `Each of ${said} weightings is drawn uniformly from all the ways to split the total weight over the weighted criteria, so none is favoured: the declared weights decide only which rows take part.`,
    'Each row is scored as in the weighted sum: positions within declared ranges, an interval over every completion of its blanks. Rows are ordered only where the data separate them.',
    'A row whose rank the data leave open spreads its share evenly over the ranks it could take. That is a stated rule, not a tie-break; the share of samples where it applies is reported.',
    'The coverage floor is applied once, at the declared weights, and not again under each sampled weighting.',
    'Weights are the substitution weights (ADR-0020), never the voting weights.',
  ];
  const positive = declared.basis.filter((b) => b.weight > 0);
  const base = {
    method: 'rank-share' as const, samples, ...(opts.random ? {} : { seed }), assumptions, widenedByDisclosure: declared.widenedByDisclosure,
    basis: positive, coverageFloor: declared.coverageFloor,
  };
  if (declared.refused) return { ...base, refused: declared.refused, rows: [], unscored: [], warnings: [], caption: '' };

  const scored = declared.rows.filter((r) => r.status !== 'not-scored');
  const unscored = declared.rows.flatMap((r) => (r.status === 'not-scored' ? [{ alternativeId: r.alternativeId, label: r.label }] : []));
  const place = makePlacements(a, opts.measure);
  const placed: Placed[][] = scored.map((row) => positive.map(({ criterionId }) => place(row.alternativeId, criterionId, measurementFor(a.criteria.find((c) => c.id === criterionId)!, opts.measure)!)));

  const n = scored.length;
  const k = positive.length;
  // One criterion has one weighting (all of it): drawing it again changes nothing, so it is drawn once and counted for all.
  const draws = k === 1 ? 1 : samples;
  const each = samples / draws;
  const counts = scored.map(() => new Array<number>(n).fill(0));
  const settledAt = scored.map(() => new Array<number>(n).fill(0));
  const open = new Array<number>(n).fill(0);
  const tied = new Array<number>(n).fill(0);
  const firstSum = scored.map(() => new Array<number>(k).fill(0));
  const firstN = new Array<number>(n).fill(0);
  const lo = new Array<number>(n).fill(0);
  const hi = new Array<number>(n).fill(0);
  const w = new Array<number>(k).fill(0);
  for (let s = 0; s < draws; s += 1) {
    // Uniform on the simplex: normalised unit exponentials (1 - U avoids log 0).
    let total = 0;
    for (let c = 0; c < k; c += 1) { w[c] = -Math.log(1 - random()); total += w[c]!; }
    if (!(total > 0) || !Number.isFinite(total)) throw new RangeError('rankShare\'s `random` must return numbers in [0, 1).');
    for (let c = 0; c < k; c += 1) w[c] = w[c]! / total;
    for (let i = 0; i < n; i += 1) {
      let applicable = 0;
      let low = 0;
      let high = 0;
      for (let c = 0; c < k; c += 1) {
        const cell = placed[i]![c]!;
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
      let blank = hi[i]! - lo[i]! > EPS;
      for (let j = 0; j < n; j += 1) {
        if (j === i) continue;
        if (lo[j]! > hi[i]! + EPS) above += 1;
        else if (lo[i]! > hi[j]! + EPS) below += 1;
        else if (hi[j]! - lo[j]! > EPS) blank = true;
      }
      const rank = above + 1;
      const lowest = n - below;
      const spread = each / (lowest - rank + 1);
      for (let r = rank; r <= lowest; r += 1) counts[i]![r - 1]! += spread;
      if (lowest > rank) (blank ? open : tied)[i]! += each;
      else settledAt[i]![rank - 1]! += each;
      if (lowest === 1) { firstN[i]! += each; for (let c = 0; c < k; c += 1) firstSum[i]![c]! += w[c]! * each; }
    }
  }
  const rows = scored.map((row, i): RankShareRow => ({
    alternativeId: row.alternativeId,
    shares: counts[i]!.map((x) => x / samples),
    unsettled: open[i]! / samples,
    tied: tied[i]! / samples,
    ...(firstN[i]! > 0 ? { centralWeights: positive.map((b, c) => ({ criterionId: b.criterionId, weight: firstSum[i]![c]! / firstN[i]! })) } : {}),
  }));
  // A row holds when one rank takes `holdsAtShare` of the samples that settle its rank; a row with none cannot be said to hold or not.
  const settled = settledAt.map((at) => at.reduce((x, y) => x + y, 0));
  const judged = settled.filter((t) => t > EPS).length;
  const held = settledAt.filter((at, i) => settled[i]! > EPS && Math.max(...at) / settled[i]! >= holdsAtShare - EPS).length;
  const leftOpen = rows.filter((r) => r.unsettled + r.tied >= 0.5).length;
  return { ...base, rows, unscored, warnings: declared.warnings, caption: captionOf({ said, k, n, judged, held, leftOpen, holdsAtShare, words }) };
}

/** The stability statement: how many rows keep one rank under joint changes of weight, and how many the data leave open. Never a first. */
function captionOf({ said, k, n, judged, held, leftOpen, holdsAtShare, words }: {
  said: string; k: number; n: number; judged: number; held: number; leftOpen: number; holdsAtShare: number; words: RowWords;
}): string {
  if (n === 0) return '';
  const rows = (c: number) => `${c} ${c === 1 ? words.alternative : words.alternatives}`;
  const criteria = `${k} weighted ${k === 1 ? 'criterion' : 'criteria'}`;
  const head = `Across ${said} random weightings of the ${criteria}, `;
  const verb = (c: number) => (c === 1 ? 'keeps' : 'keep');
  const pct = `${Math.round(holdsAtShare * 100)}%`;
  const stable = judged === 0
    ? `the data settle the rank of no ${words.alternative}, so there is no order to call stable.`
    : held === judged
      ? `all ${rows(judged)} whose rank the data settle ${verb(judged)} one rank in at least ${pct} of the weightings that settle it: the order is stable under joint changes of weight.`
      : `${held} of the ${rows(judged)} whose rank the data settle ${verb(held)} one rank in at least ${pct} of the weightings that settle it; the others spread over several: the order is not stable under joint changes of weight.`;
  const open = leftOpen > 0
    ? ` The data leave ${rows(leftOpen)} open (a blank, or a tie) in at least half of the weightings, so for ${leftOpen === 1 ? 'it' : 'them'} the shares rest on the stated spreading rule.`
    : '';
  return `${head}${stable}${open}`;
}
