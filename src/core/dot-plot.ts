/**
 * The small-multiple dot plot's model (#96, ADR-0026): for one criterion, its
 * own levels as discrete ticks, one dot per rater assertion at its level, and
 * a missing lane keyed by reason code, so an alternative with no value on the
 * criterion is shown in that lane rather than left out of the panel.
 *
 * Three rules ADR-0026 makes part of the decision:
 *
 * - **The ticks are the criterion's levels**, its declared `levels` or the
 *   whole numbers of an ordinal range, and nothing between them: equal spacing
 *   along a continuous rule would smuggle in an interval reading. A criterion
 *   with neither (an interval or ratio range, a nominal one without declared
 *   levels, too many levels) has no dot plot here, and says why.
 * - **One dot per assertion**, so disagreement is a visible gap. Redaction is
 *   decided here, as the rater strip decides it (ADR-0023): a value the round
 *   hides from this viewer, or that a projection withheld, is counted and
 *   never drawn; an assertion whose author is hidden is a hand with no name.
 *   Each level holds the names it may say and a count of the unnamed, never a
 *   list in the raters' order, so position cannot link a hand across cells.
 * - **Absence has a lane** (ADR-0009), keyed by the core reason the code
 *   refines (`coreReasonOf`), so a code an analysis declares is read as its
 *   author meant. A rater who recorded an absence puts a mark in that lane; a
 *   cell nobody asserted on is not-applicable inside a declared block, with the
 *   block's own reason, and not-assessed otherwise. Codes are read through the
 *   vocabulary, never by name.
 *
 * No DOM: the panel in `view/dot-plots.tsx` draws this, and a test reads it.
 */
import type { Analysis } from './schema/analysis.js';
import { cellIndex, cellKey, vocabularyOf } from './schema/analysis.js';
import { makeInapplicableBlocks } from './schema/groups.js';
import { CORE_MISSING_CODES, coreReasonOf, NOT_APPLICABLE, NOT_ASSESSED, type MissingCode } from './schema/missingness.js';
import { sightingOf, type ViewerContext } from './schema/redaction.js';
import { measurementFor, type Criterion } from './schema/structure.js';
import { liveAssertions, type ScalarValue } from './schema/values.js';
import { stripLevels } from './rater-strip.js';
import { cellWords } from './cell-words.js';

/** What the missing lane is keyed by: a core reason, or `undeclared` for a code the analysis does not define. */
export type MissingLane = MissingCode | 'undeclared';

/** One alternative's row in a criterion's dot plot. */
export interface DotPlotRow {
  alternativeId: string;
  label: string;
  /**
   * The dots at each level, one entry per tick: the raters it may name to this
   * viewer, and how many hands it does not name.
   */
  levels: { named: string[]; unnamed: number }[];
  /** Values off the levels (a 3.5 on whole levels): counted and said, never placed between ticks. */
  offTicks: number;
  /** Assertions whose value this viewer may not see: counted and said, never drawn. */
  unseen: number;
  /**
   * Its marks in the missing lane: one per recorded absence, or one for a cell
   * nobody asserted on, with the declared block's reason when it is in one.
   */
  missing: { lane: MissingLane; means: string; count: number; reason?: string }[];
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

/** A criterion's ticks: its declared levels, whatever its level of measurement, else the whole numbers of an ordinal range. */
function ticksFor(c: Criterion, measure: string, maxLevels: number): ScalarValue[] | string {
  const m = measurementFor(c, measure);
  if (!m) return `${c.label} has no measurement for "${measure}".`;
  const many = (n: number) => `${c.label} has ${n} levels, more than ${maxLevels} can be read as ticks.`;
  if (m.levels && m.levels.length >= 2) return m.levels.length <= maxLevels ? [...m.levels] : many(m.levels.length);
  if (!m.range) return `${c.label} declares no levels to draw.`;
  // Whole numbers are levels only on an ordinal scale: on an interval or ratio one, 3.5 is as real as 3.
  if (m.level !== 'ordinal') {
    return `${c.label} is measured on a continuous range (${m.range.min} to ${m.range.max}), not on levels; a dot plot draws only levels, with nothing between them.`;
  }
  const { min, max } = m.range;
  return stripLevels(m, { maxSlots: maxLevels })
    ?? (Number.isInteger(min) && Number.isInteger(max) && max > min
      ? many(max - min + 1)
      : `${c.label}'s range (${min} to ${max}) has no whole-number levels to draw.`);
}

/** Every live criterion's dot plot, or why it has none, in document order: the analysis read once for all of them. */
export function dotPlots(a: Analysis, options: DotPlotOptions): DotPlot[] {
  const context = contextOf(a);
  return a.criteria.filter((c) => !c.tombstoned).map((c) => plotOf(a, c, options, context));
}

/** The dot plot for one criterion, or why it has none. */
export function dotPlot(a: Analysis, criterionId: string, options: DotPlotOptions): DotPlot {
  const c = a.criteria.find((x) => x.id === criterionId && !x.tombstoned);
  if (!c) return { usable: false, criterionId, label: criterionId, reason: `"${criterionId}" is not a criterion of this analysis.` };
  return plotOf(a, c, options, contextOf(a));
}

/** What every criterion's plot reads from the analysis: built once. */
function contextOf(a: Analysis) {
  return { vocabulary: vocabularyOf(a), blockOf: makeInapplicableBlocks(a), cells: cellIndex(a) };
}

/** The lanes in the core reasons' order, `undeclared` last: the same order in every panel. */
const LANE_ORDER: readonly string[] = [...Object.keys(CORE_MISSING_CODES), 'undeclared'];

function plotOf(
  a: Analysis, c: Criterion, { measure, viewer, maxLevels = DOT_PLOT_MAX_LEVELS }: DotPlotOptions, { vocabulary, blockOf, cells }: ReturnType<typeof contextOf>,
): DotPlot {
  const criterionId = c.id;
  const ticks = ticksFor(c, measure, maxLevels);
  if (typeof ticks === 'string') return { usable: false, criterionId, label: c.label, reason: ticks };
  const lanes = new Set<MissingLane>();
  // An absence in the matrix's own words (`cellWords`), so a panel never says a reason otherwise.
  const meansOf = (code: string) => cellWords({ missing: { code } }, { inapplicable: false, vocabulary, criterionId }).text;
  // By value and by type: a "3" is not the level 3.
  const tickOf = (v: ScalarValue) => ticks.findIndex((t) => t === v);

  const rows = a.alternatives.filter((x) => !x.tombstoned).map((alt): DotPlotRow => {
    const row: DotPlotRow = { alternativeId: alt.id, label: alt.label, levels: ticks.map(() => ({ named: [], unnamed: 0 })), offTicks: 0, unseen: 0, missing: [] };
    const absent = (code: string, reason?: string) => {
      const lane = (coreReasonOf(vocabulary, code, criterionId) ?? 'undeclared') as MissingLane;
      const means = meansOf(code);
      lanes.add(lane);
      const had = row.missing.find((m) => m.lane === lane && m.means === means && m.reason === reason);
      if (had) had.count += 1;
      else row.missing.push({ lane, means, count: 1, ...(reason ? { reason } : {}) });
    };
    const assertions = liveAssertions(cells.get(cellKey(alt.id, criterionId, measure))?.assertions ?? []);
    for (const s of assertions) {
      const sighting = sightingOf(a, s, viewer);
      if (sighting === 'unseen') { row.unseen += 1; continue; }
      if (s.missing) { absent(s.missing.code); continue; }
      const tick = s.value === undefined ? -1 : tickOf(s.value);
      if (tick < 0) { row.offTicks += 1; continue; }
      // Named only where the round shows both who and what (ADR-0023); a distribution-only value is a hand with no name.
      if (sighting === 'unnamed') row.levels[tick]!.unnamed += 1;
      else row.levels[tick]!.named.push(s.authorId);
    }
    // Nothing asserted: the cell's own absence, so the row is never empty. A declared block gives its own reason.
    if (assertions.length === 0) {
      const block = blockOf(alt.id, criterionId);
      if (block) absent(NOT_APPLICABLE, block.reason?.trim() || undefined);
      else absent(NOT_ASSESSED);
    }
    return row;
  });
  return { usable: true, criterionId, label: c.label, ticks, rows, lanes: [...lanes].sort((x, y) => LANE_ORDER.indexOf(x) - LANE_ORDER.indexOf(y)) };
}
