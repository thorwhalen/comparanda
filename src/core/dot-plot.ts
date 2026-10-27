/**
 * The small-multiple dot plot's model (#96, ADR-0026): for one criterion, its
 * own levels as discrete ticks, one dot per rater assertion at its level, and
 * a missing lane keyed by reason code, so an alternative with no value on the
 * criterion is shown in that lane rather than left out of the panel.
 *
 * Three rules ADR-0026 makes part of the decision:
 *
 * - **The ticks are the criterion's levels**, its declared `levels` or the
 *   whole numbers of an ordered range, and nothing between them: equal spacing
 *   along a continuous rule would smuggle in an interval reading. A criterion
 *   with neither (a continuous range, a nominal one without declared levels)
 *   has no dot plot here, and says why.
 * - **One dot per assertion**, so disagreement is a visible gap. Redaction is
 *   decided here, as the rater strip decides it (ADR-0023): a value the round
 *   hides from this viewer, or that a projection withheld, is counted and
 *   never drawn; an assertion whose author is hidden is drawn as a hand of its
 *   own, with no name.
 * - **Absence has a lane** (ADR-0009), keyed by the core reason the code
 *   refines (`coreReasonOf`), so a code an analysis declares is read as its
 *   author meant. A rater who recorded an absence puts a mark in that lane; a
 *   cell nobody asserted on is not-applicable inside a declared block and
 *   not-assessed otherwise. Codes are read through the vocabulary, never by
 *   name.
 *
 * No DOM: the panel in `view/dot-plots.tsx` draws this, and a test reads it.
 */
import type { Analysis } from './schema/analysis.js';
import { cellIndex, cellKey, vocabularyOf } from './schema/analysis.js';
import { makeInapplicability } from './schema/groups.js';
import { CORE_MISSING_CODES, coreReasonOf, NOT_APPLICABLE, NOT_ASSESSED } from './schema/missingness.js';
import { assertionVisibility, type ViewerContext } from './schema/redaction.js';
import { measurementFor } from './schema/structure.js';
import { isWithheldFromReader, liveAssertions, type ScalarValue } from './schema/values.js';
import { stripLevels } from './rater-strip.js';

/** What the missing lane is keyed by: a core reason, or `undeclared` for a code the analysis does not define. */
export type MissingLane = string;

/** One alternative's row in a criterion's dot plot. */
export interface DotPlotRow {
  alternativeId: string;
  label: string;
  /**
   * One per visible assertion on a level, by tick index. `authorId` is the
   * rater's, or `undefined` for a hand the round does not name to this viewer.
   */
  dots: { tick: number; authorId: string | undefined }[];
  /** Values off the levels (a 3.5 on whole levels): counted and said, never placed between ticks. */
  offTicks: number;
  /** Assertions whose value this viewer may not see: counted and said, never drawn. */
  unseen: number;
  /** Its marks in the missing lane: one per recorded absence, or one for a cell nobody asserted on. */
  missing: { lane: MissingLane; means: string; count: number }[];
}

export type DotPlot =
  | {
    usable: true;
    criterionId: string;
    label: string;
    /** The criterion's levels, in order: the only places a dot may sit. */
    ticks: ScalarValue[];
    rows: DotPlotRow[];
    /** The missing lanes with something in them, in the core reasons' order, `undeclared` last: the same order in every panel. */
    lanes: MissingLane[];
  }
  | { usable: false; criterionId: string; label: string; reason: string };

export interface DotPlotOptions {
  measure: string;
  /** Who is looking: what an open round hides (ADR-0023). Without one nothing is hidden. */
  viewer?: ViewerContext | undefined;
  /** The most levels a criterion may have to be drawn as ticks. */
  maxLevels?: number;
}

/** The most levels a dot plot draws as ticks, by default: past that, ticks stop being readable as names. */
export const DOT_PLOT_MAX_LEVELS = 12;

/** A criterion's ticks: its declared levels, whatever its level of measurement, else the whole numbers of an ordered range. */
function ticksFor(a: Analysis, criterionId: string, measure: string, maxLevels: number): ScalarValue[] | string {
  const c = a.criteria.find((x) => x.id === criterionId)!;
  const m = measurementFor(c, measure);
  if (!m) return `${c.label} has no measurement for "${measure}".`;
  if (m.levels && m.levels.length >= 2) {
    return m.levels.length <= maxLevels ? [...m.levels] : `${c.label} has ${m.levels.length} levels, more than ${maxLevels} can be read as ticks.`;
  }
  return stripLevels(m, { maxSlots: maxLevels })
    ?? (m.range
      ? `${c.label} is measured on a continuous range (${m.range.min} to ${m.range.max}), not on levels; a dot plot draws only levels, with nothing between them.`
      : `${c.label} declares no levels to draw.`);
}

/** The dot plot for one criterion, or why it has none. */
export function dotPlot(a: Analysis, criterionId: string, { measure, viewer, maxLevels = DOT_PLOT_MAX_LEVELS }: DotPlotOptions): DotPlot {
  const c = a.criteria.find((x) => x.id === criterionId && !x.tombstoned);
  if (!c) return { usable: false, criterionId, label: criterionId, reason: `"${criterionId}" is not a criterion of this analysis.` };
  const ticks = ticksFor(a, criterionId, measure, maxLevels);
  if (typeof ticks === 'string') return { usable: false, criterionId, label: c.label, reason: ticks };

  const vocabulary = vocabularyOf(a);
  const inapplicable = makeInapplicability(a);
  const cells = cellIndex(a);
  const lanes: MissingLane[] = [];
  const laneOf = (code: string) => {
    const lane = coreReasonOf(vocabulary, code, criterionId) ?? 'undeclared';
    if (!lanes.includes(lane)) lanes.push(lane);
    return { lane, means: vocabulary.means(code, criterionId)?.trim() || `absent for a reason this analysis does not define ("${code}")` };
  };
  const tickOf = (v: ScalarValue) => ticks.findIndex((t) => t === v);

  const rows = a.alternatives.filter((x) => !x.tombstoned).map((alt): DotPlotRow => {
    const row: DotPlotRow = { alternativeId: alt.id, label: alt.label, dots: [], offTicks: 0, unseen: 0, missing: [] };
    const absent = (code: string) => {
      const { lane, means } = laneOf(code);
      const had = row.missing.find((m) => m.lane === lane && m.means === means);
      if (had) had.count += 1;
      else row.missing.push({ lane, means, count: 1 });
    };
    const assertions = liveAssertions(cells.get(cellKey(alt.id, criterionId, measure))?.assertions ?? []);
    for (const s of assertions) {
      const seen = viewer ? assertionVisibility(a, s, viewer) : undefined;
      if (seen?.value === 'hidden' || isWithheldFromReader(s)) { row.unseen += 1; continue; }
      if (s.missing) { absent(s.missing.code); continue; }
      const tick = s.value === undefined ? -1 : tickOf(s.value);
      if (tick < 0) { row.offTicks += 1; continue; }
      row.dots.push({ tick, authorId: seen && !(seen.author && seen.value === 'shown') ? undefined : s.authorId });
    }
    // Nothing asserted, and nothing hidden: the cell's own absence, so the row is never empty.
    if (assertions.length === 0) absent(inapplicable(alt.id, criterionId) ? NOT_APPLICABLE : NOT_ASSESSED);
    return row;
  });
  const order = [...Object.keys(CORE_MISSING_CODES), 'undeclared'];
  return { usable: true, criterionId, label: c.label, ticks, rows, lanes: lanes.sort((x, y) => order.indexOf(x) - order.indexOf(y)) };
}
