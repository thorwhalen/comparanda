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
 * Both comparisons share one scope and one tolerance, both named in `basis`
 * (ADR-0019: a result that does not name its basis is not interpretable). The
 * scope is every live alternative, or one alternatives group's members
 * (`groupId`, clause 3's natural scope); the tolerance is strict, or the
 * practical one (`usePracticalTolerance`, clause 8), which counts a difference
 * at or below a criterion's declared indifference threshold as none. Neither is
 * a default: each is the reader's visible act.
 *
 * No DOM. A point is placed only where both of its values are numbers; one
 * that is not is listed, with the tiers it still has and why each value is
 * absent (ADR-0009: no bare nulls), so it never vanishes.
 */
import type { Analysis } from '../schema/analysis.js';
import { makeCellReader, vocabularyOf } from '../schema/analysis.js';
import { makeInapplicability } from '../schema/groups.js';
import { cellWords } from '../cell-words.js';
import { aliasesOf, measurementFor, type Aliases } from '../schema/structure.js';
import { declaredIndifference, type Measurement } from '../schema/measurement.js';
import { dominance, dominanceScope, EXCLUSION_WORDS, type DominanceResult, type ExcludedCriterion } from './dominance.js';

export type DominanceTier = 'non-dominated' | 'possibly-dominated' | 'dominated';

/** One of the two criteria, as the scatter reads it. */
export interface ScatterAxis {
  criterionId: string;
  label: string;
  /** The declared range: the axis's extent. Every criterion a dominance comparison uses has one. */
  range: { min: number; max: number };
  /** The declared range's unit, when it has one: words only, never parsed. */
  unit: string | undefined;
  preference: string | undefined;
  /** The indifference threshold the practical tolerance would apply on it (`declaredIndifference`); `undefined` when none is declared. */
  indifference: number | undefined;
  /** That threshold in words: in levels on an ordinal scale ("1 level"), else in the range's unit ("600 USD/month"). */
  indifferenceWords: string | undefined;
}

/** The alternatives both comparisons ran over. */
export interface ScatterScope {
  /** The alternatives group, when the scope is one; `undefined` for every live alternative. */
  groupId: string | undefined;
  label: string | undefined;
  /** How many alternatives are in it, hidden ones included: the comparison counts them. */
  size: number;
}

/**
 * What the practical tolerance can change: `none` when no compared criterion
 * declares an indifference threshold, `outer-only` when only criteria off the
 * two axes do (only the tier across every criterion can move), `both` otherwise.
 */
export type ToleranceEffect = 'none' | 'outer-only' | 'both';

/** The practical tolerance: whether it was applied, how much it could change, and that in words. */
export interface ScatterTolerance {
  applied: boolean;
  /** Of the criteria the comparison across every criterion compares (its basis, not every criterion), how many declare an indifference threshold. */
  overall: { declared: number; of: number };
  effect: ToleranceEffect;
  /** What the tolerance does here, or why it does nothing, for the control that sets it: one sentence. */
  said: string;
}

/** One alternative on the scatter. */
export interface ScatterPoint {
  alternativeId: string;
  label: string;
  /** Its value on each axis, when that value is a number; otherwise it is listed, not placed. */
  x: number | undefined;
  y: number | undefined;
  /**
   * Each cell in the matrix's own words (`cellWords`): the value, labelled when
   * assertions beside it are withheld, or why there is no number.
   */
  xWords: string;
  yWords: string;
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
  /** The alternatives in scope, in document order. */
  points: ScatterPoint[];
  scope: ScatterScope;
  tolerance: ScatterTolerance;
  /** Which scope and tolerance both comparisons used, in words: one sentence, ending with a full stop. */
  basis: string;
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
  /** Compare only this alternatives group's members, sub-groups' included (ADR-0019 clause 3). Default: every live alternative. */
  groupId?: string | undefined;
  /** Count a difference at or below a criterion's declared indifference threshold as none (ADR-0019 clause 8). Default: strict. */
  usePracticalTolerance?: boolean | undefined;
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

/** "1 option", "3 options": a count in the analysis's own words. */
function counted(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "1 of the 6 criteria compared declares one": how many of the compared criteria declare a threshold, `across` saying compared where. */
function declaredAmong({ declared, of }: ScatterTolerance['overall'], al: Aliases, across = ''): string {
  return `${declared} of the ${counted(of, al.criterion, al.criteria)} compared${across} ${declared === 1 ? 'declares' : 'declare'} one`;
}

/** A threshold in words: levels on an ordinal scale, where the range's unit names the scale ("1-5"), not a quantity; else the unit. */
function thresholdWords(q: number, m: Measurement): string {
  if (m.level === 'ordinal') return `${q} ${q === 1 ? 'level' : 'levels'}`;
  return m.range?.unit === undefined ? String(q) : `${q} ${m.range.unit}`;
}

/** What the tolerance does here, or why nothing, in words: the control's hint, worded for whether it is on. */
function toleranceSaid(al: Aliases, axes: readonly [ScatterAxis, ScatterAxis], t: Omit<ScatterTolerance, 'said'>): string {
  const among = `${counted(t.overall.of, al.criterion, al.criteria)} compared`;
  if (t.effect === 'none') {
    return t.applied
      ? `On, but none of the ${among} declares an indifference threshold, so it changes nothing: the comparison is strict.`
      : `Unavailable: none of the ${among} declares an indifference threshold, so the practical tolerance would change nothing.`;
  }
  if (t.effect === 'outer-only') {
    return `Neither ${axes[0].label} nor ${axes[1].label} declares an indifference threshold, so here the tolerance changes only the tier ` +
      `across every ${al.criterion} (${declaredAmong(t.overall, al)}).`;
  }
  return `Counts a difference at or below a ${al.criterion}'s declared indifference threshold as none; it is not transitive, so any cycle it makes is reported.`;
}

/**
 * The scope and the tolerance, in words: "compared across every alternative
 * (5), strictly: any difference counts." The tolerance names each axis's
 * threshold, or that it declares none and is compared strictly, and how many of
 * the criteria behind the outer mark declare one.
 */
function basisWords(al: Aliases, axes: readonly [ScatterAxis, ScatterAxis], scope: ScatterScope, tolerance: Omit<ScatterTolerance, 'said'>): string {
  const where = scope.groupId === undefined
    ? `compared across every ${al.alternative} (${scope.size})`
    : `compared within the group "${scope.label}": ${counted(scope.size, al.alternative, al.alternatives)}`;
  if (!tolerance.applied) return `${where}, strictly: any difference counts.`;
  const onAxis = (x: ScatterAxis) => `${x.label}: ${x.indifferenceWords ?? 'none declared, so compared strictly'}`;
  return `${where}, with the practical tolerance: a difference at or below a ${al.criterion}'s indifference threshold counts as none ` +
    `(${axes.map(onAxis).join('; ')}; ${declaredAmong(tolerance.overall, al, ` across every ${al.criterion}`)}).`;
}

/**
 * The scatter over two criteria, or why there is none: the same criterion
 * twice, an unknown one, one that admits no dominance comparison (nominal, no
 * direction, a target, no range), named with its reason, or a `groupId` that is
 * not a live alternatives group.
 */
export function scatterModel(a: Analysis, { measure, criteria, groupId, usePracticalTolerance = false }: ScatterOptions): ScatterModel {
  const [xId, yId] = criteria;
  if (xId === yId) return { usable: false, reason: 'a scatter needs two different criteria.' };
  const crit = (id: string) => a.criteria.find((c) => c.id === id && !c.tombstoned);
  const missing = criteria.find((id) => !crit(id));
  if (missing !== undefined) return { usable: false, reason: `"${missing}" is not a criterion of this analysis.` };
  const group = groupId === undefined ? undefined : a.groups.find((g) => g.id === groupId && g.axis === 'alternatives' && !g.tombstoned);
  if (groupId !== undefined && !group) return { usable: false, reason: `"${groupId}" is not a group of ${aliasesOf(a).alternatives} in this analysis.` };

  const scoped = { measure, usePracticalTolerance, ...(groupId === undefined ? {} : { groupId }) };
  const here = dominance(a, { ...scoped, criterionIds: criteria });
  const out = here.excluded.find((e: ExcludedCriterion) => criteria.includes(e.criterionId));
  if (out) {
    return { usable: false, reason: `${crit(out.criterionId)!.label} cannot be compared for dominance (${EXCLUSION_WORDS[out.reason]}).` };
  }
  const overall = dominance(a, scoped);

  // Every id here is a live criterion: the two axes, checked above, and the basis, which dominance draws from the live ones.
  const measurementOf = (id: string) => measurementFor(crit(id)!, measure);
  const axis = (id: string): ScatterAxis => {
    const m = measurementOf(id)!;
    const q = declaredIndifference(m);
    // In the basis, so it has a range and a direction (dominance's own rule, ADR-0019 clause 7).
    return {
      criterionId: id, label: crit(id)!.label, range: { min: m.range!.min, max: m.range!.max }, unit: m.range!.unit,
      preference: m.preference, indifference: q, indifferenceWords: q === undefined ? undefined : thresholdWords(q, m),
    };
  };
  const axes = [axis(xId), axis(yId)] as const;
  const inScope = new Set(dominanceScope(a, scoped));
  const scope: ScatterScope = { groupId, label: group?.label, size: inScope.size };
  const declared = overall.basis.filter((id) => declaredIndifference(measurementOf(id)) !== undefined).length;
  const effect: ToleranceEffect = declared === 0 ? 'none' : axes.every((x) => x.indifference === undefined) ? 'outer-only' : 'both';
  const measured = { applied: usePracticalTolerance, overall: { declared, of: overall.basis.length }, effect };
  const al = aliasesOf(a);
  const tolerance: ScatterTolerance = { ...measured, said: toleranceSaid(al, axes, measured) };
  const reader = makeCellReader(a, measure);
  const vocabulary = vocabularyOf(a);
  const inapplicable = makeInapplicability(a);
  const numberAt = (alt: string, id: string) => {
    const v = reader.read(alt, id)?.value;
    return typeof v === 'number' ? v : undefined;
  };
  /** A cell in the matrix's own words; a value that is not a number says so, as it cannot be placed. */
  const wordsAt = (alt: string, id: string): string => {
    const r = reader.read(alt, id);
    const { text, absentCode, refused } = cellWords(r, { inapplicable: inapplicable(alt, id), vocabulary, criterionId: id });
    return refused || absentCode !== undefined || typeof r?.value === 'number' ? text : `Not a number: ${text}.`;
  };
  const points = a.alternatives.filter((x) => !x.tombstoned && inScope.has(x.id)).map((alt): ScatterPoint => ({
    alternativeId: alt.id,
    label: alt.label,
    x: numberAt(alt.id, xId),
    y: numberAt(alt.id, yId),
    xWords: wordsAt(alt.id, xId),
    yWords: wordsAt(alt.id, yId),
    here: tierIn(here, alt.id),
    overall: tierIn(overall, alt.id),
    dominatedBy: here.edges.filter((e) => e.dominated === alt.id).map((e) => e.dominator),
  }));
  return {
    usable: true,
    measure,
    axes,
    points,
    scope,
    tolerance,
    basis: basisWords(al, axes, scope, tolerance),
    caption: SCATTER_CAPTION,
    overallBasis: overall.basisDescription,
    notes: here.notes,
    overallNotes: overall.notes,
  };
}
