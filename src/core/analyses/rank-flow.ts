/**
 * Rank-flow (#98, ADR-0026, ADR-0015 "the views that realise these analyses"):
 * the rank positions of one set of alternatives under two or more rankings, and
 * what moved between them. The model a bump / slope chart is drawn from.
 *
 * It connects **ranks, never values**: a slope between two columns is a change
 * of position, and nothing here hands a view a value to draw an angle from,
 * because angle reads as magnitude and our scores are mostly ordinal.
 *
 * - **Ties are kept as ties.** A row's rank is one plus the rows the ranking
 *   separates above it (`separability`, ADR-0015), so rows at the same point,
 *   or rows whose intervals overlap the same rows, share a rank. A row the
 *   available data cannot place exactly carries the lowest rank it could take
 *   as well (`lowest`): an interval that overlaps two others spans three ranks,
 *   and is never tie-broken into one of them.
 * - **A row the coverage gate did not score is unscored, not ranked last.** It
 *   keeps the label the ranking gave it ("not scored -- insufficient coverage")
 *   and takes no position, so it cannot be read as the worst.
 * - **A move is a change of place against the rows ranked in both rankings.**
 *   A row entering or leaving the ranking shifts the numbers below it and is
 *   counted as that, never as the others moving; a row the data stop (or start)
 *   separating from a neighbour, at the same rank, has lost (or gained)
 *   separability, which is said as that and not as a move.
 * - **It ranks the current selection, and refuses above `maxRows`** (ADR-0026
 *   [2]); the refusal says how many there are and what to do.
 * - **Its caption is a stability statement**: unstable only when something
 *   ranked in both changes place; never which row is first. The word for a row
 *   is the analysis's own (`words`), not hard-coded.
 *
 * The rankings are the caller's: a weighted sum's rows under its declared and a
 * changed weighting (`withSubstitutionWeight` in `weighted-sum.ts`,
 * `firstOrderChange` in `sensitivity.ts`), or two raters' (`rater-ranking.ts`).
 * This module imports no aggregation, only the separability rule.
 *
 * No DOM: the panel in `view/rank-flow.tsx` draws this, and a test reads it.
 */
import { separability, type Separable } from './weighted-sum.js';

/** ADR-0026: bump charts are reported unsuitable much past thirty ranked rows [2]. */
export const RANK_FLOW_MAX_ROWS = 30;

/** One row of one ranking: a point, an interval the data allows, or not scored, with why. */
export type Rankable = (Exclude<Separable, { status: 'not-scored' }> | { status: 'not-scored'; label: string }) & { alternativeId: string };

/** One ranking: its label (a column heading) and its rows. A `WeightedSumResult`'s rows are one. */
export interface RankScenario {
  id: string;
  label: string;
  rows: readonly Rankable[];
}

/** Where one alternative stands in one ranking. */
export type RankPlace =
  | {
    alternativeId: string;
    status: 'ranked';
    /** One plus the rows separated above it. Rows that tie share it. */
    rank: number;
    /** The lowest rank the data allows it: `rank` unless its interval overlaps rows below it. */
    lowest: number;
    /** The other rows at the same rank, in the selection's order: a tie, kept. */
    sharedWith: string[];
    /**
     * Whether the data settle this rank: a point score, sharing its rank only
     * with rows at the same point (a tie). False where an interval leaves the
     * order open -- its own, or that of a row it shares a rank with.
     */
    exact: boolean;
  }
  | { alternativeId: string; status: 'unscored'; label: string };

export interface RankColumn {
  id: string;
  label: string;
  /** One per alternative, in the selection's order. */
  places: RankPlace[];
  /** How many of them are ranked. */
  ranked: number;
}

/**
 * What happened to one alternative between two adjacent columns, read against
 * the others ranked in both: it kept its place, rose or fell; or, at the same
 * rank, the data stopped (`unsettled`) or started (`settled`) separating it
 * from a neighbour -- a change of separability, not a move. Or it is ranked in
 * one of the two only, or in neither.
 */
export type RankMove = 'held' | 'rose' | 'fell' | 'unsettled' | 'settled' | 'entered' | 'left' | 'unranked';

/** The moves that are a change of place: drawn dashed, and what makes an order unstable. */
export const PLACE_CHANGES: readonly RankMove[] = Object.freeze(['rose', 'fell']);

/** The moves of a row ranked in both rankings: those a line is drawn for. */
export const RANKED_IN_BOTH: readonly RankMove[] = Object.freeze(['held', 'rose', 'fell', 'unsettled', 'settled']);

export interface RankStep {
  from: string;
  to: string;
  moves: { alternativeId: string; move: RankMove }[];
  /** Pairs separated one way in `from` and the other way in `to`: the rows that pass each other. */
  passed: { first: string; second: string }[];
  /** The stability statement for this step. */
  caption: string;
}

export type RankFlow =
  | {
    usable: true;
    /** The selection, in its order. */
    alternatives: string[];
    columns: RankColumn[];
    /** One per adjacent pair of columns. */
    steps: RankStep[];
    /** Every step's statement, in order. Never names a first, a best or a winner. */
    caption: string;
  }
  | { usable: false; reason: string };

/** The word for a row and for several, from the analysis's aliases. */
export interface RowWords { alternative: string; alternatives: string }

const ROW_WORDS: RowWords = Object.freeze({ alternative: 'alternative', alternatives: 'alternatives' });

export interface RankFlowOptions {
  /** The rows to rank, in order: the current selection. Default: every row of the first ranking. */
  alternativeIds?: readonly string[];
  /** The most rows it will rank. Default `RANK_FLOW_MAX_ROWS`. */
  maxRows?: number;
  /** Default: "alternative" / "alternatives". */
  words?: RowWords;
}

/**
 * Why a selection of `count` rows is too many to rank, or nothing when it is
 * not. Asked before anything is computed, so a refusal costs nothing.
 */
export function tooManyToRank(
  count: number, { maxRows = RANK_FLOW_MAX_ROWS, words = ROW_WORDS }: Pick<RankFlowOptions, 'maxRows' | 'words'> = {},
): string | undefined {
  if (count <= maxRows) return undefined;
  return `A rank-flow ranks at most ${maxRows} ${words.alternatives}, and ${count} are selected: with many ranked rows `
    + 'the lines of a bump chart are reported to become untraceable (ADR-0026). Hide some in the matrix to rank the rest.';
}

/** The rank positions of each ranking, and what moved between each adjacent pair. */
export function rankFlow(scenarios: readonly RankScenario[], options: RankFlowOptions = {}): RankFlow {
  const { maxRows = RANK_FLOW_MAX_ROWS, words = ROW_WORDS } = options;
  if (scenarios.length < 2) return { usable: false, reason: `A rank-flow compares at least two rankings; it was given ${scenarios.length}.` };
  const ids = [...(options.alternativeIds ?? scenarios[0]!.rows.map((r) => r.alternativeId))];
  const tooMany = tooManyToRank(ids.length, { maxRows, words });
  if (tooMany) return { usable: false, reason: tooMany };
  if (ids.length === 0) return { usable: false, reason: `There are no ${words.alternatives} to rank: none is selected.` };

  const rowsOf = scenarios.map((s) => {
    const byId = new Map(s.rows.map((r) => [r.alternativeId, r]));
    return ids.map((id): Rankable => byId.get(id) ?? { alternativeId: id, status: 'not-scored', label: 'not in this ranking' });
  });
  const columns = scenarios.map((s, i) => columnOf(s, rowsOf[i]!));
  const steps = columns.slice(1).map((to, i) => stepOf(columns[i]!, to, rowsOf[i]!, rowsOf[i + 1]!, words));
  return { usable: true, alternatives: ids, columns, steps, caption: steps.map((s) => s.caption).join(' ') };
}

/** Each scored row's rank among `scored` -- one plus the rows separated above it -- and the lowest rank the data allow it. */
function ranksAmong(scored: readonly Rankable[]): Map<string, { rank: number; lowest: number }> {
  return new Map(scored.map((x) => {
    let above = 0;
    let below = 0;
    for (const y of scored) {
      const order = separability(x, y);
      if (order === 'y-higher') above += 1;
      else if (order === 'x-higher') below += 1;
    }
    return [x.alternativeId, { rank: above + 1, lowest: scored.length - below }];
  }));
}

function columnOf(s: RankScenario, rows: readonly Rankable[]): RankColumn {
  const scored = rows.filter((r) => r.status !== 'not-scored');
  const ranks = ranksAmong(scored);
  const places = rows.map((r): RankPlace => {
    if (r.status === 'not-scored') return { alternativeId: r.alternativeId, status: 'unscored', label: r.label };
    const { rank, lowest } = ranks.get(r.alternativeId)!;
    const shared = scored.filter((y) => y.alternativeId !== r.alternativeId && ranks.get(y.alternativeId)!.rank === rank);
    const exact = r.status === 'point' && lowest - rank === shared.length && shared.every((y) => y.status === 'point');
    return { alternativeId: r.alternativeId, status: 'ranked', rank, lowest, sharedWith: shared.map((y) => y.alternativeId), exact };
  });
  return { id: s.id, label: s.label, places, ranked: scored.length };
}

/**
 * What moved from one ranking to the next, and the stability statement for it.
 * Read pair by pair over the rows ranked in both, never from rank numbers: a
 * row changes place only when it and another row are separated one way, then
 * the other (they pass each other). A pair the data stop separating, or start
 * to, changes both rows' rank numbers without either passing the other: that is
 * separability lost (`unsettled`) or gained (`settled`), not a move. A row
 * entering or leaving the ranking shifts the numbers below it, and is counted
 * as that.
 */
function stepOf(from: RankColumn, to: RankColumn, before: readonly Rankable[], after: readonly Rankable[], words: RowWords): RankStep {
  const both = before.map((r, i) => r.status !== 'not-scored' && after[i]!.status !== 'not-scored');
  const was = ranksAmong(before.filter((_, i) => both[i]));
  const now = ranksAmong(after.filter((_, i) => both[i]));
  /** Per row ranked in both: rows it passed upward, passed downward, stopped being separated from, started being separated from. */
  const tally = before.map(() => ({ up: 0, down: 0, lost: 0, gained: 0 }));
  const passed: RankStep['passed'] = [];
  for (let i = 0; i < before.length; i += 1) {
    for (let j = i + 1; j < before.length; j += 1) {
      if (!both[i] || !both[j]) continue;
      const then = separability(before[i]!, before[j]!);
      const later = separability(after[i]!, after[j]!);
      if (then === later) continue;
      if (then !== 'not-separable' && later !== 'not-separable') {
        passed.push({ first: before[i]!.alternativeId, second: before[j]!.alternativeId });
        const iRose = later === 'x-higher';
        tally[i]![iRose ? 'up' : 'down'] += 1;
        tally[j]![iRose ? 'down' : 'up'] += 1;
      } else {
        const side = later === 'not-separable' ? 'lost' : 'gained';
        tally[i]![side] += 1;
        tally[j]![side] += 1;
      }
    }
  }
  const moves = before.map((r, i) => {
    const id = r.alternativeId;
    if (!both[i]) {
      const move: RankMove = r.status !== 'not-scored' ? 'left' : after[i]!.status !== 'not-scored' ? 'entered' : 'unranked';
      return { alternativeId: id, move };
    }
    const { up, down, lost, gained } = tally[i]!;
    // Passed rows both ways: the direction is the one its place among the rows ranked in both went.
    const mid = (x: { rank: number; lowest: number }) => x.rank + x.lowest;
    const move: RankMove = up + down > 0
      ? (up > down || (up === down && mid(now.get(id)!) < mid(was.get(id)!)) ? 'rose' : 'fell')
      : lost > 0 ? 'unsettled' : gained > 0 ? 'settled' : 'held';
    return { alternativeId: id, move };
  });
  const count = (m: RankMove | readonly RankMove[]) => moves.filter((x) => (typeof m === 'string' ? x.move === m : m.includes(x.move))).length;
  const changed = count(PLACE_CHANGES);
  const crossed = count(['entered', 'left']);
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const rows = (k: number) => n(k, words.alternative, words.alternatives);
  const their = (k: number) => (k === 1 ? 'its' : 'their');
  const extras = [
    count('unsettled') > 0 && `the data no longer separate ${rows(count('unsettled'))} from ${their(count('unsettled'))} neighbours`,
    count('settled') > 0 && `the data now separate ${rows(count('settled'))} from ${their(count('settled'))} neighbours`,
    crossed > 0 && `${rows(crossed)} ${crossed === 1 ? 'is' : 'are'} ranked in one of them only`,
  ].filter((x): x is string => typeof x === 'string');
  const head = `From "${from.label}" to "${to.label}"`;
  const inBoth = both.filter(Boolean).length;
  let caption: string;
  if (inBoth === 0 && crossed === 0) {
    caption = `${head}, no ${words.alternative} is ranked in either, so there is no order to compare.`;
  } else if (changed > 0) {
    const moved = `${changed} of the ${rows(inBoth)} ranked in both ${changed === 1 ? 'changes' : 'change'} place`
      + `${passed.length > 0 ? ` and ${n(passed.length, 'pair passes', 'pairs pass')} each other` : ''}`;
    caption = `${head}, ${[moved, ...extras].join('; ')}: the order is not stable across these two rankings.`;
  } else if (inBoth === 0) {
    caption = `${head}, no ${words.alternative} is ranked in both; ${extras.join('; ')}.`;
  } else if (extras.length === 0) {
    caption = `${head}, every one of the ${rows(inBoth)} ranked in both keeps its place: the order holds across these two rankings.`;
  } else {
    caption = `${head}, the order of the ${rows(inBoth)} ranked in both holds; ${extras.join('; ')}.`;
  }
  return { from: from.id, to: to.id, moves, passed, caption };
}
