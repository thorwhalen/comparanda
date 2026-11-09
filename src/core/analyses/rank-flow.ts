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
 * - **It ranks the current selection, and refuses above `maxRows`.** Bump charts
 *   are reported unreadable much past thirty ranked rows (ADR-0026 [2]), which is
 *   our own boundary; the refusal says how many there are and what to do.
 * - **Its caption is a stability statement.** How many rows change place and how
 *   many pairs pass each other; never which row is first. The word for a row is
 *   the analysis's own (`words`), not hard-coded.
 *
 * Two sources of rankings, one model (ADR-0026: "the slope chart for
 * rater-versus-rater is the same component"): a weighted sum under its declared
 * and a changed weighting (`withSubstitutionWeight`, `firstOrderChange`), and
 * two raters' ratings on one criterion (`raterRanking`). The weighted rows are
 * computed by the caller with the aggregation it opted into; this module
 * imports no aggregation, only the separability rule.
 *
 * No DOM: the panel in `view/rank-flow.tsx` draws this, and a test reads it.
 */
import type { Analysis } from '../schema/analysis.js';
import { cellIndex, cellKey, vocabularyOf } from '../schema/analysis.js';
import { makeInapplicableBlocks } from '../schema/groups.js';
import { isOrdered, type Measurement } from '../schema/measurement.js';
import { NOT_APPLICABLE } from '../schema/missingness.js';
import { sightingOf, type ViewerContext } from '../schema/redaction.js';
import { measurementFor } from '../schema/structure.js';
import { liveAssertions, type ScalarValue } from '../schema/values.js';
import { cellWords } from '../cell-words.js';
import { separability } from './weighted-sum.js';
import type { SensitivityResult } from './sensitivity.js';

/** ADR-0026: bump charts are reported unsuitable much past thirty ranked rows [2]. */
export const RANK_FLOW_MAX_ROWS = 30;

/**
 * How far past a reported order change the changed weighting sits, as a share of
 * the larger of the weights and 1: the probe `sensitivity` itself checks the
 * order with either side of a boundary, so "just past" means the same thing here.
 */
export const PAST_THE_CHANGE = 1e-6;

/** One row of one ranking: a point, an interval the data allows, or not scored, with why. */
export type Rankable =
  | { alternativeId: string; status: 'point'; value: number }
  | { alternativeId: string; status: 'interval'; interval: readonly [number, number] }
  | { alternativeId: string; status: 'not-scored'; label: string };

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
 * What happened to one alternative between two adjacent columns: against the
 * others ranked in both it kept its place, rose or fell; or it is ranked in one
 * of the two only, or in neither.
 */
export type RankMove = 'held' | 'rose' | 'fell' | 'entered' | 'left' | 'unranked';

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
  return `A rank-flow ranks at most ${maxRows} ${words.alternatives}, and ${count} are selected: past about thirty `
    + 'ranked rows the lines are reported to become untraceable (ADR-0026). Hide some in the matrix to rank the rest.';
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
 * What moved from one ranking to the next. A row's move is read against the
 * rows ranked in **both**, not by its rank number: a row the gate admits or drops
 * shifts the numbers below it, and that is said as its own count ("ranked in one
 * of them only"), never as the others moving.
 */
function stepOf(from: RankColumn, to: RankColumn, before: readonly Rankable[], after: readonly Rankable[], words: RowWords): RankStep {
  const both = new Set(before.filter((r, i) => r.status !== 'not-scored' && after[i]!.status !== 'not-scored').map((r) => r.alternativeId));
  const was = ranksAmong(before.filter((r) => both.has(r.alternativeId)));
  const now = ranksAmong(after.filter((r) => both.has(r.alternativeId)));
  const moves = before.map((r, i) => {
    const id = r.alternativeId;
    if (!both.has(id)) {
      const move: RankMove = r.status !== 'not-scored' ? 'left' : after[i]!.status !== 'not-scored' ? 'entered' : 'unranked';
      return { alternativeId: id, move };
    }
    const a = was.get(id)!;
    const b = now.get(id)!;
    const move: RankMove = a.rank !== b.rank ? (b.rank < a.rank ? 'rose' : 'fell')
      : a.lowest !== b.lowest ? (b.lowest < a.lowest ? 'rose' : 'fell') : 'held';
    return { alternativeId: id, move };
  });
  const passed: RankStep['passed'] = [];
  for (let i = 0; i < before.length; i += 1) {
    for (let j = i + 1; j < before.length; j += 1) {
      const then = separability(before[i]!, before[j]!);
      const later = separability(after[i]!, after[j]!);
      if ((then === 'x-higher' && later === 'y-higher') || (then === 'y-higher' && later === 'x-higher')) {
        passed.push({ first: before[i]!.alternativeId, second: before[j]!.alternativeId });
      }
    }
  }
  const inBoth = both.size;
  const changed = moves.filter((m) => m.move === 'rose' || m.move === 'fell').length;
  const crossed = moves.filter((m) => m.move === 'entered' || m.move === 'left').length;
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const head = `From "${from.label}" to "${to.label}"`;
  const rows = (k: number) => n(k, words.alternative, words.alternatives);
  let caption: string;
  if (inBoth === 0 && crossed === 0) {
    caption = `${head}, no ${words.alternative} is ranked in either, so there is no order to compare.`;
  } else if (changed === 0 && crossed === 0) {
    caption = `${head}, every one of the ${rows(inBoth)} ranked in both keeps its place: the order holds across these two rankings.`;
  } else {
    const parts = [
      inBoth > 0 && `${changed} of the ${rows(inBoth)} ranked in both ${changed === 1 ? 'changes' : 'change'} place`
        + `${passed.length > 0 ? ` and ${n(passed.length, 'pair passes', 'pairs pass')} each other` : ''}`,
      crossed > 0 && `${rows(crossed)} ${crossed === 1 ? 'is' : 'are'} ranked in one of them only`,
    ].filter((x): x is string => typeof x === 'string');
    caption = `${head}, ${parts.join('; ')}: the order is not stable across these two rankings.`;
  }
  return { from: from.id, to: to.id, moves, passed, caption };
}

/** The analysis with one criterion's substitution weight set to `weight`: a changed weighting to rank under. */
export function withSubstitutionWeight(a: Analysis, criterionId: string, weight: number): Analysis {
  return {
    ...a,
    criteria: a.criteria.map((c) => (c.id === criterionId ? { ...c, weights: { ...c.weights, substitution: weight } } : c)),
  };
}

/** A changed weighting: one criterion's substitution weight, set to `weight`. */
export interface WeightChange { criterionId: string; weight: number }

/**
 * The changed weighting a rank-flow opens on: just past the smallest movement of
 * one weight that `sensitivity` found changes the order -- of `criterionId`'s
 * weight when one is named, of any weight otherwise -- so the chart shows the
 * first change there is (`opening: 'first-change'`). Where that weight's
 * movement changes nothing, or changes it only by taking every weight to zero
 * (which leaves nothing to rank), it is raised instead by the share
 * `sensitivity` calls fragile, ADR-0015's 5% of the total weight, so the chart
 * shows the order holding where a fragile one would not (`'fragile-share'`).
 * Nothing when the weighted sum refused, or `criterionId` is not in the sum.
 */
export function firstOrderChange(
  s: SensitivityResult, { criterionId, past = PAST_THE_CHANGE }: { criterionId?: string; past?: number } = {},
): (WeightChange & { opening: 'first-change' | 'fragile-share' }) | undefined {
  const { smallest, criteria, fragileBelow, totalWeight } = s.weightPerturbation;
  const c = criteria.find((x) => x.criterionId === (criterionId ?? smallest?.criterionId)) ?? (criterionId === undefined ? criteria[0] : undefined);
  if (!c) return undefined;
  const near = c.nearest;
  const raised = { criterionId: c.criterionId, weight: c.weight + fragileBelow * totalWeight, opening: 'fragile-share' as const };
  if (!near) return raised;
  const step = Math.max(Math.abs(near.at), c.weight, 1) * past;
  const weight = near.direction === 'up' ? near.at + step : Math.max(near.at - step, 0);
  return totalWeight - c.weight + weight > 0 ? { criterionId: c.criterionId, weight, opening: 'first-change' } : raised;
}

// ---- Rater versus rater -------------------------------------------------------------------

export interface RaterRankingOptions {
  measure: string;
  /** Who is looking: an open round may hide whose rating is whose (ADR-0023). */
  viewer?: ViewerContext | undefined;
}

/** A criterion two or more raters can be ranked on, and who. */
export interface RaterCriterion {
  criterionId: string;
  /** Raters whose every rating on it this viewer may see against their name, in the analysis's author order. */
  raters: string[];
  /** Raters with a rating here that is hidden from this viewer, or not shown against them: not offered. */
  notOffered: number;
}

/** Where a value sits on a criterion's better-worse order, or nothing when it has none. Higher is better. */
function orderOf(m: Measurement, v: ScalarValue): number | undefined {
  const sign = m.preference === 'decreasing' ? -1 : 1;
  if (typeof v === 'number') return sign * v;
  const at = m.levels?.findIndex((l) => l === v) ?? -1;
  return at < 0 ? undefined : sign * at;
}

/** Whether a criterion's ratings can be put in a better-worse order at all. */
const rankable = (m: Measurement | undefined): m is Measurement =>
  !!m && isOrdered(m.level) && (m.preference === 'increasing' || m.preference === 'decreasing');

/**
 * The criteria on which at least two raters can be ranked against each other.
 * A rater is offered only where every live rating they made on the criterion is
 * one this viewer may see against their name: a rater-by-rater ranking of an
 * open anonymous round would undo the round.
 */
export function raterCriteria(a: Analysis, { measure, viewer }: RaterRankingOptions): RaterCriterion[] {
  const cells = cellIndex(a);
  const alts = a.alternatives.filter((x) => !x.tombstoned);
  return a.criteria.filter((c) => !c.tombstoned && rankable(measurementFor(c, measure))).flatMap((c): RaterCriterion[] => {
    const seen = new Map<string, boolean>();
    for (const alt of alts) {
      for (const s of liveAssertions(cells.get(cellKey(alt.id, c.id, measure))?.assertions ?? [])) {
        seen.set(s.authorId, (seen.get(s.authorId) ?? true) && sightingOf(a, s, viewer) === 'named');
      }
    }
    const raters = a.authors.filter((au) => seen.get(au.id) === true).map((au) => au.id);
    const notOffered = [...seen.values()].filter((ok) => !ok).length;
    return raters.length >= 2 ? [{ criterionId: c.id, raters, notOffered }] : [];
  });
}

/**
 * One rater's ranking of the alternatives on one criterion: their own rating
 * where they gave one, by the criterion's direction of preference. A rater who
 * recorded an absence, or rated nothing here, leaves that row unscored with why,
 * in the matrix's words. Refused (a string) when the criterion has no order or
 * the rater is not one this viewer may see against their ratings.
 */
export function raterRanking(
  a: Analysis, criterionId: string, authorId: string, { measure, viewer }: RaterRankingOptions,
): RankScenario | string {
  const c = a.criteria.find((x) => x.id === criterionId && !x.tombstoned);
  const m = c ? measurementFor(c, measure) : undefined;
  if (!c || !rankable(m)) return `"${c?.label ?? criterionId}" has no better-worse order to rank ratings by.`;
  if (!raterCriteria(a, { measure, viewer }).some((rc) => rc.criterionId === criterionId && rc.raters.includes(authorId))) {
    return `the ratings of "${authorId}" on "${c.label}" are not all ones you may see against their name, so they are not ranked.`;
  }
  const cells = cellIndex(a);
  const vocabulary = vocabularyOf(a);
  const blockOf = makeInapplicableBlocks(a);
  const said = (code: string) => cellWords({ missing: { code } }, { inapplicable: false, vocabulary, criterionId }).text;
  const rows = a.alternatives.filter((x) => !x.tombstoned).map((alt): Rankable => {
    const own = liveAssertions(cells.get(cellKey(alt.id, criterionId, measure))?.assertions ?? []).filter((s) => s.authorId === authorId);
    const unscored = (label: string): Rankable => ({ alternativeId: alt.id, status: 'not-scored', label });
    if (own.length === 0) {
      const block = blockOf(alt.id, criterionId);
      return unscored(block ? `${said(NOT_APPLICABLE)}${block.reason?.trim() ? ` (${block.reason.trim()})` : ''}` : 'not rated by this rater');
    }
    if (own.length > 1) return unscored('more than one live rating from this rater');
    const s = own[0]!;
    if (s.missing) return unscored(said(s.missing.code));
    const value = s.value === undefined ? undefined : orderOf(m, s.value);
    return value === undefined ? unscored('a rating off the criterion\'s order') : { alternativeId: alt.id, status: 'point', value };
  });
  return { id: `rater:${authorId}`, label: authorId, rows };
}
