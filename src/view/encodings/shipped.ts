/**
 * The encodings comparanda ships (ADR-0010 as amended, ADR-0024, ADR-0032):
 * plain named exports, each one a `defineEncoding`, none registered here. A
 * composition root picks the ones it wants and hands them to
 * `createEncodingRegistry`; `SHIPPED_ENCODINGS` is all nine, for a root that
 * wants them all.
 *
 * Six draw today: `text-only`, `value`, `categorical`, `missingness`,
 * `datum`, `uncertainty-suppressed`. Three are registered with their texture
 * and legend, and say why they cannot draw yet when chosen, so the matrix
 * falls back to text and says so: `consensus-suppressed` waits for the
 * per-cell disagreement index; `disagreement` for the rater dot strip
 * (#110); `disagreement-spread` for the per-cell disagreement index
 * (ADR-0024's `(1 − A) / 2`). Each of those lands behind this same
 * registration rather than as a new one.
 */
import { pughTally, type PughStanding } from '../../core/analyses/pugh.js';
import { CORE_MISSING_CODES, NOT_APPLICABLE, NOT_ASSESSED, type MissingCode } from '../../core/schema/missingness.js';
import { isOrdered, type Measurement } from '../../core/schema/measurement.js';
import { measurementFor } from '../../core/schema/structure.js';
import type { ScalarValue } from '../../core/schema/values.js';
import type { Swatch, SwatchId } from './palette.js';
import { VSUP_PALETTE } from './vsup-palette.js';
import { layerFor, mergeTree, nodeOf, vsupSwatchId, type LevelGroup, type MergeTree, type VsupSwatchId } from './vsup.js';
import {
  defineEncoding, type CellMark, type EncodingContext, type EncodingDefinition, type LegendEntry,
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
    const coreOf = (code: string, crit: string): MissingCode | undefined => {
      if (Object.prototype.hasOwnProperty.call(CORE_MISSING_CODES, code)) return code as MissingCode;
      const declared = ctx.vocabulary.declarationsFor(crit).find((d) => d.id === code);
      if (declared) return declared.broader;
      const resolved = ctx.vocabulary.resolve(code, crit);
      return resolved.source === 'degraded' ? resolved.broader as MissingCode : undefined;
    };
    const mark = (alt: string, crit: string): CellMark => {
      const reduced = ctx.read(alt, crit);
      if (reduced?.value !== undefined || reduced?.refused !== undefined) return NO_MARK;
      const code = reduced?.missing !== undefined
        ? coreOf(reduced.missing.code, crit)
        : ctx.inapplicable(alt, crit) ? NOT_APPLICABLE : NOT_ASSESSED;
      if (code === undefined) return NO_MARK;
      counts.set(code, (counts.get(code) ?? 0) + 1);
      return { swatch: `miss-${code}`, glyph: code };
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

const CONFIDENCE = 'confidence';
/** Confidence recorded on a range rather than as levels is read in this many layers, the hatch's maximum. */
const CONTINUOUS_CONFIDENCE_LAYERS = 3;
const CONTINUOUS_CONFIDENCE_WORDS = ['low', 'medium', 'high'];

/** One column's trees: how its values and its confidences find their node. */
interface SuppressedColumn {
  readonly tree: MergeTree;
  /** A value's level, 0 the worst, or `undefined` when it is not one of the scale's. */
  readonly level: (v: ScalarValue) => number | undefined;
  /** A confidence's layer, 0 the least confident, or `undefined` when it cannot be placed. */
  readonly layer: (c: ScalarValue) => number | undefined;
  /** The scale's levels in words, worst first, and the confidence layers', least confident first. */
  readonly levelWords: readonly string[];
  readonly layerWords: readonly string[];
}

/** A scale's levels, worst first, when it is ordered, has a best end, and lists (or spans) a few. */
function rankedLevels(m: Measurement | undefined): readonly ScalarValue[] | undefined {
  if (!m || !isOrdered(m.level)) return undefined;
  if (m.preference !== 'increasing' && m.preference !== 'decreasing') return undefined;
  let levels: readonly ScalarValue[] | undefined = m.levels && m.levels.length >= 2 ? m.levels : undefined;
  const r = m.range;
  if (!levels && r && Number.isInteger(r.min) && Number.isInteger(r.max) && r.max > r.min && m.level !== 'ratio') {
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
  const confLevels = rankedLevels(confidence);
  const r = confidence.range;
  let m: number;
  let layer: (c: ScalarValue) => number | undefined;
  let layerWords: string[];
  if (confLevels) {
    m = confLevels.length;
    layer = (c) => {
      const i = confLevels.findIndex((l) => l === c);
      return i < 0 ? undefined : layerFor(1 - i / (m - 1), m);
    };
    layerWords = confLevels.map(String);
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
  return { tree: mergeTree(k, m), level, layer, levelWords: levels.map(String), layerWords };
}

/** A group of levels in words: "3", "1 or 2", "1 to 3", or "any" for the whole scale. */
function groupWords([first, last]: LevelGroup, words: readonly string[]): string {
  if (first === last) return words[first]!;
  if (first === 0 && last === words.length - 1) return 'any';
  return last === first + 1 ? `${words[first]} or ${words[last]}` : `${words[first]} to ${words[last]}`;
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
    const columns = new Map(ctx.criteria.map((id) => {
      const c = byId.get(id);
      return [id, c ? suppressedColumn(measurementFor(c, ctx.measure), measurementFor(c, CONFIDENCE)) : undefined] as const;
    }));
    const marks = new Map<string, CellMark>();
    const used = new Map<VsupSwatchId, { column: SuppressedColumn; layer: number; node: number; count: number }>();
    let unplaced = false;
    for (const alt of ctx.alternatives) {
      for (const crit of ctx.criteria) {
        const column = columns.get(crit);
        const v = ctx.read(alt, crit)?.value;
        if (!column || v === undefined) continue;
        const c = ctx.readMeasure(CONFIDENCE, alt, crit)?.value;
        const level = column.level(v);
        const layer = c === undefined ? undefined : column.layer(c);
        if (level === undefined || layer === undefined) { unplaced = true; continue; }
        const node = nodeOf(column.tree, level, layer);
        const { scoreLevels: k, confidenceLevels: m } = column.tree;
        const swatch = vsupSwatchId(k, m, layer, node);
        const hatch = m - 1 - layer;
        marks.set(`${alt}\u0000${crit}`, hatch > 0 ? { swatch, hatch: hatch as 1 | 2 | 3 } : { swatch });
        const seen = used.get(swatch);
        if (seen) seen.count += 1; else used.set(swatch, { column, layer, node, count: 1 });
      }
    }
    if (used.size === 0) {
      return {
        unavailable: [...columns.values()].some(Boolean)
          ? `no shown cell records both a ${ctx.measure} and a confidence on their declared scales.`
          : `no shown criterion has a ${ctx.measure} on a ranked scale of 2 to 7 levels and a ranked confidence to suppress it by.`,
      };
    }
    const palette: Record<string, Swatch> = {};
    for (const id of used.keys()) palette[id] = VSUP_PALETTE[id]!;
    // Most confident first, then worst to best: the order the eye reads the rows of the wedge.
    const entries = [...used].sort(([, a], [, b]) => (b.layer - a.layer) || (a.node - b.node)).map(([swatch, u]) => ({
      swatch,
      label: `${capitalise(groupWords(u.column.tree.layers[u.layer]![u.node]!, u.column.levelWords).replace(/^any$/, `any ${ctx.measure}`))}, ${u.column.layerWords[u.layer]} confidence`,
      count: u.count,
    }));
    const aliasing = new Set<string>();
    for (const { column } of used.values()) {
      const least = column.layerWords[0];
      aliasing.add(`At ${least} confidence, every ${ctx.measure} is shown as one colour.`);
      column.tree.layers.slice(1, -1).forEach((groups, i) => {
        const merged = groups.filter(([first, last]) => last > first).map((g) => groupWords(g, column.levelWords));
        if (merged.length > 0) aliasing.add(`At ${column.layerWords[i + 1]} confidence, each of these is shown as one colour: ${merged.join('; ')}.`);
      });
    }
    return {
      mark: (alt, crit) => marks.get(`${alt}\u0000${crit}`) ?? NO_MARK,
      palette,
      legend: {
        title: `${capitalise(ctx.measure)}, fading toward the background as confidence falls`,
        entries,
        notes: [
          ...aliasing,
          `The ${ctx.measure} stays as text in every cell. In the study that introduced this blend, it changed which options readers chose -- they avoided the least certain, and accepted worse expected value to do so -- not how accurately they read values.`,
          ...(unplaced || [...columns.values()].some((c) => !c)
            ? [`Cells with no confidence recorded, and criteria whose ${ctx.measure} is not on a ranked scale of 2 to 7 levels, are left uncoloured.`]
            : []),
        ],
      },
    };
  },
});

/** The blend re-parameterised by disagreement (ADR-0024): registered; the palette is in, the per-cell index is not. */
export const consensusSuppressed = /* @__PURE__ */ defineEncoding({
  id: 'consensus-suppressed',
  label: 'Value, suppressed by disagreement',
  texture: { channel: 'hatch', carries: 'disagreement', levels: 3 },
  prepare: () => ({ unavailable: 'the per-cell disagreement index it suppresses by is not in this build yet.' }),
});

/** The rater dot strip (ADR-0024): registered; drawn by #110. */
export const disagreement = /* @__PURE__ */ defineEncoding({
  id: 'disagreement',
  label: 'Raters, as a dot strip',
  texture: { channel: 'none', because: 'each rater is a dot at a position on the scale, and the cell\'s text lists every rating.' },
  prepare: () => ({ unavailable: 'the rater dot strip is not drawn in this build yet.' }),
});

/** A ramp over `(1 − A) / 2` and nothing else (ADR-0024 amendment): registered; needs the per-cell index. */
export const disagreementSpread = /* @__PURE__ */ defineEncoding({
  id: 'disagreement-spread',
  label: 'Disagreement',
  texture: { channel: 'none', because: 'the ramp is one statistic, stated with its rater count in the cell\'s text.' },
  prepare: () => ({ unavailable: 'the per-cell disagreement index its ramp is laid on is not in this build yet.' }),
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

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
