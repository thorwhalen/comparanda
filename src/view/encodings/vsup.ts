/**
 * The value-suppressing uncertainty palette's structure (ADR-0010 clauses 2
 * and 3; Correll, Moritz & Heer, CHI 2018): which colour a (score,
 * confidence) pair takes, as a node of a tree. No colour maths here -- the
 * colours of every node, per theme, are precomputed in `vsup-palette.ts` by
 * `vsup-derive.ts`, and their legibility is a test.
 *
 * **The tree is ordinal (deviation 1).** The reference implementation bins a
 * continuous value uniformly; a score here has `k` declared levels and
 * confidence `m`. So the leaf layer is exactly the `k` levels, and each layer
 * above merges adjacent groups of the one below until the root is one group.
 * Layer `i` has `round(1 + (k − 1) · i / (m − 1))` groups, and a layer's groups
 * are runs of the layer below's, as even as they can be, with the larger runs
 * at the ends: for `k = 5, m = 3`, `{1}{2}{3}{4}{5}` → `{1,2}{3}{4,5}` →
 * `{1,2,3,4,5}`, nine colours. Every colour is a nameable set of levels, which
 * is what lets the legend say "1 or 2, medium confidence" in words.
 *
 * **Layer 0 is the least confident.** We store confidence, not uncertainty:
 * `û = 1 − normalise(confidence)`, and the layer is the reference
 * implementation's lookup over `û`. Getting that backwards inverts the
 * encoding and still looks plausible, so the corners are unit-tested.
 */

/**
 * The score arities the palette is built for, inclusive. Seven was the first
 * ambition; the colour-vision-deficiency gate (#104, `tests/browser/cvd.test.ts`)
 * found that beyond five steps neighbouring groups collapse for a tritan reader
 * on the dark theme, and the fix for collapsing steps is fewer steps.
 */
export const SCORE_LEVELS = [2, 5] as const;

/** A run of adjacent levels, by index into the scale's levels: `[first, last]`, inclusive. */
export type LevelGroup = readonly [first: number, last: number];

/** The merge tree: `layers[i]` partitions the `k` levels; `layers[0]` is one group, `layers[m − 1]` is `k` singletons. */
export interface MergeTree {
  readonly scoreLevels: number;
  readonly confidenceLevels: number;
  readonly layers: readonly (readonly LevelGroup[])[];
}

/** `n` items in `p` contiguous runs as even as they can be, the extra items going to the ends first. */
function runs(n: number, p: number): number[] {
  const sizes = Array.from({ length: p }, () => Math.floor(n / p));
  const order = Array.from({ length: p }, (_, i) => (i % 2 === 0 ? i / 2 : p - 1 - (i - 1) / 2));
  for (let r = 0; r < n % p; r++) sizes[order[r]!]! += 1;
  return sizes;
}

/** The ordinal merge tree for `k` score levels and `m` confidence levels. */
export function mergeTree(k: number, m: number): MergeTree {
  if (!Number.isInteger(k) || k < 2) throw new RangeError(`a merge tree needs at least two score levels; got ${k}`);
  if (!Number.isInteger(m) || m < 2) throw new RangeError(`a merge tree needs at least two confidence levels; got ${m}`);
  const layers: LevelGroup[][] = [Array.from({ length: k }, (_, i) => [i, i] as const)];
  for (let i = m - 2; i >= 0; i--) {
    const below = layers[0]!;
    let at = 0;
    layers.unshift(runs(below.length, Math.round(1 + ((k - 1) * i) / (m - 1))).map((size) => {
      const group = [below[at]![0], below[at + size - 1]![1]] as const;
      at += size;
      return group;
    }));
  }
  return Object.freeze({ scoreLevels: k, confidenceLevels: m, layers: Object.freeze(layers.map((l) => Object.freeze(l))) });
}

const EPS = 1e-9;

/**
 * The layer for a normalised uncertainty `û` in [0, 1] (1 = least confident),
 * as the reference implementation looks it up: walk up while `û` is below the
 * layer's threshold, capped at the leaves.
 */
export function layerFor(uncertainty: number, layers: number): number {
  let i = 0;
  while (i < layers - 1 && uncertainty < 1 - (i + 1) / layers - EPS) i++;
  return i;
}

/** The representative uncertainty of a layer, `1 − (i + 1) / L`: the root's is `(L − 1) / L`, never 1. */
export function layerUncertainty(layer: number, layers: number): number {
  return 1 - (layer + 1) / layers;
}

/** A group's position on the value ramp: the midpoint of its levels' bins, 0 worst to 1 best. */
export function groupMidpoint([first, last]: LevelGroup, k: number): number {
  return (first + last + 1) / (2 * k);
}

export type VsupSwatchId = `vsup-${number}x${number}-${number}-${number}`;

/** The palette entry for node `node` of layer `layer` in the `k` × `m` tree. */
export function vsupSwatchId(k: number, m: number, layer: number, node: number): VsupSwatchId {
  return `vsup-${k}x${m}-${layer}-${node}`;
}

/** Where a score level and a confidence lie in their tree: the layer, and the node within it. */
export function nodeOf(tree: MergeTree, level: number, layer: number): number {
  return tree.layers[layer]!.findIndex(([first, last]) => level >= first && level <= last);
}
