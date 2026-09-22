/**
 * Seriation: optimal leaf ordering over a missingness-aware Gower distance
 * (#80, ADR-0025).
 *
 * One automatic ordering, per axis, and a plain single-criterion sort as the
 * *same code path* on a one-feature input rather than a second implementation.
 *
 * The four rules that decide everything here, all from ADR-0025:
 *
 * 1. **Ordinal levels are scored by their declared level index**, normalised to
 *    [0,1] -- never by sample rank. Sample rank is non-local: the distance
 *    between two alternatives would change when a third is added, so an order
 *    would silently re-derive itself differently in a document people re-open.
 *    The equal-spacing assumption that buys is real, and is returned in
 *    `assumptions` for display rather than hidden.
 * 2. **Missingness enters through Gower's delta mechanism** --
 *    `S_ij = sum_k s_ijk * d_ijk / sum_k d_ijk` -- keyed on ADR-0009's
 *    `structural` flag, never on a literal reason code. Two items a criterion
 *    does not apply to *are* alike, so structural agreement scores as
 *    similarity (`structural-matches`); a contingent blank drops out of both
 *    sums, because nobody-has-looked-yet is not evidence of similarity.
 * 3. **A `minOverlap` guard parks, visibly.** Delta-normalisation silently
 *    equates a distance computed from twelve comparisons with one computed from
 *    two. An item with too few comparable features is excluded from the
 *    ordering and returned parked, with its count -- a qualified "we could not
 *    place this" beats a confident wrong position.
 * 4. **Pins and locked runs are inputs**, re-applied on every run, never a
 *    permutation laid over the result: that is what makes a manual adjustment
 *    survive a re-run instead of being discarded by it.
 *
 * Nothing here runs on load: it is a function, and no module calls it.
 */
import type { Analysis } from '../schema/analysis.js';
import { measurementFor } from '../schema/structure.js';
import { isOrdered, type Measurement } from '../schema/measurement.js';
import type { OrderProvenance } from '../view-state.js';
import { makeReadings, widenedCells, type Reading } from './readings.js';
import type { AnalysisResult } from './registry.js';

/** What every seriation result rests on, carried with it (#87, ADR-0015). */
export const SERIATION_ASSUMPTIONS: readonly [string, ...string[]] = Object.freeze([
  'Ordinal levels are scored by their declared level index, normalised to [0,1]: the levels are ' +
    'treated as equally spaced. That assumption belongs to this ordering heuristic alone and licenses ' +
    'no average anywhere else (ADR-0025).',
  'Similarity is Gower\'s, averaged over the criteria a pair could actually be compared on. Two items ' +
    'a criterion does not apply to count as alike on it; a cell nobody has assessed drops out of the ' +
    'average rather than counting as agreement.',
  'An item with fewer comparable criteria than the minimum overlap is parked rather than placed: a ' +
    'distance from two comparisons is not the same evidence as one from twelve.',
  'Pins and locked runs are inputs to the run, so a manual arrangement survives a re-run.',
  'Ordering the criteria axis compares two criteria through each alternative\'s position on its own ' +
    'declared scale; two categorical cells from different criteria are not comparable and drop out.',
] as const);

/** ADR-0025's two missingness policies, and only those. */
export type MissingPolicy = 'structural-matches' | 'skip-all';

/** The three linkages ADR-0025 measures against each other. */
export type Linkage = 'single' | 'average' | 'complete';
const LINKAGES: readonly Linkage[] = Object.freeze(['single', 'average', 'complete'] as const);

export interface SeriationOptions {
  measure: string;
  /** Which axis to order. Each axis is seriated independently (ADR-0025). */
  axis?: 'alternatives' | 'criteria';
  alternativeIds?: readonly string[];
  criterionIds?: readonly string[];
  /** Default `structural-matches`: the structural row is a derivation, abandoning it is a preference. */
  missingPolicy?: MissingPolicy;
  /** Minimum comparable features before an item is placed rather than parked. */
  minOverlap?: number;
  /** Pins and locked runs, as inputs. */
  constraints?: { pins?: readonly { id: string; position: number }[]; lockedRuns?: readonly (readonly string[])[] };
  /** Above this many items, only `complete` linkage is tried and leaf order is refined greedily. */
  sizeLimit?: number;
  /**
   * A single-criterion sort: the same path on a one-feature input, oriented by
   * the criterion's declared direction of preference.
   */
  sortBy?: { criterionId: string; direction: 'best-first' | 'worst-first' };
  /** Timestamp for the provenance record; omitted rather than invented. */
  at?: string;
}

export interface ParkedItem {
  id: string;
  /** How many features it could be compared on. */
  comparable: number;
  reason: string;
}

export interface ExcludedFeature {
  /** The criterion (or, on the criteria axis, the alternative) left out. */
  featureId: string;
  reason: 'no-measurement' | 'unscoreable-level';
  message: string;
}

export interface SeriationResult extends AnalysisResult {
  axis: 'alternatives' | 'criteria';
  /** The ordered ids, with parked items appended at the end, in their input order. */
  order: string[];
  /** Items the minimum-overlap guard would not place. Returned, never dropped. */
  parked: ParkedItem[];
  /** Features that could not enter the distance, each with its reason (ADR-0025 amendment). */
  excludedFeatures: ExcludedFeature[];
  /** The linkage actually used, and the path length it achieved. */
  linkage: Linkage;
  pathLength: number;
  /** Path length per linkage tried, so "measured, not guessed" is checkable. */
  pathLengths: Partial<Record<Linkage, number>>;
  minOverlap: number;
  missingPolicy: MissingPolicy;
  /** The distance matrix and, beside it, how many comparisons each pair rested on. */
  distances: { ids: string[]; distance: number[][]; overlap: number[][] };
  /** Ready to store on an `AxisOrder` (ADR-0025, ADR-0007). */
  provenance: OrderProvenance;
  widenedByDisclosure: number;
  notes: string[];
}

/** A feature's scale, prepared once: how to score one cell into [0,1], or a category. */
interface Feature {
  id: string;
  /** The criterion whose measurement scores this cell. */
  criterionId: string;
  m: Measurement;
}

/** A cell, read and scored: a number in [0,1], a category, a structural absence, or nothing. */
type Scored =
  | { kind: 'number'; value: number }
  | { kind: 'category'; value: string }
  | { kind: 'structural' }
  | { kind: 'none' };

/** Score one reading into [0,1] by its criterion's declared scale -- never by sample rank. */
function score(r: Reading, m: Measurement): Scored {
  if (r.kind === 'structural') return { kind: 'structural' };
  if (r.kind === 'blank') return { kind: 'none' };
  const v = r.value;
  if (m.levels && m.levels.length > 1) {
    const i = m.levels.findIndex((l) => l === v);
    // The declared index, normalised. `cluster::daisy`'s scoring, and the one
    // ADR-0025 requires over sample rank.
    if (i >= 0 && isOrdered(m.level)) return { kind: 'number', value: i / (m.levels.length - 1) };
    if (i >= 0) return { kind: 'category', value: String(v) };
  }
  if (typeof v === 'number' && m.range && m.range.max > m.range.min) {
    const u = (v - m.range.min) / (m.range.max - m.range.min);
    return { kind: 'number', value: Math.min(1, Math.max(0, u)) };
  }
  if (isOrdered(m.level)) return { kind: 'none' };
  return { kind: 'category', value: String(v) };
}

/** Whether a criterion can enter the distance at all, and why not when it cannot. */
function featureProblem(m: Measurement | undefined, id: string): ExcludedFeature | undefined {
  if (!m) {
    return {
      featureId: id, reason: 'no-measurement',
      message: `no measurement is declared for this measure on "${id}", so it cannot be scored`,
    };
  }
  const scoreable = (m.levels && m.levels.length > 1) || (m.range && m.range.max > m.range.min) || !isOrdered(m.level);
  if (!scoreable) {
    return {
      featureId: id, reason: 'unscoreable-level',
      message: `"${id}" is ordered but declares neither ordered levels nor a usable range, so its values ` +
        'have no position to compare. Excluded and named rather than degraded to nominal (ADR-0025 amendment).',
    };
  }
  return undefined;
}

/** Gower similarity of two scored cells, with the delta that says whether it counted. */
function similarity(x: Scored, y: Scored, policy: MissingPolicy): { s: number; delta: number } {
  if (x.kind === 'structural' && y.kind === 'structural') {
    // Two items a criterion does not apply to are alike in a way readers care
    // about: it is what makes inapplicable blocks cluster and become visible.
    return policy === 'structural-matches' ? { s: 1, delta: 1 } : { s: 0, delta: 0 };
  }
  if (x.kind === 'structural' || y.kind === 'structural') {
    const other = x.kind === 'structural' ? y : x;
    if (policy === 'structural-matches' && other.kind !== 'none') return { s: 0, delta: 1 };
    return { s: 0, delta: 0 };
  }
  if (x.kind === 'none' || y.kind === 'none') return { s: 0, delta: 0 };
  if (x.kind === 'number' && y.kind === 'number') return { s: 1 - Math.abs(x.value - y.value), delta: 1 };
  if (x.kind === 'category' && y.kind === 'category') return { s: x.value === y.value ? 1 : 0, delta: 1 };
  // A category against a number: different kinds of answer, nothing to compare.
  return { s: 0, delta: 0 };
}

/** Agglomerative clustering. Returns the root of a binary dendrogram over indices. */
type Node = { kind: 'leaf'; index: number } | { kind: 'split'; left: Node; right: Node; height: number };

function cluster(d: number[][], linkage: Linkage): Node | undefined {
  const n = d.length;
  if (n === 0) return undefined;
  const nodes: (Node | undefined)[] = Array.from({ length: n }, (_, i) => ({ kind: 'leaf', index: i }) as Node);
  const members: number[][] = Array.from({ length: n }, (_, i) => [i]);
  const alive = new Set(nodes.map((_, i) => i));

  const between = (a: readonly number[], b: readonly number[]): number => {
    let best = linkage === 'single' ? Infinity : linkage === 'complete' ? -Infinity : 0;
    for (const i of a) {
      for (const j of b) {
        const v = d[i]![j]!;
        if (linkage === 'single') best = Math.min(best, v);
        else if (linkage === 'complete') best = Math.max(best, v);
        else best += v;
      }
    }
    return linkage === 'average' ? best / (a.length * b.length) : best;
  };

  while (alive.size > 1) {
    let bestPair: [number, number] | undefined;
    let bestValue = Infinity;
    const ids = [...alive].sort((x, y) => x - y);
    for (let a = 0; a < ids.length; a += 1) {
      for (let b = a + 1; b < ids.length; b += 1) {
        const v = between(members[ids[a]!]!, members[ids[b]!]!);
        // Strict `<`, and indices scanned in order, so ties resolve the same
        // way on every run: an arrangement must be reproducible.
        if (v < bestValue) { bestValue = v; bestPair = [ids[a]!, ids[b]!]; }
      }
    }
    const [i, j] = bestPair!;
    nodes[i] = { kind: 'split', left: nodes[i]!, right: nodes[j]!, height: bestValue };
    members[i] = [...members[i]!, ...members[j]!];
    alive.delete(j);
  }
  return nodes[[...alive][0]!]!;
}

function leavesOf(node: Node, out: number[] = []): number[] {
  if (node.kind === 'leaf') out.push(node.index);
  else { leavesOf(node.left, out); leavesOf(node.right, out); }
  return out;
}

/** Sum of distances between adjacent leaves: the Hamiltonian path length OLO minimises. */
function pathLengthOf(order: readonly number[], d: number[][]): number {
  let total = 0;
  for (let i = 1; i < order.length; i += 1) total += d[order[i - 1]!]![order[i]!]!;
  return total;
}

/**
 * Optimal leaf ordering (Bar-Joseph et al.): the best ordering *subject to* the
 * dendrogram, by dynamic programming over subtree boundary leaves.
 */
function optimalLeafOrder(node: Node, d: number[][]): number[] {
  interface Table { leaves: number[]; best: Map<string, { cost: number; order: number[] }> }
  const key = (u: number, w: number) => `${u}|${w}`;

  const solve = (n: Node): Table => {
    if (n.kind === 'leaf') {
      return { leaves: [n.index], best: new Map([[key(n.index, n.index), { cost: 0, order: [n.index] }]]) };
    }
    const L = solve(n.left);
    const R = solve(n.right);
    const best = new Map<string, { cost: number; order: number[] }>();
    const consider = (A: Table, B: Table) => {
      for (const u of A.leaves) {
        for (const w of B.leaves) {
          let bestHere: { cost: number; order: number[] } | undefined;
          for (const m of A.leaves) {
            const left = A.best.get(key(u, m));
            if (!left) continue;
            for (const k of B.leaves) {
              const right = B.best.get(key(k, w));
              if (!right) continue;
              const cost = left.cost + d[m]![k]! + right.cost;
              if (!bestHere || cost < bestHere.cost) {
                bestHere = { cost, order: [...left.order, ...right.order] };
              }
            }
          }
          if (bestHere) {
            const existing = best.get(key(u, w));
            if (!existing || bestHere.cost < existing.cost) best.set(key(u, w), bestHere);
          }
        }
      }
    };
    consider(L, R);
    consider(R, L);
    return { leaves: [...L.leaves, ...R.leaves], best };
  };

  const table = solve(node);
  let bestOrder: number[] | undefined;
  let bestCost = Infinity;
  for (const { cost, order } of table.best.values()) {
    if (cost < bestCost - 1e-12) { bestCost = cost; bestOrder = order; }
  }
  return bestOrder ?? leavesOf(node);
}

/** Above the size limit: the dendrogram's own leaf order, improved by adjacent-pair flips. */
function greedyLeafOrder(node: Node, d: number[][]): number[] {
  const order = leavesOf(node);
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i + 1 < order.length; i += 1) {
      const swapped = [...order];
      [swapped[i], swapped[i + 1]] = [swapped[i + 1]!, swapped[i]!];
      if (pathLengthOf(swapped, d) < pathLengthOf(order, d) - 1e-12) {
        order.splice(0, order.length, ...swapped);
        improved = true;
      }
    }
  }
  return order;
}

/** Seriate one axis. Pure, and never called on load: a caller asks for it. */
export function seriate(a: Analysis, opts: SeriationOptions): SeriationResult {
  const axis = opts.axis ?? 'alternatives';
  const policy = opts.missingPolicy ?? 'structural-matches';
  const sizeLimit = opts.sizeLimit ?? 40;
  const notes: string[] = [];
  const excludedFeatures: ExcludedFeature[] = [];

  const altIds = (opts.alternativeIds ?? a.alternatives.filter((x) => !x.tombstoned).map((x) => x.id)).slice();
  const allCritIds = (opts.criterionIds ?? a.criteria.filter((x) => !x.tombstoned).map((x) => x.id)).slice();
  const critIds = opts.sortBy ? allCritIds.filter((c) => c === opts.sortBy!.criterionId) : allCritIds;
  if (opts.sortBy && critIds.length === 0) {
    throw new Error(`cannot sort by "${opts.sortBy.criterionId}": it is not a criterion in scope`);
  }

  // Features: what each item is compared *on*. On the alternatives axis they are
  // the criteria; on the criteria axis they are the alternatives, each cell
  // still scored by its own criterion's declared scale.
  const usableCriteria: { id: string; m: Measurement }[] = [];
  for (const cid of critIds) {
    const crit = a.criteria.find((c) => c.id === cid);
    const m = crit ? measurementFor(crit, opts.measure) : undefined;
    const problem = featureProblem(m, cid);
    if (problem) { excludedFeatures.push(problem); continue; }
    usableCriteria.push({ id: cid, m: m! });
  }

  const read = makeReadings(a, opts.measure);
  const items = axis === 'alternatives' ? altIds : usableCriteria.map((c) => c.id);
  const features: Feature[] = axis === 'alternatives'
    ? usableCriteria.map((c) => ({ id: c.id, criterionId: c.id, m: c.m }))
    : altIds.map((id) => ({ id, criterionId: id, m: usableCriteria[0]?.m as Measurement }));

  /** The scored cell for (item, feature), whichever axis is being ordered. */
  const cellFor = (item: string, feature: Feature): Scored => {
    if (axis === 'alternatives') return score(read(item, feature.criterionId, feature.m), feature.m);
    const crit = usableCriteria.find((c) => c.id === item)!;
    return score(read(feature.id, item, crit.m), crit.m);
  };

  const scored: Scored[][] = items.map((item) => features.map((f) => cellFor(item, f)));

  // How many features each item could be compared on at all. Local to the item,
  // so adding another item never changes it.
  const comparable = scored.map((row) => row.filter((c) => c.kind === 'number' || c.kind === 'category' ||
    (c.kind === 'structural' && policy === 'structural-matches')).length);

  const featureCount = features.length;
  const defaultOverlap = Math.min(featureCount, Math.max(3, Math.ceil(0.3 * featureCount)));
  const minOverlap = opts.minOverlap ?? defaultOverlap;
  if (opts.minOverlap === undefined && featureCount > 0 && defaultOverlap < Math.max(3, Math.ceil(0.3 * featureCount))) {
    notes.push(
      `minOverlap is ${defaultOverlap}, the number of usable features: ADR-0025's default of ` +
      `max(3, ceil(0.3 x n)) would park every item on a matrix this narrow, which reports nothing rather ` +
      'than reporting something qualified.',
    );
  }

  const placedIndices: number[] = [];
  const parked: ParkedItem[] = [];
  items.forEach((id, i) => {
    if (comparable[i]! >= minOverlap && comparable[i]! > 0) placedIndices.push(i);
    else {
      parked.push({
        id, comparable: comparable[i]!,
        reason: `comparable on ${comparable[i]} feature(s), below the minimum overlap of ${minOverlap}; ` +
          'parked rather than placed on a distance nobody could stand behind',
      });
    }
  });

  // Gower distance over the placed items, with the per-pair comparison count
  // carried out rather than discarded.
  const n = placedIndices.length;
  const distance: number[][] = Array.from({ length: n }, () => Array<number>(n).fill(0));
  const overlap: number[][] = Array.from({ length: n }, () => Array<number>(n).fill(0));
  for (let x = 0; x < n; x += 1) {
    for (let y = x + 1; y < n; y += 1) {
      let sum = 0;
      let deltas = 0;
      for (let f = 0; f < features.length; f += 1) {
        const { s, delta } = similarity(scored[placedIndices[x]!]![f]!, scored[placedIndices[y]!]![f]!, policy);
        sum += s * delta;
        deltas += delta;
      }
      // No comparison possible: maximally distant, and the overlap says why.
      const d = deltas === 0 ? 1 : 1 - sum / deltas;
      distance[x]![y] = d; distance[y]![x] = d;
      overlap[x]![y] = deltas; overlap[y]![x] = deltas;
    }
  }

  // Locked runs collapse to one item, so the algorithm never splits them, and
  // are re-expanded afterwards (ADR-0025).
  const lockedRuns = (opts.constraints?.lockedRuns ?? [])
    .map((run) => run.filter((id) => placedIndices.some((i) => items[i] === id)))
    .filter((run) => run.length > 1);
  const indexOfPlaced = new Map(placedIndices.map((orig, i) => [items[orig]!, i]));
  const runOf = new Map<number, number>();
  lockedRuns.forEach((run, r) => { for (const id of run) runOf.set(indexOfPlaced.get(id)!, r); });

  const units: number[][] = [];
  const seen = new Set<number>();
  for (let i = 0; i < n; i += 1) {
    if (seen.has(i)) continue;
    const r = runOf.get(i);
    if (r === undefined) { units.push([i]); seen.add(i); continue; }
    const members = lockedRuns[r]!.map((id) => indexOfPlaced.get(id)!);
    for (const m of members) seen.add(m);
    units.push(members);
  }

  // A collapsed run is represented by its endpoints: the distance to a unit is
  // the smaller of the distances to the two ends.
  const unitDistance: number[][] = units.map((u, i) => units.map((v, j) => {
    if (i === j) return 0;
    const ends = (m: number[]) => [m[0]!, m[m.length - 1]!];
    let best = Infinity;
    for (const p of ends(u)) for (const q of ends(v)) best = Math.min(best, distance[p]![q]!);
    return best;
  }));

  const pathLengths: Partial<Record<Linkage, number>> = {};
  let chosen: { linkage: Linkage; order: number[]; length: number } | undefined;
  const tried: readonly Linkage[] = units.length > sizeLimit ? ['complete'] : LINKAGES;
  if (units.length > sizeLimit) {
    notes.push(
      `${units.length} units is above the size limit of ${sizeLimit}: only complete linkage was tried, and ` +
      'the leaf order was refined greedily rather than by the exact O(n^3) dynamic program.',
    );
  }
  for (const linkage of tried) {
    const root = cluster(unitDistance, linkage);
    if (!root) break;
    const order = units.length > sizeLimit ? greedyLeafOrder(root, unitDistance) : optimalLeafOrder(root, unitDistance);
    const length = pathLengthOf(order, unitDistance);
    pathLengths[linkage] = length;
    // Strictly lower, so a tie keeps the earlier linkage: the same document must
    // arrange identically twice.
    if (!chosen || length < chosen.length - 1e-12) chosen = { linkage, order, length };
  }

  // Re-expand each run in the order it was locked in. `OrderConstraints` says a
  // locked run is "kept contiguous and in this order", so the run's own
  // direction is the user's input too, not something the run may flip.
  const expanded: number[] = [];
  for (const u of chosen?.order ?? units.map((_, i) => i)) expanded.push(...units[u]!);

  let order = expanded.map((i) => items[placedIndices[i]!]!);

  // A single-criterion sort is this same path; only the orientation is the
  // sort's own, from the criterion's declared direction of preference.
  if (opts.sortBy) {
    const crit = usableCriteria[0];
    const value = (id: string) => {
      const c = scored[items.indexOf(id)!]![0]!;
      return c.kind === 'number' ? c.value : undefined;
    };
    const decreasing = crit?.m.preference === 'decreasing';
    const bestFirst = opts.sortBy.direction === 'best-first';
    const first = value(order[0] ?? '');
    const last = value(order[order.length - 1] ?? '');
    if (first !== undefined && last !== undefined && first !== last) {
      // "Best" is the high end unless the criterion says lower is better.
      const highFirst = bestFirst !== decreasing;
      if ((first < last) === highFirst) order = [...order].reverse();
    }
  }

  const provenance: OrderProvenance = opts.sortBy
    ? {
      kind: 'sorted', criterionId: opts.sortBy.criterionId, measure: opts.measure,
      direction: opts.sortBy.direction, ...(opts.at === undefined ? {} : { at: opts.at }),
    }
    : {
      kind: 'seriated',
      method: units.length > sizeLimit ? 'hierarchical+greedy-leaf-order' : 'olo-hierarchical',
      linkage: chosen?.linkage ?? 'complete',
      measure: opts.measure,
      distance: `gower/${policy}`,
      missingPolicy: policy,
      minOverlap,
      pathLength: chosen?.length ?? 0,
      parked: parked.map((p) => p.id),
      params: {
        sizeLimit,
        pathLengths,
        pins: (opts.constraints?.pins ?? []).map((p) => ({ ...p })),
        lockedRuns: lockedRuns.map((r) => [...r]),
        excludedFeatures: excludedFeatures.map((e) => e.featureId),
      },
      ...(opts.at === undefined ? {} : { at: opts.at }),
    };

  // Pins are re-applied on every run, from the same input, so a manual
  // arrangement survives re-running rather than being discarded by it.
  const pins = (opts.constraints?.pins ?? []).filter((p) => order.includes(p.id));
  if (pins.length > 0) {
    const rest = order.filter((id) => !pins.some((p) => p.id === id));
    const placed: (string | undefined)[] = Array.from({ length: order.length }, () => undefined);
    for (const pin of [...pins].sort((x, y) => x.position - y.position)) {
      let at = Math.min(Math.max(0, Math.trunc(pin.position)), order.length - 1);
      while (placed[at] !== undefined) at = (at + 1) % order.length;
      placed[at] = pin.id;
    }
    let next = 0;
    order = placed.map((id) => id ?? rest[next++]!);
    notes.push(`${pins.length} pin(s) were applied as inputs to this run; re-running with them gives the same positions.`);
  }

  if (parked.length > 0) {
    notes.push(`${parked.length} item(s) could not be placed and are parked at the end, with their comparison counts.`);
  }
  if (excludedFeatures.length > 0) {
    notes.push(`${excludedFeatures.length} criterion/criteria could not be scored and were excluded from the distance.`);
  }
  const widenedByDisclosure = widenedCells(a, altIds, usableCriteria.map((c) => c.id), opts.measure);
  if (widenedByDisclosure > 0) {
    notes.push(
      `${widenedByDisclosure} cell(s) in this arrangement are withheld from you, so the order was computed ` +
      'over what you can see (ADR-0021).',
    );
  }

  return {
    axis,
    order: [...order, ...parked.map((p) => p.id)],
    parked,
    excludedFeatures,
    linkage: chosen?.linkage ?? 'complete',
    pathLength: chosen?.length ?? 0,
    pathLengths,
    minOverlap,
    missingPolicy: policy,
    distances: { ids: placedIndices.map((i) => items[i]!), distance, overlap },
    provenance,
    assumptions: SERIATION_ASSUMPTIONS,
    widenedByDisclosure,
    notes,
  };
}

/**
 * The Gower distance between two items, for checking the property that matters:
 * it depends on the pair alone, never on which third item happens to be present.
 */
export function gowerDistance(
  a: Analysis, x: string, y: string, opts: SeriationOptions,
): { distance: number; overlap: number } {
  const r = seriate(a, { ...opts, alternativeIds: opts.alternativeIds ?? [x, y], minOverlap: 0 });
  const i = r.distances.ids.indexOf(x);
  const j = r.distances.ids.indexOf(y);
  if (i < 0 || j < 0) return { distance: 1, overlap: 0 };
  return { distance: r.distances.distance[i]![j]!, overlap: r.distances.overlap[i]![j]! };
}
