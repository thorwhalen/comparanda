/**
 * One rater's ranking of the alternatives on one criterion (#98, ADR-0026: "the
 * slope chart for rater-versus-rater is the same component"): rows for
 * `rankFlow`, from that rater's own ratings, ordered by the criterion's
 * direction of preference. Ranks only, so an ordinal scale is safe here.
 *
 * Redaction is decided here, as for the dot plot (ADR-0023): a rater is offered
 * only where every live rating they made on the criterion is one this viewer may
 * see against their name, because a rater-by-rater ranking of an open anonymous
 * round would undo the round. Absences are said in the matrix's words.
 *
 * No DOM.
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
import type { Rankable, RankScenario } from './rank-flow.js';

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

/** The criteria on which at least two raters can be ranked against each other, and who. */
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
 * where they gave one. A rater who recorded an absence, rated nothing here, or
 * left two live ratings leaves that row unscored, with why. Refused (a string)
 * when the criterion has no order or the rater is not one `raterCriteria` offers.
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
