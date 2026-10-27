/**
 * The two-criterion scatter's model (#97, ADR-0026): two chosen criteria, each
 * alternative's value on both, and its dominance tier twice -- on these two
 * criteria, and across every criterion that admits the comparison.
 *
 * The 2-D frontier is not the frontier. ADR-0026 asks that the view say so,
 * because this is the view most likely to be screenshotted out of context:
 * `caption` is the words the view puts on it, and every point carries its
 * full-criteria tier as a second channel beside its tier here.
 *
 * Tiers are ADR-0019's three: `non-dominated` (not even possibly dominated),
 * `possibly-dominated` (it depends on how the blanks resolve) and `dominated`
 * (necessarily: worse however they resolve). They come from `dominance`, run
 * once over the two criteria and once over all of them; nothing here compares
 * values itself.
 *
 * No DOM. A point is placed only where both of its values are numbers; one
 * that is not is listed, with the tiers it still has and why each value is
 * absent (ADR-0009: no bare nulls), so it never vanishes.
 */
import type { Analysis } from '../schema/analysis.js';
import { makeCellReader, vocabularyOf } from '../schema/analysis.js';
import { makeInapplicability } from '../schema/groups.js';
import { NOT_APPLICABLE, NOT_ASSESSED } from '../schema/missingness.js';
import { measurementFor } from '../schema/structure.js';
import { dominance, EXCLUSION_WORDS, type DominanceResult, type ExcludedCriterion } from './dominance.js';

export type DominanceTier = 'non-dominated' | 'possibly-dominated' | 'dominated';

/** One of the two criteria, as the scatter reads it. */
export interface ScatterAxis {
  criterionId: string;
  label: string;
  /** The declared range, when there is one: the axis's extent. */
  range: { min: number; max: number } | undefined;
  preference: string | undefined;
}

/** One alternative on the scatter. */
export interface ScatterPoint {
  alternativeId: string;
  label: string;
  /** Its value on each axis, when that value is a number; otherwise it is listed, not placed. */
  x: number | undefined;
  y: number | undefined;
  /** Why there is no number on an axis, in words, when there is none: the reason's meaning, a refusal, a withholding. */
  xAbsent: string | undefined;
  yAbsent: string | undefined;
  /** Its tier on these two criteria. */
  here: DominanceTier;
  /** Its tier across every criterion that admits a dominance comparison. */
  overall: DominanceTier;
  /** Who necessarily dominates it on these two criteria. */
  dominatedBy: string[];
}

/** A scatter that can be drawn. */
export interface UsableScatterModel {
  usable: true;
  measure: string;
  axes: readonly [ScatterAxis, ScatterAxis];
  points: ScatterPoint[];
  /** What the view must call the front it draws: on these two criteria, not overall. */
  caption: string;
  /** The full-criteria comparison's basis, in words (ADR-0019: a result that does not name its basis is not interpretable). */
  overallBasis: string;
  /** What the comparison on the two criteria says of itself: what was withheld, excluded, compared over a range. */
  notes: string[];
  /** The same, of the comparison across every criterion, which the second mark comes from (ADR-0019 clause 9). */
  overallNotes: string[];
}

export type ScatterModel = UsableScatterModel | {
  usable: false;
  /** Why there is no scatter for this pair, in words. */
  reason: string;
};

export interface ScatterOptions {
  measure: string;
  /** The two criteria: horizontal, then vertical. */
  criteria: readonly [string, string];
  usePracticalTolerance?: boolean;
}

/** The words the view puts on the front it draws (ADR-0026). */
export const SCATTER_CAPTION = 'non-dominated on these two criteria';

/** The criteria a scatter can be drawn over: those a dominance comparison can use, in document order. */
export function scatterCriteria(a: Analysis, measure: string): string[] {
  return dominance(a, { measure }).basis;
}

/** Which tier `dominance` put an alternative in. */
function tierIn(result: DominanceResult, id: string): DominanceTier {
  if (result.dominated.includes(id)) return 'dominated';
  return result.provisional.includes(id) ? 'possibly-dominated' : 'non-dominated';
}

/**
 * The scatter over two criteria, or why there is none: the same criterion
 * twice, an unknown one, or one that admits no dominance comparison (nominal,
 * no direction, a target, no range), named with its reason.
 */
export function scatterModel(a: Analysis, { measure, criteria, usePracticalTolerance = false }: ScatterOptions): ScatterModel {
  const [xId, yId] = criteria;
  if (xId === yId) return { usable: false, reason: 'a scatter needs two different criteria.' };
  const crit = (id: string) => a.criteria.find((c) => c.id === id && !c.tombstoned);
  const missing = criteria.find((id) => !crit(id));
  if (missing !== undefined) return { usable: false, reason: `"${missing}" is not a criterion of this analysis.` };

  const here = dominance(a, { measure, criterionIds: criteria, usePracticalTolerance });
  const out = here.excluded.find((e: ExcludedCriterion) => criteria.includes(e.criterionId));
  if (out) {
    return { usable: false, reason: `${crit(out.criterionId)!.label} cannot be compared for dominance (${EXCLUSION_WORDS[out.reason]}).` };
  }
  const overall = dominance(a, { measure, usePracticalTolerance });

  const axis = (id: string): ScatterAxis => {
    const c = crit(id)!;
    const m = measurementFor(c, measure);
    return { criterionId: id, label: c.label, range: m?.range && { min: m.range.min, max: m.range.max }, preference: m?.preference };
  };
  const reader = makeCellReader(a, measure);
  const vocabulary = vocabularyOf(a);
  const inapplicable = makeInapplicability(a);
  const numberAt = (alt: string, id: string) => {
    const v = reader.read(alt, id)?.value;
    return typeof v === 'number' ? v : undefined;
  };
  /** Why a cell has no number, read as the matrix reads it: a refusal, a reason's meaning, a declared block, or nobody has looked. */
  const absentAt = (alt: string, id: string): string | undefined => {
    const r = reader.read(alt, id);
    const mean = (code: string) => vocabulary.means(code, id)?.trim() || `absent for a reason this analysis does not describe ("${code}")`;
    if (typeof r?.value === 'number') return undefined;
    if (r?.refused !== undefined) return `not shown: ${r.refused}`;
    if (r?.value !== undefined) return `not a number (${String(r.value)})`;
    if (r?.missing) return mean(r.missing.code);
    return mean(inapplicable(alt, id) ? NOT_APPLICABLE : NOT_ASSESSED);
  };
  const points = a.alternatives.filter((x) => !x.tombstoned).map((alt): ScatterPoint => ({
    alternativeId: alt.id,
    label: alt.label,
    x: numberAt(alt.id, xId),
    y: numberAt(alt.id, yId),
    xAbsent: absentAt(alt.id, xId),
    yAbsent: absentAt(alt.id, yId),
    here: tierIn(here, alt.id),
    overall: tierIn(overall, alt.id),
    dominatedBy: here.edges.filter((e) => e.dominated === alt.id).map((e) => e.dominator),
  }));
  return {
    usable: true,
    measure,
    axes: [axis(xId), axis(yId)],
    points,
    caption: SCATTER_CAPTION,
    overallBasis: overall.basisDescription,
    notes: here.notes,
    overallNotes: overall.notes,
  };
}
