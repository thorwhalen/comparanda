/**
 * comparanda/view -- rendering and interaction.
 *
 * Depends on the core; nothing in the core depends on this. Kept as a separate
 * entry point so a core-only consumer never pays for view code, which
 * `scripts/check-boundaries.ts` verifies against the real build.
 *
 * The public surface is `mountMatrix(el, props) => { update, destroy }`
 * (ADR-0017 clause 5) and the `MatrixProps` contract it takes (ADR-0032).
 */
export { mountMatrix, type MatrixHandle, type MountOptions } from './mount.js';
export { Matrix, TEXT_ONLY, type CellState, type MatrixViewProps } from './matrix.js';
export type { MatrixProps, MatrixPropsUpdate, MountMatrixProps } from './props.js';
export {
  createEncodingRegistry, defineEncoding, describeTexture,
  type CellMark, type EncodingContext, type EncodingDefinition, type EncodingRegistry,
  type Legend, type LegendEntry, type PreparedEncoding, type Texture,
} from './encodings/registry.js';
export {
  categorical, consensusSuppressed, datum, disagreement, disagreementSpread, missingness,
  SHIPPED_ENCODINGS, textOnly, uncertaintySuppressed, value,
} from './encodings/shipped.js';
export { PALETTE, type Swatch, type SwatchId } from './encodings/palette.js';
export { mergeTree, type MergeTree, type VsupSwatchId } from './encodings/vsup.js';
