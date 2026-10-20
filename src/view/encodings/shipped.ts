/**
 * The encodings comparanda ships (ADR-0010 as amended, ADR-0024, ADR-0032):
 * plain named exports, each one a `defineEncoding`, none registered here. A
 * composition root picks the ones it wants and hands them to
 * `createEncodingRegistry`; `SHIPPED_ENCODINGS` is all nine, for a root that
 * wants them all.
 *
 * All nine draw: `text-only`, `value`, `categorical`, `missingness`, `datum`,
 * `uncertainty-suppressed`, `disagreement` (the rater dot strip, #110), and,
 * over the per-cell disagreement index (ADR-0024's `(1 − A) / 2`, #258),
 * `disagreement-spread` and `consensus-suppressed`.
 */
import { pughTally, type PughStanding } from '../../core/analyses/pugh.js';
import { CORE_MISSING_CODES, coreReasonOf, NOT_APPLICABLE, NOT_ASSESSED, type MissingCode } from '../../core/schema/missingness.js';
import { isOrdered, type Measurement } from '../../core/schema/measurement.js';
import { measurementFor } from '../../core/schema/structure.js';
import { stripDisagreement, stripLevels, type RaterStrip } from '../../core/rater-strip.js';
import type { ScalarValue } from '../../core/schema/values.js';
import type { Swatch, SwatchId } from './palette.js';
import { VSUP_PALETTE } from './vsup-palette.js';
import { capitalise } from '../words.js';
import { layerFor, mergeTree, nodeOf, SCORE_LEVELS, vsupSwatchId, type LevelGroup, type MergeTree, type VsupSwatchId } from './vsup.js';
import {
  defineEncoding, type CellMark, type EncodingContext, type EncodingDefinition, type LegendEntry, type PreparedEncoding,
} from './registry.js';

const NO_MARK: CellMark = Object.freeze({});

/** The default, and the one correct for every declared scale (ADR-0032 clause 1). */
export const textOnly = /* @__PURE__ */ defineEncoding({
  id: 'text-only',
  label: 'Text only',
  texture: { channel: 'none', because: 'the value is the cell\'s text, which every mode and every printer keeps.' },
  prepare: () => ({
    mark: () => NO_MARK,
    legend: { title: 'Values as text', entries: [], notes: ['Every cell shows its value, or says why it has none, in words.'] },
  }),
});

const STEPS = ['seq-1', 'seq-2', 'seq-3', 'seq-4', 'seq-5'] as const satisfies readonly SwatchId[];

/**
 * A sequential ramp over the shown measure, read along each criterion's own
 * declared range and preference: the step says how far toward that
 * criterion's best end the value sits. A criterion with no best end (`target`,
 * `ordered`, `none`) or no way to place a value (no range, no levels) is left
 * uncoloured.
 */
export const value = /* @__PURE__ */ defineEncoding({
  id: 'value',
  label: 'Value',
  texture: { channel: 'none', because: 'one measure, already in the text; uncertainty is the suppressed encodings\' to carry.' },
  prepare: (ctx) => {
    const placed = criteriaMeasured(ctx);
    if (![...placed.values()].some((m) => m !== undefined && towardBest(undefined, m) !== null)) {
      return { unavailable: `no criterion places a ${ctx.measure} on a range or a list of levels with a preferred direction.` };
    }
    const counts = new Map<SwatchId, number>();
    const mark = (alt: string, crit: string): CellMark => {
      const m = placed.get(crit);
      const v = ctx.read(alt, crit)?.value;
      const t = m && v !== undefined ? towardBest(v, m) : undefined;
      if (t === undefined || t === null) return NO_MARK;
      const swatch = STEPS[Math.min(STEPS.length - 1, Math.floor(t * STEPS.length))]!;
      counts.set(swatch, (counts.get(swatch) ?? 0) + 1);
      return { swatch };
    };
    for (const alt of ctx.alternatives) for (const crit of ctx.criteria) mark(alt, crit);
    const word = ['Worst fifth', 'Second fifth', 'Middle fifth', 'Fourth fifth', 'Best fifth'];
    return {
      mark,
      legend: {
        title: `${capitalise(ctx.measure)}, toward each criterion's best`,
        entries: STEPS.map((swatch, i) => ({ swatch, label: `${word[i]} of the criterion's range`, count: counts.get(swatch) ?? 0 })),
        notes: [
          'Each column is placed on its own declared range, in its own preferred direction, so the same shade means "as good" in every column, not "the same number".',
          'Criteria with no direction of preference (a target, an order, a category), or nothing to place a value on, are left uncoloured.',
        ],
      },
    };
  },
});

const HUES = ['cat-1', 'cat-2', 'cat-3', 'cat-4', 'cat-5', 'cat-6', 'cat-7', 'cat-8'] as const satisfies readonly SwatchId[];

/**
 * A fixed-order hue per category of a nominal criterion: the declared levels'
 * order, else the values' sorted order. Colours are per column -- the same hue
 * in two columns is two different categories -- and past eight a category is
 * left uncoloured rather than given a hue that repeats.
 */
export const categorical = /* @__PURE__ */ defineEncoding({
  id: 'categorical',
  label: 'Categories',
  texture: { channel: 'none', because: 'the category is the cell\'s text; texture is reserved for uncertainty and absence.' },
  prepare: (ctx) => {
    const nominal = [...criteriaMeasured(ctx)].filter(([, m]) => m?.level === 'nominal');
    if (nominal.length === 0) return { unavailable: `no shown criterion records its ${ctx.measure} as categories (a nominal level).` };
    const order = new Map(nominal.map(([crit, m]) => {
      // Over every alternative, not the shown ones: hiding one must not recolour the rest.
      const seen = ctx.analysis.alternatives.filter((a) => !a.tombstoned)
        .map((a) => ctx.read(a.id, crit)?.value).filter((v): v is ScalarValue => v !== undefined);
      const levels = m?.levels ?? [...new Set(seen)].sort((x, y) => String(x).localeCompare(String(y)));
      return [crit, levels.map(String)] as const;
    }));
    let overflow = false;
    const counts = new Map<SwatchId, number>();
    const mark = (alt: string, crit: string): CellMark => {
      const v = ctx.read(alt, crit)?.value;
      const levels = order.get(crit);
      if (!levels || v === undefined) return NO_MARK;
      const i = levels.indexOf(String(v));
      if (i < 0 || i >= HUES.length) { overflow ||= i >= HUES.length; return NO_MARK; }
      return { swatch: HUES[i]! };
    };
    for (const alt of ctx.alternatives) {
      for (const crit of ctx.criteria) {
        const swatch = mark(alt, crit).swatch as SwatchId | undefined;
        if (swatch) counts.set(swatch, (counts.get(swatch) ?? 0) + 1);
      }
    }
    if (counts.size === 0) {
      return {
        unavailable: overflow
          ? `every shown category is past the ${HUES.length}th hue, which this encoding does not repeat.`
          : 'no shown categorical cell has a value to colour.',
      };
    }
    return {
      mark,
      legend: {
        title: 'Categories, by column',
        entries: HUES.slice(0, Math.max(...[...order.values()].map((l) => Math.min(l.length, HUES.length))))
          .map((swatch, i) => ({ swatch, label: `Category ${i + 1} in its column's order`, count: counts.get(swatch) ?? 0 })),
        notes: [
          'Hues are assigned within each column, in its declared order: the same hue in two columns is two different categories.',
          ...(overflow ? [`A column with more than ${HUES.length} categories leaves the rest uncoloured.`] : []),
          'Columns that are not categorical are left uncoloured.',
        ],
      },
    };
  },
});

/**
 * The matrix coloured by why a cell is empty (ADR-0009), so "what is left to
 * do" is a view rather than a report. Valued cells stay plain; a custom code
 * takes its `broader` core reason's colour and glyph, and keeps its own words.
 */
export const missingness = /* @__PURE__ */ defineEncoding({
  id: 'missingness',
  label: 'Missingness',
  texture: { channel: 'glyph', carries: 'missing-reason' },
  prepare: (ctx) => {
    const counts = new Map<MissingCode, number>();
    const mark = (alt: string, crit: string): CellMark => {
      const reduced = ctx.read(alt, crit);
      if (reduced?.value !== undefined || reduced?.refused !== undefined) return NO_MARK;
      const code = reduced?.missing !== undefined
        ? coreReasonOf(ctx.vocabulary, reduced.missing.code, crit)
        : ctx.inapplicable(alt, crit) ? NOT_APPLICABLE : NOT_ASSESSED;
      if (code === undefined) return NO_MARK;
      counts.set(code, (counts.get(code) ?? 0) + 1);
      return { swatch: `miss-${code}` };
    };
    for (const alt of ctx.alternatives) for (const crit of ctx.criteria) mark(alt, crit);
    const entries: LegendEntry[] = (Object.keys(CORE_MISSING_CODES) as MissingCode[]).map((code) => ({
      swatch: `miss-${code}`,
      label: `${capitalise(code.replace(/-/g, ' '))}: ${CORE_MISSING_CODES[code].means}`,
      count: counts.get(code) ?? 0,
    }));
    return {
      mark,
      legend: {
        title: 'Why cells are empty',
        entries,
        notes: [
          'Cells with a value, a refused reduction, or a reason this build cannot resolve are left plain.',
          'A reason this analysis declares for itself takes the colour of the core reason it refines, and keeps its own words in the cell.',
        ],
      },
    };
  },
});

const STANDING: Record<Exclude<PughStanding, 'not-comparable'>, { swatch: SwatchId; badge: string; word: string }> = {
  better: { swatch: 'datum-better', badge: '+', word: 'better than' },
  same: { swatch: 'datum-same', badge: '=', word: 'the same as' },
  worse: { swatch: 'datum-worse', badge: '−', word: 'worse than' },
};

/**
 * Pugh's better / same / worse against a datum (ADR-0010 clause 1): the first
 * shown alternative, so moving another to the front changes the datum. A
 * mark per cell and four counts in the legend, never a net (ADR-0015 owns the
 * tally; this owns the mark).
 */
export const datum = /* @__PURE__ */ defineEncoding({
  id: 'datum',
  label: 'Against a datum',
  texture: { channel: 'none', because: 'a visible +, = or − beside each value carries the comparison.' },
  prepare: (ctx) => {
    const first = ctx.alternatives[0];
    if (first === undefined) return { unavailable: 'no alternative is shown to be the datum.' };
    const label = ctx.analysis.alternatives.find((a) => a.id === first)?.label ?? first;
    const tally = pughTally(ctx.analysis, {
      measure: ctx.measure, datum: first, alternativeIds: [...ctx.alternatives], criterionIds: [...ctx.criteria],
    });
    const standing = new Map(tally.rows.flatMap((row) => row.criteria.map((c) => [`${row.alternativeId}\u0000${c.criterionId}`, c.standing] as const)));
    const counts = { better: 0, same: 0, worse: 0, 'not-comparable': 0 };
    for (const row of tally.rows) {
      counts.better += row.counts.better; counts.same += row.counts.same;
      counts.worse += row.counts.worse; counts['not-comparable'] += row.counts.notComparable;
    }
    return {
      mark: (alt, crit) => {
        if (alt === first) return { swatch: 'datum-self', badge: 'datum', said: ', the datum' };
        const s = standing.get(`${alt}\u0000${crit}`);
        if (s === undefined) return NO_MARK;
        if (s === 'not-comparable') return { said: `, not comparable with ${label}` };
        const { swatch, badge, word } = STANDING[s];
        return { swatch, badge, said: `, ${word} ${label}` };
      },
      legend: {
        title: `Against ${label}`,
        entries: [
          { swatch: 'datum-self', badge: 'datum', label: `${label}, the datum` },
          ...(['better', 'same', 'worse'] as const).map((s) => ({
            swatch: STANDING[s].swatch, badge: STANDING[s].badge, label: capitalise(`${STANDING[s].word} ${label}`), count: counts[s],
          })),
          { label: `Not comparable with ${label}`, count: counts['not-comparable'] },
        ],
        notes: [
          `${label} is the datum because it is shown first; move another alternative to the front to compare against it.`,
          'Four counts, never a net: a better on one criterion does not cancel a worse on another.',
        ],
      },
    };
  },
});

/** The measure a confidence qualifies its score with, by name: what value suppression and a cell's announcement read. */
export const CONFIDENCE = 'confidence';
/** Confidence recorded on a range rather than as levels is read in this many layers, the hatch's maximum. */
const CONTINUOUS_CONFIDENCE_LAYERS = 3;
const CONTINUOUS_CONFIDENCE_WORDS = ['low', 'medium', 'high'];
/** Declared confidence levels read one layer each, up to the hatch's three densities above the leaves. */
const MAX_CONFIDENCE_LAYERS = 4;

/** One column's trees: how its values and its confidences find their node. */
interface SuppressedColumn {
  readonly tree: MergeTree;
  /** A value's level, 0 the worst, or `undefined` when it is not one of the scale's. */
  readonly level: (v: ScalarValue) => number | undefined;
  /** A confidence's layer, 0 the least confident, or `undefined` when it cannot be placed. */
  readonly layer: (c: ScalarValue) => number | undefined;
  /** The scale's levels in words, worst first, and the confidence layers', least confident first. */
  readonly levelWords: readonly string[];
  /** Whether worst-first is the reverse of the declared order (a decreasing scale), so groups are worded in declared order. */
  readonly reversed: boolean;
  readonly layerWords: readonly string[];
}

/**
 * A scale's levels, worst first, when it is ordered, has a best end, and lists
 * them -- or, with `spanRange`, spans them as the integers of a non-ratio range.
 */
function rankedLevels(m: Measurement | undefined, { spanRange = true } = {}): readonly ScalarValue[] | undefined {
  if (!m || !isOrdered(m.level)) return undefined;
  if (m.preference !== 'increasing' && m.preference !== 'decreasing') return undefined;
  let levels: readonly ScalarValue[] | undefined = m.levels && m.levels.length >= 2 ? m.levels : undefined;
  const r = m.range;
  if (!levels && spanRange && r && Number.isInteger(r.min) && Number.isInteger(r.max) && r.max > r.min && m.level !== 'ratio') {
    levels = Array.from({ length: r.max - r.min + 1 }, (_, i) => r.min + i);
  }
  if (!levels) return undefined;
  return m.preference === 'decreasing' ? [...levels].reverse() : levels;
}

function suppressedColumn(score: Measurement | undefined, confidence: Measurement | undefined): SuppressedColumn | undefined {
  const levels = rankedLevels(score);
  if (!levels || !confidence || !isOrdered(confidence.level)) return undefined;
  if (confidence.preference !== 'increasing' && confidence.preference !== 'decreasing') return undefined;
  const k = levels.length;
  const level = (v: ScalarValue) => { const i = levels.findIndex((l) => l === v); return i < 0 ? undefined : i; };
  // Confidence is read by its declared levels, or else as a range in three layers: a range is
  // never cut into its integers, which would refuse 0.9 on a 0-1 scale.
  const confLevels = rankedLevels(confidence, { spanRange: false });
  const r = confidence.range;
  let m: number;
  let layer: (c: ScalarValue) => number | undefined;
  let layerWords: string[];
  if (confLevels && confLevels.length <= MAX_CONFIDENCE_LAYERS) {
    m = confLevels.length;
    layer = (c) => {
      const i = confLevels.findIndex((l) => l === c);
      return i < 0 ? undefined : layerFor(1 - i / (m - 1), m);
    };
    layerWords = confLevels.map(String);
  } else if (confLevels) {
    // More levels than the hatch can show: read like a range, in three layers.
    m = CONTINUOUS_CONFIDENCE_LAYERS;
    layer = (c) => {
      const i = confLevels.findIndex((l) => l === c);
      return i < 0 ? undefined : layerFor(1 - i / (confLevels.length - 1), m);
    };
    layerWords = CONTINUOUS_CONFIDENCE_WORDS;
  } else if (r && r.max > r.min) {
    m = CONTINUOUS_CONFIDENCE_LAYERS;
    layer = (c) => {
      if (typeof c !== 'number' || c < r.min || c > r.max) return undefined;
      const toward = (c - r.min) / (r.max - r.min);
      // We store confidence, not uncertainty: û = 1 − normalise(confidence).
      return layerFor(1 - (confidence.preference === 'decreasing' ? 1 - toward : toward), m);
    };
    layerWords = CONTINUOUS_CONFIDENCE_WORDS;
  } else {
    return undefined;
  }
  // A tree the palette was not built for (too many levels on either side) is left uncoloured.
  if (!Object.prototype.hasOwnProperty.call(VSUP_PALETTE, vsupSwatchId(k, m, 0, 0))) return undefined;
  return { tree: mergeTree(k, m), level, layer, levelWords: levels.map(String), reversed: score!.preference === 'decreasing', layerWords };
}

/** A group of levels in words, in the scale's declared order: "3", "1 or 2", "1 to 3", or "any" for the whole scale. */
function groupWords([first, last]: LevelGroup, { levelWords: words, reversed }: SuppressedColumn): string {
  if (first === last) return words[first]!;
  if (first === 0 && last === words.length - 1) return 'any';
  const [a, b] = reversed ? [words[last], words[first]] : [words[first], words[last]];
  return last === first + 1 ? `${a} or ${b}` : `${a} to ${b}`;
}

/**
 * The value-suppressing blend (ADR-0010 clauses 2, 3, 5 and 9): a cell's colour
 * is its value's node in an ordinal merge tree, pulled toward the theme surface
 * as confidence falls, so a high value on thin evidence recedes. Colours come
 * from the precomputed, tested `VSUP_PALETTE`; the hatch says the confidence
 * layer in a second channel (drawn by #102), and the value stays as text.
 */
/** What one value-suppressing blend suppresses by: the per-column tree, the per-cell certainty, and its words. */
interface SuppressionSpec {
  columnOf: (criterionId: string) => SuppressedColumn | undefined;
  /** The cell's certainty, read by its column's `layer`. */
  certainty: (alt: string, crit: string) => ScalarValue | undefined;
  /** What a layer is a level of: "confidence", "agreement". */
  noun: string;
  /** What makes a cell recede: "confidence falls". */
  falls: string;
  noCell: string;
  /** After "no shown criterion has a <measure> on a ranked scale of 2 to 5 levels". */
  noColumn: string;
  notes: (someUncoloured: boolean) => string[];
}

/** The value-suppressing blend over a certainty (ADR-0010; ADR-0024 for disagreement): one body, two parameterisations. */
function suppressedBy(ctx: EncodingContext, spec: SuppressionSpec): PreparedEncoding | { unavailable: string } {
    const columns = new Map(ctx.criteria.map((id) => [id, spec.columnOf(id)] as const));
    const marks = new Map<string, CellMark>();
    // Keyed by the swatch *and* the column's words: two columns with one tree share a colour, but
    // when their levels read differently (other words, the other direction) each gets its own line.
    const used = new Map<string, { swatch: VsupSwatchId; column: SuppressedColumn; layer: number; node: number; count: number }>();
    let unplaced = false;
    for (const alt of ctx.alternatives) {
      for (const crit of ctx.criteria) {
        const column = columns.get(crit);
        const v = ctx.read(alt, crit)?.value;
        if (!column || v === undefined) continue;
        const c = spec.certainty(alt, crit);
        const level = column.level(v);
        const layer = c === undefined ? undefined : column.layer(c);
        if (level === undefined || layer === undefined) { unplaced = true; continue; }
        const node = nodeOf(column.tree, level, layer);
        const { scoreLevels: k, confidenceLevels: m } = column.tree;
        const swatch = vsupSwatchId(k, m, layer, node);
        // Density says how far from the most confident layer, on one scale for every column: 3 is the root.
        const hatch = Math.round((3 * (m - 1 - layer)) / (m - 1));
        marks.set(`${alt}\u0000${crit}`, hatch > 0 ? { swatch, hatch: hatch as 1 | 2 | 3 } : { swatch });
        const key = [swatch, ...column.levelWords, '', ...column.layerWords].join('\u0000');
        const seen = used.get(key);
        if (seen) seen.count += 1; else used.set(key, { swatch, column, layer, node, count: 1 });
      }
    }
    if (used.size === 0) {
      return {
        unavailable: [...columns.values()].some(Boolean)
          ? spec.noCell
          : `no shown criterion has a ${ctx.measure} on a ranked scale of ${SCORE_LEVELS[0]} to ${SCORE_LEVELS[1]} levels${spec.noColumn}.`,
      };
    }
    const palette: Record<string, Swatch> = {};
    for (const { swatch } of used.values()) palette[swatch] = VSUP_PALETTE[swatch]!;
    // Most confident first (on one scale across columns), then worst to best: the rows of the wedge.
    const confident = (u: { column: SuppressedColumn; layer: number }) => u.layer / (u.column.tree.confidenceLevels - 1);
    const entries = [...used.values()].sort((a, b) => (confident(b) - confident(a)) || (a.node - b.node)).map((u) => ({
      swatch: u.swatch,
      label: `${capitalise(groupWords(u.column.tree.layers[u.layer]![u.node]!, u.column).replace(/^any$/, `any ${ctx.measure}`))}, ${u.column.layerWords[u.layer]} ${spec.noun}`,
      count: u.count,
    }));
    const aliasing = new Set<string>();
    for (const { column } of used.values()) {
      const least = column.layerWords[0];
      aliasing.add(`At ${least} ${spec.noun}, every ${ctx.measure} is shown as one colour.`);
      column.tree.layers.slice(1, -1).forEach((groups, i) => {
        if (groups.length === 1) {
          aliasing.add(`At ${column.layerWords[i + 1]} ${spec.noun}, every ${ctx.measure} is shown as one colour.`);
          return;
        }
        const merged = groups.filter(([first, last]) => last > first).map((g) => groupWords(g, column));
        if (merged.length > 0) aliasing.add(`At ${column.layerWords[i + 1]} ${spec.noun}, each of these is shown as one colour: ${merged.join('; ')}.`);
      });
    }
    return {
      mark: (alt, crit) => marks.get(`${alt}\u0000${crit}`) ?? NO_MARK,
      palette,
      legend: {
        title: `${capitalise(ctx.measure)}, fading toward the background as ${spec.falls}`,
        entries,
        notes: [
          ...aliasing,
          ...spec.notes(unplaced || [...columns.values()].some((c) => !c)),
        ],
      },
    };
}

/**
 * The value-suppressing blend (ADR-0010 clauses 2, 3, 5 and 9): a cell's colour
 * is its value's node in an ordinal merge tree, pulled toward the theme surface
 * as confidence falls, so a high value on thin evidence recedes. Colours come
 * from the precomputed, tested `VSUP_PALETTE`; the hatch says the confidence
 * layer in a second channel (drawn by #102), and the value stays as text.
 */
export const uncertaintySuppressed = /* @__PURE__ */ defineEncoding({
  id: 'uncertainty-suppressed',
  label: 'Value, suppressed by low confidence',
  texture: { channel: 'hatch', carries: 'confidence', levels: 3 },
  prepare: (ctx) => {
    if (ctx.measure === CONFIDENCE) return { unavailable: 'the shown measure is the confidence itself; show the measure it qualifies.' };
    if (!ctx.analysis.measures.some((m) => m.name === CONFIDENCE)) return { unavailable: 'this analysis records no confidence measure to suppress by.' };
    const byId = new Map(ctx.analysis.criteria.map((c) => [c.id, c]));
    return suppressedBy(ctx, {
      columnOf: (id) => {
        const c = byId.get(id);
        return c ? suppressedColumn(measurementFor(c, ctx.measure), measurementFor(c, CONFIDENCE)) : undefined;
      },
      certainty: (alt, crit) => ctx.readMeasure(CONFIDENCE, alt, crit)?.value,
      noun: 'confidence',
      falls: 'confidence falls',
      noCell: `no shown cell records both a ${ctx.measure} and a confidence on their declared scales.`,
      noColumn: ' and a ranked confidence to suppress it by',
      notes: (uncoloured) => [
        `The ${ctx.measure} stays as text in every cell. In the study that introduced this blend, it changed which options readers chose -- they avoided the least certain, and accepted worse expected value to do so -- not how accurately they read values.`,
        ...(uncoloured
          ? [`Cells with no confidence recorded, and criteria with no ranked confidence or whose ${ctx.measure} is not on a ranked scale of ${SCORE_LEVELS[0]} to ${SCORE_LEVELS[1]} levels, are left uncoloured.`]
          : []),
      ],
    });
  },
});

/** Agreement layers of `consensus-suppressed`, least agreement first: the disagreement index read in three. */
const AGREEMENT_LAYERS = 3;
const AGREEMENT_WORDS = ['low', 'medium', 'high'];

/**
 * The blend re-parameterised by disagreement (ADR-0024 and its amendment): the
 * same palette and tree, with the cell's `disagreementIndex` in place of
 * uncertainty, so a value the raters split on recedes as a value on thin
 * evidence does. A cell with fewer than two ratings, or on fewer than three
 * levels, has no index and is left uncoloured.
 */
export const consensusSuppressed = /* @__PURE__ */ defineEncoding({
  id: 'consensus-suppressed',
  label: 'Value, suppressed by disagreement',
  texture: { channel: 'hatch', carries: 'disagreement', levels: 3 },
  prepare: (ctx) => {
    const stripOf = ctx.stripOf;
    if (!stripOf) return { unavailable: 'this host does not give the encoding the cells\' assertions.' };
    const measured = criteriaMeasured(ctx);
    return suppressedBy(ctx, {
      columnOf: (id) => {
        const m = measured.get(id);
        const levels = rankedLevels(m);
        if (!levels || !m) return undefined;
        const k = levels.length;
        if (!Object.prototype.hasOwnProperty.call(VSUP_PALETTE, vsupSwatchId(k, AGREEMENT_LAYERS, 0, 0))) return undefined;
        return {
          tree: mergeTree(k, AGREEMENT_LAYERS),
          level: (v) => { const i = levels.findIndex((l) => l === v); return i < 0 ? undefined : i; },
          // The index is the uncertainty: 0 unanimity takes the top layer, 1 bimodality the root.
          layer: (d) => (typeof d === 'number' ? layerFor(d, AGREEMENT_LAYERS) : undefined),
          levelWords: levels.map(String),
          reversed: m.preference === 'decreasing',
          layerWords: AGREEMENT_WORDS,
        };
      },
      certainty: (alt, crit) => {
        const levels = stripLevels(measured.get(crit));
        const strip = levels && stripOf(alt, crit, levels);
        return strip ? stripDisagreement(strip)?.index : undefined;
      },
      noun: 'agreement',
      falls: 'the raters disagree',
      noCell: `no shown cell has two or more ratings of a ${ctx.measure} on a scale of three or more levels to measure disagreement on.`,
      noColumn: ' to suppress by its raters\' disagreement',
      notes: (uncoloured) => [
        `The ${ctx.measure} stays as text in every cell. Agreement is the cell's disagreement index, (1 - A) / 2 of van der Eijk's A, read in three layers; each cell's text gives its ratings.`,
        ...(uncoloured ? ['Cells with fewer than two ratings, or on a scale of fewer than three levels, have no disagreement to suppress by and are left uncoloured.'] : []),
      ],
    });
  },
});

/**
 * Where the strip gives way to its narrower forms, in `em` of the cell's text
 * (ADR-0024: registered parameters, not constants in the renderer). Set so the
 * dots of a five-level scale (4 em wide at rest) stay at least 0.6 em apart.
 */
export const STRIP_THRESHOLDS = Object.freeze({ bracketBelow: 3, hiddenBelow: 1.2 });

/**
 * The rater dot strip (ADR-0024, #110): the criterion's levels are fixed slots
 * across the cell and each assertion is one dot at its level, ties stacked.
 * It reads the assertion set, not the reduction, so a cell the reduction
 * refuses to summarise is exactly where it draws; and it never marks a centre.
 *
 * A dot is filled for a set of independent raters and a ring for anything
 * else, so five draws of one model do not read as five raters (the cell's
 * words say which, too). A narrow cell draws the range bracket instead.
 */
export const disagreement = /* @__PURE__ */ defineEncoding({
  id: 'disagreement',
  label: 'Raters, as a dot strip',
  texture: { channel: 'none', because: 'each rater is a dot at a position on the scale, and the cell\'s text lists every rating.' },
  prepare: (ctx) => {
    const stripOf = ctx.stripOf;
    if (!stripOf) return { unavailable: 'this host does not give the encoding the cells\' assertions.' };
    const levelsOf = new Map([...criteriaMeasured(ctx)].map(([id, m]) => [id, stripLevels(m)] as const));
    if (![...levelsOf.values()].some((l) => l !== undefined)) {
      return { unavailable: `no shown criterion has a short ordered list of levels (or whole-number range) to lay a ${ctx.measure} on.` };
    }
    const strips = new Map<string, RaterStrip>();
    for (const alt of ctx.alternatives) for (const crit of ctx.criteria) {
      const levels = levelsOf.get(crit);
      const strip = levels && stripOf(alt, crit, levels);
      if (strip) strips.set(`${alt}\u0000${crit}`, strip);
    }
    if (strips.size === 0) return { unavailable: 'no shown cell holds more than one live assertion, so there is no set of ratings to show.' };
    const count = (reading: RaterStrip['reading']) => [...strips.values()].filter((s) => s.reading === reading).length;
    const note = (n: number, what: string) => (n > 0 ? [`${n} cell${n === 1 ? '' : 's'}: ${what}`] : []);
    return {
      mark: (alt, crit) => {
        const strip = strips.get(`${alt}\u0000${crit}`);
        return strip ? { strip, said: `. ${strip.label}` } : NO_MARK;
      },
      strip: STRIP_THRESHOLDS,
      legend: {
        title: 'Ratings, one dot each',
        entries: [
          { badge: '\u25cf', label: 'one assertion, by a rater who is independent of the others' },
          { badge: '\u25cb', label: 'one assertion that is not independent: a draw of one source, or a rung below independent' },
        ],
        notes: [
          'Each level of the scale has a fixed place across the cell; dots at the same level stack. Nothing is drawn at an average.',
          'A narrower cell shows a bracket from the lowest to the highest rating, with the most common rating marked, and a narrower one only its text.',
          'A cell with a single assertion shows no strip. Every cell lists its ratings in words.',
          ...note(count('raters'), 'independent raters'),
          ...note(count('draws'), 'draws of one source, not raters'),
          ...note(count('correlated'), 'assertions that are not independent'),
        ],
      },
    };
  },
});

/** A cell's disagreement index as a step of the sequential ramp: 0 (unanimity) the lightest, 1 (bimodality) the darkest. */
export function spreadStep(index: number): SwatchId {
  return STEPS[Math.max(0, Math.min(STEPS.length - 1, Math.floor(index * STEPS.length)))]!;
}

/**
 * The disagreement ramp (ADR-0024 and its amendment): one hue, light to dark,
 * over each cell's `disagreementIndex`, `(1 - A) / 2`, and nothing else; the
 * value never enters the mapping. The thing to sort on, thumbnail and print
 * small, where the strip is the thing to read. A and `n` are said with it in
 * every cell, since A is a shape statistic that does not know the count.
 */
export const disagreementSpread = /* @__PURE__ */ defineEncoding({
  id: 'disagreement-spread',
  label: 'Disagreement',
  texture: { channel: 'none', because: 'the ramp is one statistic, stated with its rater count in the cell\'s text.' },
  prepare: (ctx) => {
    const stripOf = ctx.stripOf;
    if (!stripOf) return { unavailable: 'this host does not give the encoding the cells\' assertions.' };
    const levelsOf = new Map([...criteriaMeasured(ctx)].map(([id, m]) => [id, stripLevels(m)] as const));
    if (![...levelsOf.values()].some((l) => l !== undefined && l.length >= 3)) {
      return { unavailable: `no shown criterion has an ordered list of three or more levels to measure the disagreement of a ${ctx.measure} on.` };
    }
    const marks = new Map<string, CellMark>();
    const counts = new Map<SwatchId, number>();
    for (const alt of ctx.alternatives) for (const crit of ctx.criteria) {
      const levels = levelsOf.get(crit);
      const strip = levels && stripOf(alt, crit, levels);
      const d = strip && stripDisagreement(strip);
      if (!strip || !d) continue;
      const swatch = spreadStep(d.index);
      counts.set(swatch, (counts.get(swatch) ?? 0) + 1);
      marks.set(`${alt}\u0000${crit}`, { swatch, said: `. ${strip.label}. Disagreement ${d.index.toFixed(2)} (A ${d.a.toFixed(2)}, n ${d.n})` });
    }
    if (marks.size === 0) return { unavailable: 'no shown cell holds two or more ratings on a scale of three or more levels, so there is no disagreement to show.' };
    const word = ['Unanimous or nearly', 'Little disagreement', 'Some disagreement', 'Much disagreement', 'Split, or nearly'];
    return {
      mark: (alt, crit) => marks.get(`${alt}\u0000${crit}`) ?? NO_MARK,
      legend: {
        title: 'Disagreement between the ratings, light to dark',
        entries: STEPS.map((swatch, i) => ({ swatch, label: `${word[i]} (index ${(i / STEPS.length).toFixed(1)} to ${((i + 1) / STEPS.length).toFixed(1)})`, count: counts.get(swatch) ?? 0 })),
        notes: [
          'The index is (1 - A) / 2 of van der Eijk\'s A over the cell\'s ratings: 0 when every rating is the same, 1 when they split evenly between the two ends. The value itself plays no part in the colour.',
          'Each cell says its index with A and the number of ratings, n, and lists its ratings. A cell with fewer than two ratings is left uncoloured.',
        ],
      },
    };
  },
});

/** All nine, for a composition root that ships them all. Importing this keeps every one in the bundle. */
export const SHIPPED_ENCODINGS: readonly EncodingDefinition[] = /* @__PURE__ */ Object.freeze([
  textOnly, value, categorical, missingness, datum,
  uncertaintySuppressed, consensusSuppressed, disagreement, disagreementSpread,
]);

/** Each shown criterion's measurement for the shown measure. */
function criteriaMeasured(ctx: EncodingContext): Map<string, Measurement | undefined> {
  const byId = new Map(ctx.analysis.criteria.map((c) => [c.id, c]));
  return new Map(ctx.criteria.map((id) => {
    const c = byId.get(id);
    return [id, c ? measurementFor(c, ctx.measure) : undefined] as const;
  }));
}

/**
 * Where a value sits between its criterion's worst and best, 0 to 1.
 * `undefined` for a value it cannot place; `null` when the criterion itself
 * has no direction or nothing to place on (asked with `v` undefined).
 */
function towardBest(v: ScalarValue | undefined, m: Measurement): number | undefined | null {
  // Only a direction has a best end. `ordered` and `none` have none; a
  // `target` needs a distance metric, the cardinal assumption ADR-0019 clause 7
  // keeps out of v1.
  if (m.preference !== 'increasing' && m.preference !== 'decreasing') return null;
  // A nominal level's `levels` are display order, not rank, whatever preference was written.
  if (!isOrdered(m.level)) return null;
  const levels = m.levels && m.levels.length >= 2 ? m.levels : undefined;
  const range = m.range && m.range.max > m.range.min ? m.range : undefined;
  if (!range && !levels) return null;
  if (v === undefined) return 0;
  let t: number | undefined;
  if (levels && (m.level === 'ordinal' || !range)) {
    const i = levels.findIndex((l) => l === v);
    t = i < 0 ? undefined : i / (levels.length - 1);
    if (t !== undefined && m.preference === 'decreasing') t = 1 - t;
    return t;
  }
  if (!range || typeof v !== 'number') return undefined;
  const at = Math.min(1, Math.max(0, (v - range.min) / (range.max - range.min)));
  if (m.preference === 'decreasing') return 1 - at;
  return at;
}
