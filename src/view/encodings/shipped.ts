/**
 * The encodings comparanda ships (ADR-0010 as amended, ADR-0024, ADR-0032):
 * plain named exports, each one a `defineEncoding`, none registered here. A
 * composition root picks the ones it wants and hands them to
 * `createEncodingRegistry`; `SHIPPED_ENCODINGS` is all nine, for a root that
 * wants them all.
 *
 * Five draw today: `text-only`, `value`, `categorical`, `missingness`,
 * `datum`. Four are registered with their texture and legend, and say why
 * they cannot draw yet when chosen, so the matrix falls back to text and says
 * so: `uncertainty-suppressed` and `consensus-suppressed` wait for the
 * value-suppressing palette (#91); `disagreement` for the rater dot strip
 * (#110); `disagreement-spread` for the per-cell disagreement index
 * (ADR-0024's `(1 − A) / 2`). Each of those lands behind this same
 * registration rather than as a new one.
 */
import { pughTally, type PughStanding } from '../../core/analyses/pugh.js';
import { CORE_MISSING_CODES, NOT_APPLICABLE, NOT_ASSESSED, type MissingCode } from '../../core/schema/missingness.js';
import { isOrdered, type Measurement } from '../../core/schema/measurement.js';
import { measurementFor } from '../../core/schema/structure.js';
import type { ScalarValue } from '../../core/schema/values.js';
import type { SwatchId } from './palette.js';
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
        const swatch = mark(alt, crit).swatch;
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

/** The value-suppressing blend (ADR-0010 clauses 2, 3, 5): registered; its palette is #91's. */
export const uncertaintySuppressed = /* @__PURE__ */ defineEncoding({
  id: 'uncertainty-suppressed',
  label: 'Value, suppressed by low confidence',
  texture: { channel: 'hatch', carries: 'confidence', levels: 3 },
  prepare: (ctx) => ({
    unavailable: ctx.analysis.measures.some((m) => m.name === 'confidence')
      ? 'its value-suppressing palette is not in this build yet.'
      : 'this analysis records no confidence measure to suppress by.',
  }),
});

/** The blend re-parameterised by disagreement (ADR-0024): registered; its palette is #91's. */
export const consensusSuppressed = /* @__PURE__ */ defineEncoding({
  id: 'consensus-suppressed',
  label: 'Value, suppressed by disagreement',
  texture: { channel: 'hatch', carries: 'disagreement', levels: 3 },
  prepare: () => ({ unavailable: 'its value-suppressing palette and the per-cell disagreement index are not in this build yet.' }),
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
