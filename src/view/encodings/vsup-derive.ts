/**
 * Builds the value-suppressing palette (ADR-0010 clauses 2, 3, 5 and 6): every
 * node of every supported tree, per theme, a fill and the ink drawn on it.
 * Build-time only: `scripts/emit-vsup-palette.ts` writes the result to
 * `vsup-palette.ts`, and `tests/vsup.test.ts` asserts that file equals this
 * derivation and that every entry is legible. The render path reads the table.
 *
 * Each node's colour is the reference implementation's `usl` mode: sample the
 * theme's value ramp at the group's midpoint, then interpolate in CIELAB toward
 * the **theme surface** -- the colour the cell actually paints, never a
 * hardcoded white (deviation 2) -- by the layer's representative uncertainty,
 * and gamut-clamp before measuring anything.
 *
 * The ramps reserve lightness headroom (clause 5), because the suppression
 * channel is lightness: neither ends at a very light or a very dark colour.
 * They are also chosen so one ink clears 4.5:1 on every colour a node can
 * take: the light theme's stays above the lightness where dark ink fails and
 * suppression only lightens it further; the dark theme's stays below where
 * light ink fails and suppression only darkens it. A ramp crossing the middle
 * would put some arity's midpoint where neither ink passes.
 */
import { THEMES, type Theme } from '../theme.js';
import { deltaE, interpolateLab, labToHex, pickInk, type Lab } from './colour.js';
import type { Swatch } from './palette.js';
import { groupMidpoint, layerUncertainty, mergeTree, vsupSwatchId, type MergeTree } from './vsup.js';

export interface VsupSpec {
  /** Score arities a tree is built for, inclusive. */
  readonly scoreLevels: readonly [min: number, max: number];
  /** Confidence arities, inclusive. At most four, so the hatch needs at most three levels above the leaves. */
  readonly confidenceLevels: readonly [min: number, max: number];
  /** Per theme, the value ramp worst → best, as CIELAB stops sampled evenly. */
  readonly ramp: Readonly<Record<Theme, readonly Lab[]>>;
  /** Per theme, the colour suppression moves toward: the cell surface. */
  readonly surface: Readonly<Record<Theme, string>>;
  /** Per theme, the inks a node may take, gated on WCAG and tie-broken on APCA. */
  readonly inks: Readonly<Record<Theme, readonly string[]>>;
  readonly suppressionSpace: 'lab';
  /** The least a maximally uncertain colour may differ from the surface (ΔE*76), so it never reads as an empty cell. */
  readonly rootDistinctFromSurface: number;
}

export const VSUP_SPEC: VsupSpec = Object.freeze({
  scoreLevels: [2, 7],
  confidenceLevels: [2, 4],
  ramp: {
    // Pale yellow-green → green-teal → blue, L* 92 → 60: dark ink throughout.
    light: [[92, -10, 42], [79, -32, 14], [60, -6, -38]],
    // Olive-brown → teal → blue, L* 27 → 43: light ink throughout.
    dark: [[27, 2, 22], [34, -22, 4], [43, -2, -40]],
  },
  surface: { light: THEMES.light.surface, dark: THEMES.dark.surface },
  inks: { light: [THEMES.light.ink, THEMES.light.inkInverse], dark: [THEMES.dark.ink, THEMES.dark.inkInverse] },
  suppressionSpace: 'lab',
  rootDistinctFromSurface: 5,
} as const);

/** The ramp at `t` in [0, 1], interpolated in CIELAB between evenly spaced stops. */
export function sampleRamp(stops: readonly Lab[], t: number): string {
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const [a, b] = [stops[i]!, stops[i + 1]!];
  const f = x - i;
  return labToHex([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
}

/** One node's fill on one theme: the ramp at the group's midpoint, suppressed toward the surface. */
export function nodeFill(spec: VsupSpec, theme: Theme, tree: MergeTree, layer: number, node: number): string {
  const value = sampleRamp(spec.ramp[theme], groupMidpoint(tree.layers[layer]![node]!, tree.scoreLevels));
  return interpolateLab(value, spec.surface[theme], layerUncertainty(layer, tree.confidenceLevels));
}

/** Every tree the spec supports. */
export function vsupTrees(spec: VsupSpec = VSUP_SPEC): MergeTree[] {
  const trees: MergeTree[] = [];
  for (let k = spec.scoreLevels[0]; k <= spec.scoreLevels[1]; k++) {
    for (let m = spec.confidenceLevels[0]; m <= spec.confidenceLevels[1]; m++) trees.push(mergeTree(k, m));
  }
  return trees;
}

/**
 * The whole palette, keyed by `vsupSwatchId`. Throws, naming the node, when a
 * fill admits no ink (move the ramp, never the threshold) or a root colour
 * sits too close to the surface to be told from an empty cell.
 */
export function deriveVsupPalette(spec: VsupSpec = VSUP_SPEC): Record<string, Swatch> {
  const palette: Record<string, Swatch> = {};
  const problems: string[] = [];
  for (const tree of vsupTrees(spec)) {
    tree.layers.forEach((groups, layer) => groups.forEach((_, node) => {
      const id = vsupSwatchId(tree.scoreLevels, tree.confidenceLevels, layer, node);
      const pair = (theme: Theme) => {
        const fill = nodeFill(spec, theme, tree, layer, node);
        const ink = pickInk(fill, spec.inks[theme]);
        if (!ink) problems.push(`${id} (${theme}): no ink clears 4.5:1 on ${fill}`);
        if (layer === 0 && deltaE(fill, spec.surface[theme]) < spec.rootDistinctFromSurface) {
          problems.push(`${id} (${theme}): the root ${fill} is within ΔE ${spec.rootDistinctFromSurface} of the surface`);
        }
        return [fill, ink?.colour ?? ''] as const;
      };
      palette[id] = { light: pair('light'), dark: pair('dark') };
    }));
  }
  if (problems.length > 0) throw new Error(`the value-suppressing palette is not legible:\n  ${problems.join('\n  ')}`);
  return palette;
}


/** The source of `vsup-palette.ts`, one swatch per line; the drift test compares against this. */
export function renderVsupPaletteModule(spec: VsupSpec = VSUP_SPEC): string {
  const lines = Object.entries(deriveVsupPalette(spec)).map(([id, s]) =>
    `  '${id}': { light: ['${s.light[0]}', '${s.light[1]}'], dark: ['${s.dark[0]}', '${s.dark[1]}'] },`);
  return `/**
 * GENERATED by \`scripts/emit-vsup-palette.ts\` from \`vsup-derive.ts\`; do not edit.
 *
 * The value-suppressing palette (ADR-0010 clauses 2, 3, 6): per merge-tree node
 * \`vsup-<k>x<m>-<layer>-<node>\`, the light- and dark-theme fill and the ink
 * that clears 4.5:1 on it. \`tests/vsup.test.ts\` asserts this file equals the
 * derivation and that every entry is legible.
 */
import type { Swatch } from './palette.js';

export const VSUP_PALETTE: Readonly<Record<string, Swatch>> = /* @__PURE__ */ Object.freeze({
${lines.join('\n')}
});
`;
}
