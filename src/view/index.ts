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
export { Matrix, TEXT_ONLY, type MatrixViewProps } from './matrix.js';
export type { MatrixProps, MatrixPropsUpdate, MountMatrixProps } from './props.js';
