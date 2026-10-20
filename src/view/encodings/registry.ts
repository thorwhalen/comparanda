/**
 * Encodings as data a composition root assembles (ADR-0010 clause 8, ADR-0017
 * clause 4), the same way analyses are (`core/analyses/registry.ts`).
 *
 * An encoding is a named mapping from the measures a cell holds to what the
 * cell shows beyond its text: a swatch, a texture, a visible badge, and words a
 * screen reader hears. It never replaces the text (ADR-0010: never colour
 * alone), and it owns its legend, so switching encodings switches the legend.
 *
 * Two guarantees:
 *
 * - **Every registration declares its `texture`** (ADR-0010 clause 4,
 *   ADR-0028). The field is required by the type, so a definition without it
 *   does not compile, and `defineEncoding` refuses one at run time too, for a
 *   caller outside TypeScript. An encoding that uses no texture says so, and
 *   why, rather than saying nothing.
 * - **Nothing registers itself.** `defineEncoding` only describes;
 *   `createEncodingRegistry` is called by whoever composes the view, with the
 *   encodings it ships. Under `"sideEffects": false` a self-registering module
 *   is deleted from the bundle that needs it, with no error.
 *
 * Encodings live on the view side of ADR-0005 but hold no DOM: what they
 * return is data the matrix renders, so they are tested in plain Node.
 */
import type { MissingnessVocabulary } from '../../core/schema/missingness.js';
import type { Analysis } from '../../core/schema/analysis.js';
import type { RaterStrip } from '../../core/rater-strip.js';
import type { Reduced, ScalarValue } from '../../core/schema/values.js';
import type { Swatch, SwatchId } from './palette.js';
import type { VsupSwatchId } from './vsup.js';

/**
 * What an encoding does with the texture channel, which ADR-0028 reserves for
 * uncertainty and absence. Rendering it -- foreground SVG, `currentColor` --
 * is the matrix's; declaring it is the registration's.
 */
export type Texture =
  /** No texture, and the reason: what carries the meaning instead. */
  | { readonly channel: 'none'; readonly because: string }
  /** Hatch density, at most three levels, aligned to the suppression layers. */
  | { readonly channel: 'hatch'; readonly carries: 'confidence' | 'disagreement'; readonly levels: 1 | 2 | 3 }
  /**
   * A glyph per core missingness reason; a custom code shows its `broader`
   * ancestor's. The matrix draws it on every missing cell, under any encoding
   * (ADR-0028), so an encoding declaring it marks nothing per cell.
   */
  | { readonly channel: 'glyph'; readonly carries: 'missing-reason' };

/** What a cell shows under an encoding, beyond its text. Every field optional: no mark is a mark. */
export interface CellMark {
  /** A palette entry -- the static table's, or one the preparation adds -- whose fill and ink are the palette's. */
  readonly swatch?: SwatchId | VsupSwatchId;
  /** Hatch density, 1 (sparse) to 3 (dense), for an encoding whose texture is `hatch`. */
  readonly hatch?: 1 | 2 | 3;
  /** A short visible mark beside the value, so the encoding never rests on colour. */
  readonly badge?: string;
  /** What a screen reader hears after the value, in words: the badge's meaning, never its symbol. */
  readonly said?: string;
  /** The rater dot strip (ADR-0024): data the matrix draws, with its range-bracket form for a narrow cell. */
  readonly strip?: RaterStrip;
}

/** One line of a legend: a sample, what it means, and how many shown cells carry it. */
export interface LegendEntry {
  readonly swatch?: SwatchId | VsupSwatchId;
  readonly badge?: string;
  readonly label: string;
  readonly count?: number;
}

/** What the legend says while this encoding is active. */
export interface Legend {
  readonly title: string;
  readonly entries: readonly LegendEntry[];
  /** Sentences a ramp cannot say: what is aliased, what is left uncoloured, against what. */
  readonly notes: readonly string[];
}

/** What an encoding is prepared over: the matrix as shown. */
export interface EncodingContext {
  readonly analysis: Analysis;
  readonly measure: string;
  readonly vocabulary: MissingnessVocabulary;
  /** Shown alternatives and criteria, in shown order. */
  readonly alternatives: readonly string[];
  readonly criteria: readonly string[];
  /** The reduced cell the matrix shows. */
  readonly read: (alternativeId: string, criterionId: string) => Reduced | undefined;
  /** The same cell's reduced value for another measure the analysis records, e.g. its confidence. */
  readonly readMeasure: (measure: string, alternativeId: string, criterionId: string) => Reduced | undefined;
  /**
   * One cell's assertion set laid on `levels`, as this viewer may see it (the
   * round's redaction already applied by core), for an encoding that must not
   * reduce first (ADR-0024). Absent from a host that does not supply it.
   */
  readonly stripOf?: (alternativeId: string, criterionId: string, levels: readonly ScalarValue[]) => RaterStrip | undefined;
  /** Whether a declared block makes this cell structurally inapplicable. */
  readonly inapplicable: (alternativeId: string, criterionId: string) => boolean;
}

/** An encoding ready to mark one rendering of the matrix. */
export interface PreparedEncoding {
  readonly mark: (alternativeId: string, criterionId: string) => CellMark;
  readonly legend: Legend;
  /**
   * Swatches this preparation uses beyond the static palette, fills and inks
   * precomputed and tested at build time; the matrix adds a stylesheet for
   * them. Never computed here: the render path does no colour maths.
   */
  readonly palette?: Readonly<Record<string, Swatch>>;
  /**
   * Where a strip degrades, as a registered parameter, in `em` of the cell's
   * own text (ADR-0024). Below `bracketBelow` the dots give way to the range
   * bracket; below `hiddenBelow` the bracket gives way to the cell's text alone.
   */
  readonly strip?: StripThresholds;
}

/** Widths, in `em`, below which a strip draws its next, narrower form. */
export interface StripThresholds {
  readonly bracketBelow: number;
  readonly hiddenBelow: number;
}

/** An encoding, described. `prepare` either readies it over the shown matrix, or says why it cannot. */
export interface EncodingDefinition {
  readonly id: string;
  readonly label: string;
  readonly texture: Texture;
  readonly prepare: (context: EncodingContext) => PreparedEncoding | { readonly unavailable: string };
}

/**
 * Describe an encoding. Pure: it returns a frozen description and registers
 * nothing. Refuses a definition with no `texture`, or one that says nothing
 * about it.
 */
export function defineEncoding(definition: EncodingDefinition): EncodingDefinition {
  const problem = textureProblem((definition as { texture?: unknown }).texture);
  if (problem !== undefined) {
    throw new TypeError(`the encoding "${String(definition?.id)}" ${problem}; every encoding declares its texture (ADR-0010 clause 4).`);
  }
  return Object.freeze({ ...definition, texture: Object.freeze({ ...definition.texture }) });
}

/** A lookup over exactly the encodings a composition root chose to ship. */
export interface EncodingRegistry {
  readonly ids: readonly string[];
  get(id: string): EncodingDefinition | undefined;
}

/**
 * Assemble the encodings a view ships. Call it from the composition root, with
 * the definitions it imports; throws on a duplicate id rather than letting the
 * later one silently win, and on a definition that did not go through
 * `defineEncoding`'s texture check.
 */
export function createEncodingRegistry(definitions: readonly EncodingDefinition[]): EncodingRegistry {
  const byId = new Map<string, EncodingDefinition>();
  for (const d of definitions) {
    const problem = textureProblem((d as { texture?: unknown } | null)?.texture);
    if (problem !== undefined) throw new TypeError(`the encoding "${String(d?.id)}" ${problem}; it cannot be registered.`);
    if (byId.has(d.id)) throw new Error(`two encodings share the id "${d.id}"; ids must be unique in a registry`);
    byId.set(d.id, d);
  }
  const ids = Object.freeze([...byId.keys()]);
  return Object.freeze({ ids, get: (id: string) => byId.get(id) });
}

/** Why a texture declaration is not one, or `undefined` if it is. */
function textureProblem(texture: unknown): string | undefined {
  if (texture === null || typeof texture !== 'object') return 'declares no texture';
  const t = texture as Record<string, unknown>;
  switch (t['channel']) {
    case 'none':
      return typeof t['because'] === 'string' && t['because'].trim() !== ''
        ? undefined : 'declares no texture without saying why';
    case 'hatch':
      if (t['carries'] !== 'confidence' && t['carries'] !== 'disagreement') return 'hatches something other than confidence or disagreement';
      return t['levels'] === 1 || t['levels'] === 2 || t['levels'] === 3 ? undefined : 'declares a hatch with other than 1 to 3 levels';
    case 'glyph':
      return t['carries'] === 'missing-reason' ? undefined : 'uses glyphs for something other than the missingness reason';
    default:
      return `declares an unknown texture channel ${JSON.stringify(t['channel'])}`;
  }
}

/** The texture declaration, in words, for the legend. */
export function describeTexture(texture: Texture): string {
  switch (texture.channel) {
    case 'none': return `No texture of its own: ${texture.because}`;
    case 'hatch': return `Hatch density carries ${texture.carries}, in ${texture.levels} level${texture.levels === 1 ? '' : 's'}.`;
    case 'glyph': return 'A glyph shape carries the reason a cell is missing.';
  }
}
