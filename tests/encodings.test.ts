/**
 * The encoding registry and the shipped encodings (#90, ADR-0010 as amended).
 *
 * In plain Node: an encoding is data the matrix renders, so its marks, its
 * legend and its palette are checked here, and the browser suite checks what
 * they look like painted.
 */
import { describe, expect, it } from 'vitest';

import { pughTally } from '../src/core/analyses/pugh.js';
import { Analysis, cellIndex, cellKey, makeCellReader, vocabularyOf } from '../src/core/schema/analysis.js';
import { raterStripInView } from '../src/core/rater-strip.js';
import { spreadStep } from '../src/view/encodings/shipped.js';
import { vsupSwatchId } from '../src/view/encodings/vsup.js';
import { coreReasonOf } from '../src/core/schema/missingness.js';
import { editAffordances, inMemoryAnalysisSource } from '../src/store/index.js';
import {
  categorical, consensusSuppressed, createEncodingRegistry, datum, disagreementSpread, mergeTree, defineEncoding, describeTexture, missingness, SHIPPED_ENCODINGS,
  textOnly, value, type EncodingContext, type EncodingDefinition, type PreparedEncoding,
} from '../src/view/index.js';
import { relativeLuminanceWcag, TEXT_CONTRAST_MIN, wcagContrastRatio } from '../src/view/encodings/contrast.js';
import { PALETTE, SWATCH_IDS } from '../src/view/encodings/palette.js';
import languagesJson from '../examples/languages.json';
import { languagesWithConfidence } from './fixtures/confidence.js';
import relocationJson from '../examples/relocation.json';

const relocation = Analysis.parse(relocationJson);
/** The fixture reduces by lower-median, which refuses a nominal cell; categories need a reduction that keeps one. */
const relocationLatest = Analysis.parse({ ...relocationJson, defaultReduction: 'latest' });
const languages = Analysis.parse(languagesJson);

function contextOf(a: Analysis, measure = 'score'): EncodingContext {
  const reader = makeCellReader(a, measure);
  const affordances = editAffordances(inMemoryAnalysisSource(a), a);
  return {
    analysis: a, measure, vocabulary: vocabularyOf(a),
    alternatives: a.alternatives.map((x) => x.id), criteria: a.criteria.map((x) => x.id),
    read: (alt, crit) => reader.read(alt, crit),
    readMeasure: (other, alt, crit) => makeCellReader(a, other).read(alt, crit),
    inapplicable: affordances.inapplicable,
  };
}
function prepared(e: EncodingDefinition, ctx: EncodingContext): PreparedEncoding {
  const p = e.prepare(ctx);
  if ('unavailable' in p) throw new Error(`${e.id} unavailable: ${p.unavailable}`);
  return p;
}
const cells = (ctx: EncodingContext) => ctx.alternatives.flatMap((alt) => ctx.criteria.map((crit) => [alt, crit] as const));

describe('registration', () => {
  it('ships the nine of ADR-0010 and ADR-0032, each declaring its texture', () => {
    expect(SHIPPED_ENCODINGS.map((e) => e.id)).toEqual([
      'text-only', 'value', 'categorical', 'missingness', 'datum',
      'uncertainty-suppressed', 'consensus-suppressed', 'disagreement', 'disagreement-spread',
    ]);
    for (const e of SHIPPED_ENCODINGS) {
      expect(['none', 'hatch', 'glyph']).toContain(e.texture.channel);
      expect(describeTexture(e.texture).length).toBeGreaterThan(10);
    }
    expect(createEncodingRegistry(SHIPPED_ENCODINGS).ids).toHaveLength(9);
  });

  it('refuses a registration without a texture, at build and at run time', () => {
    const prepare = textOnly.prepare;
    // @ts-expect-error -- `texture` is required: this is the build-time half, checked by `tsc`.
    expect(() => defineEncoding({ id: 'bare', label: 'Bare', prepare })).toThrow(/declares no texture/);
    expect(() => defineEncoding({ id: 'mute', label: 'Mute', texture: { channel: 'none', because: ' ' }, prepare }))
      .toThrow(/without saying why/);
    expect(() => defineEncoding({ id: 'dense', label: 'Dense', texture: { channel: 'hatch', carries: 'confidence', levels: 4 as 3 }, prepare }))
      .toThrow(/1 to 3 levels/);
    expect(() => defineEncoding({ id: 'tag', label: 'Tag', texture: { channel: 'glyph', carries: 'category' as 'missing-reason' }, prepare }))
      .toThrow(/missingness reason/);
    // A hand-built object that never went through defineEncoding is refused by the registry too.
    expect(() => createEncodingRegistry([{ id: 'raw', label: 'Raw', prepare } as unknown as EncodingDefinition]))
      .toThrow(/cannot be registered/);
  });

  it('refuses two encodings with one id', () => {
    expect(() => createEncodingRegistry([textOnly, textOnly])).toThrow(/share the id "text-only"/);
  });

  it('every definition is frozen, its texture too', () => {
    for (const e of SHIPPED_ENCODINGS) {
      expect(Object.isFrozen(e)).toBe(true);
      expect(Object.isFrozen(e.texture)).toBe(true);
    }
  });
});

describe('the palette', () => {
  it('every ink clears 4.5:1 on its fill, in both themes', () => {
    for (const id of SWATCH_IDS) {
      for (const theme of ['light', 'dark'] as const) {
        const [fill, ink] = PALETTE[id][theme];
        expect(wcagContrastRatio(fill, ink), `${id} ${theme}`).toBeGreaterThanOrEqual(TEXT_CONTRAST_MIN);
      }
    }
  });

  it('the value ramp runs light to dark on the light theme and inverts on the dark one', () => {
    const steps = ['seq-1', 'seq-2', 'seq-3', 'seq-4', 'seq-5'] as const;
    const light = steps.map((s) => relativeLuminanceWcag(PALETTE[s].light[0]));
    const dark = steps.map((s) => relativeLuminanceWcag(PALETTE[s].dark[0]));
    expect([...light].sort((x, y) => y - x)).toEqual(light);
    expect([...dark].sort((x, y) => x - y)).toEqual(dark);
  });

  it('measures luminance with the linear toe, not a plain power curve', () => {
    expect(relativeLuminanceWcag('#000000')).toBe(0);
    expect(relativeLuminanceWcag('#ffffff')).toBeCloseTo(1, 10);
    // 0x0a/255 = 0.039, below 0.04045: linear segment, 0.039/12.92.
    expect(relativeLuminanceWcag('#0a0a0a')).toBeCloseTo(10 / 255 / 12.92, 10);
  });
});

describe('value', () => {
  it('places a value along its criterion\'s preferred direction: low rent is the darkest step', () => {
    const ctx = contextOf(relocation);
    const p = prepared(value, ctx);
    const rents = ctx.alternatives
      .map((alt) => ({ alt, v: ctx.read(alt, 'rent')?.value }))
      .filter((x): x is { alt: string; v: number } => typeof x.v === 'number')
      .sort((x, y) => x.v - y.v);
    expect(rents.length).toBeGreaterThan(1);
    const step = (alt: string) => Number(p.mark(alt, 'rent').swatch!.slice('seq-'.length));
    expect(step(rents[0]!.alt)).toBeGreaterThanOrEqual(step(rents.at(-1)!.alt));
  });

  it('leaves a criterion with no best end uncoloured, and says so', () => {
    const ctx = contextOf(relocation);
    const p = prepared(value, ctx);
    for (const alt of ctx.alternatives) expect(p.mark(alt, 'climate-type').swatch).toBeUndefined();
    expect(p.legend.notes.join(' ')).toMatch(/left uncoloured/);
  });

  it('never ranks a nominal criterion, whatever preference was written on it', () => {
    const json = structuredClone(relocationJson) as typeof relocationJson;
    const visa = json.criteria.find((c) => c.id === 'visa-free')!;
    visa.defaultMeasurement = { ...visa.defaultMeasurement, preference: 'increasing' } as typeof visa.defaultMeasurement;
    const a = Analysis.parse(json);
    expect(a.criteria.find((c) => c.id === 'visa-free')!.defaultMeasurement!.level).toBe('nominal');
    const ctx = contextOf(a);
    const p = prepared(value, ctx);
    for (const alt of ctx.alternatives) expect(p.mark(alt, 'visa-free').swatch).toBeUndefined();
  });

  it('a 1-5 rating spans the ramp end to end', () => {
    const ctx = contextOf(languages);
    const p = prepared(value, ctx);
    const swatches = new Set(cells(ctx).map(([a, c]) => [ctx.read(a, c)?.value, p.mark(a, c).swatch] as const)
      .filter(([v]) => v === 1 || v === 5).map(([v, s]) => `${v}:${s}`));
    expect(swatches.size).toBeGreaterThan(0);
    expect([...swatches].every((x) => x === '1:seq-1' || x === '5:seq-5')).toBe(true);
  });
});

describe('categorical', () => {
  it('gives a nominal column its declared order\'s hues and leaves the rest plain', () => {
    const ctx = contextOf(relocationLatest);
    const p = prepared(categorical, ctx);
    const levels = ['Mediterranean', 'Continental', 'Subtropical'];
    let coloured = 0;
    for (const alt of ctx.alternatives) {
      const v = ctx.read(alt, 'climate-type')?.value;
      expect(typeof v).toBe('string');
      expect(p.mark(alt, 'climate-type').swatch).toBe(`cat-${levels.indexOf(v as string) + 1}`);
      coloured += 1;
      expect(p.mark(alt, 'rent').swatch).toBeUndefined();
    }
    expect(coloured).toBe(ctx.alternatives.length);
  });

  it('hiding an alternative does not recolour the others', () => {
    const json = structuredClone(relocationJson) as typeof relocationJson;
    // No declared levels: the order comes from the values, which must be all of them.
    const climate = json.criteria.find((c) => c.id === 'climate-type')!;
    const { levels: _drop, ...rest } = climate.defaultMeasurement as { levels?: unknown };
    climate.defaultMeasurement = rest as typeof climate.defaultMeasurement;
    const ctx = contextOf(Analysis.parse({ ...json, defaultReduction: 'latest' }));
    const full = prepared(categorical, ctx);
    for (const hidden of ctx.alternatives) {
      const shown = ctx.alternatives.filter((x) => x !== hidden);
      const fewer = prepared(categorical, { ...ctx, alternatives: shown });
      for (const alt of shown) expect(fewer.mark(alt, 'climate-type')).toEqual(full.mark(alt, 'climate-type'));
    }
  });

  it('cannot draw when every categorical cell is refused, and says why rather than showing an empty legend', () => {
    const p = categorical.prepare(contextOf(relocation)); // lower-median refuses a nominal cell
    expect('unavailable' in p && p.unavailable).toMatch(/no shown categorical cell has a value to colour\.$/);
  });

  it('cannot draw an analysis with no nominal criterion, and says why', () => {
    const p = categorical.prepare(contextOf(languages));
    expect('unavailable' in p && p.unavailable).toMatch(/categories/);
  });
});

describe('missingness', () => {
  it('marks every empty cell with its core reason, counts them, and leaves values plain', () => {
    const ctx = contextOf(relocation);
    const p = prepared(missingness, ctx);
    let empty = 0;
    for (const [alt, crit] of cells(ctx)) {
      const r = ctx.read(alt, crit);
      const m = p.mark(alt, crit);
      if (r?.value !== undefined || r?.refused !== undefined) expect(m).toEqual({});
      else {
        empty += 1;
        const core = r?.missing ? coreReasonOf(ctx.vocabulary, r.missing.code, crit) : ctx.inapplicable(alt, crit) ? 'not-applicable' : 'not-assessed';
        expect(m.swatch).toBe(`miss-${core}`);
      }
    }
    const counted = p.legend.entries.reduce((s, e) => s + (e.count ?? 0), 0);
    expect(counted).toBe(empty);
    expect(empty).toBeGreaterThan(0);
  });

  it('a custom code takes its broader core reason', () => {
    const ctx = contextOf(relocation);
    const p = prepared(missingness, ctx);
    const custom = cells(ctx).find(([a, c]) => ctx.read(a, c)?.missing?.code === 'not-yet-negotiated');
    expect(custom).toBeDefined();
    expect(p.mark(...custom!).swatch).toBe('miss-deferred');
  });
});

describe('datum', () => {
  it('compares against the first shown alternative, as Pugh does, with a visible mark and words', () => {
    const ctx = contextOf(relocation);
    const p = prepared(datum, ctx);
    const first = ctx.alternatives[0]!;
    const tally = pughTally(relocation, { measure: 'score', datum: first });
    for (const row of tally.rows) {
      for (const c of row.criteria) {
        const m = p.mark(row.alternativeId, c.criterionId);
        if (c.standing === 'not-comparable') expect(m.swatch).toBeUndefined();
        else {
          expect(m.swatch).toBe(`datum-${c.standing}`);
          expect(m.badge).toBeTruthy();
          expect(m.said).toMatch(/than|same as/);
        }
      }
    }
    expect(p.mark(first, ctx.criteria[0]!).badge).toBe('datum');
    // Four counts, never a net.
    expect(p.legend.entries.filter((e) => e.count !== undefined)).toHaveLength(4);
  });

  it('a different first alternative is a different datum', () => {
    const ctx = contextOf(relocation);
    const reordered = { ...ctx, alternatives: [...ctx.alternatives].reverse() };
    expect(prepared(datum, reordered).legend.title).not.toBe(prepared(datum, ctx).legend.title);
  });
});

describe('the two drawn over the disagreement index (#258)', () => {
  it('each says why it cannot draw when the host gives no assertions, rather than drawing something else', () => {
    const ctx = contextOf(languagesWithConfidence());
    for (const id of ['consensus-suppressed', 'disagreement-spread']) {
      const p = SHIPPED_ENCODINGS.find((e) => e.id === id)!.prepare(ctx);
      expect('unavailable' in p, id).toBe(true);
    }
  });

  const ORDINAL5 = { level: 'ordinal', preference: 'increasing', range: { min: 1, max: 5 }, levels: [1, 2, 3, 4, 5] } as const;
  const rated = (byAlt: Record<string, number[]>) => Analysis.parse({
    id: 'spread', subject: { question: 'q' }, defaultReduction: 'lower-median',
    authors: ['r1', 'r2', 'r3', 'r4'].map((id) => ({ id, displayName: id, kind: 'human' })),
    alternatives: Object.keys(byAlt).map((id) => ({ id, label: id })),
    criteria: [{ id: 'c', label: 'C', defaultMeasurement: ORDINAL5 }],
    cells: Object.entries(byAlt).map(([alt, values]) => ({
      alternativeId: alt, criterionId: 'c', measure: 'score',
      assertions: values.map((value, i) => ({ id: `${alt}-${i}`, authorId: `r${i + 1}`, at: '2026-10-20T00:00:00Z', value, justification: 'j', independence: 'independent' })),
    })),
  });
  const withStrips = (a: Analysis): EncodingContext => {
    const index = cellIndex(a);
    return { ...contextOf(a), stripOf: (alt, crit, levels) => { const cell = index.get(cellKey(alt, crit, 'score')); return cell && raterStripInView(a, cell, { levels }); } };
  };
  const doc = rated({ unanimous: [4, 4, 4, 4], bimodal: [1, 1, 5, 5], lone: [3] });

  it('ramp: unanimity takes the lightest step and bimodality the darkest, with A and n said', () => {
    const p = prepared(disagreementSpread, withStrips(doc));
    expect(p.mark('unanimous', 'c')).toMatchObject({ swatch: 'seq-1' });
    expect(p.mark('unanimous', 'c').said).toMatch(/Disagreement 0\.00 \(A 1\.00, n 4\)/);
    expect(p.mark('bimodal', 'c')).toMatchObject({ swatch: 'seq-5' });
    expect(p.mark('bimodal', 'c').said).toMatch(/Disagreement 1\.00 \(A -1\.00, n 4\)/);
    // One rating: no set to disagree, so nothing drawn.
    expect(p.mark('lone', 'c')).toEqual({});
  });

  it('ramp: the value never enters the mapping', () => {
    const p = prepared(disagreementSpread, withStrips(rated({ low: [1, 1, 1], high: [5, 5, 5] })));
    expect(p.mark('low', 'c').swatch).toBe(p.mark('high', 'c').swatch);
    expect([0, 0.19, 0.2, 0.99, 1].map(spreadStep)).toEqual(['seq-1', 'seq-1', 'seq-2', 'seq-5', 'seq-5']);
  });

  it('consensus-suppressed: unanimity keeps the value its own colour, bimodality recedes to the root, like low confidence', () => {
    const p = prepared(consensusSuppressed, withStrips(rated({ unanimous: [5, 5, 5, 5], bimodal: [1, 1, 5, 5], lone: [3] })));
    const top = mergeTree(5, 3).layers.length - 1;
    // Unanimity: the most-agreed layer, the value's own leaf, no hatch.
    expect(p.mark('unanimous', 'c')).toEqual({ swatch: vsupSwatchId(5, 3, top, 4) });
    // Perfect bimodality: the root, densest hatch.
    expect(p.mark('bimodal', 'c')).toMatchObject({ swatch: vsupSwatchId(5, 3, 0, 0), hatch: 3 });
    expect(p.mark('lone', 'c')).toEqual({});
    expect(p.legend.title).toMatch(/as the raters disagree/);
    expect(p.legend.entries.map((e) => e.label).join(' ')).toMatch(/high agreement/);
  });
});
