/**
 * Groups, read through `@zodal/groups-core` (ADR-0008).
 *
 * ADR-0008 adopts `@zodal/groups-core` with the `labels` profile: membership is
 * many-to-many (groups are tags, not a partition), groups nest as a tree, and
 * closure -- "an alternative in a sub-group is in the group" -- is the
 * library's, not something re-derived here. This module is the adapter.
 *
 * **The stored shape does not change.** A document still carries
 * `groupIds: string[]` on each alternative and criterion and `parentId` on each
 * group; that is the cross-repo contract, and nothing here writes to it. The
 * group space is **built from the document at read time**, one per axis, and
 * thrown away. Every question about membership -- which groups is this row in,
 * which rows are in this group, which group ids does a filter for this group
 * need -- is answered by the library over that space.
 *
 * What is ours rather than the library's, as ADR-0008 requires us to say:
 *
 * - **Group-pair inapplicability** (`makeInapplicability`, below). A relation
 *   between the two axes' group spaces; the library knows one space at a time.
 *   It is closure-aware: a block declared on a group covers the members of its
 *   sub-groups too, because they are members of it.
 * - **Global axis order** is view state and does not live here (#53, #70).
 * - **Within-group order.** The library keeps a fractional-index rank on each
 *   membership edge. The document stores none yet, so the rank is **derived**
 *   from axis order: within every group, members rank in the order they appear
 *   in `alternatives` / `criteria`. Persisting a per-edge rank that differs from
 *   axis order is a stored-shape change and goes through the cross-repo protocol
 *   (`docs/cross-repo-coordination.md` §3) when a reorder-within-group feature
 *   needs it.
 *
 * The library's sharp edge, inherited verbatim: fractional-index ranks compare
 * by code unit. **Never `localeCompare` them** -- a locale-aware sort
 * interleaves keys minted to be adjacent, and the list is only *mostly* right.
 * Use `compareOrder`.
 */
import {
  addTo, applyDelta, compareOrder, createGroupSpace, edgesOf, groupsOfItem, initialOrders, makeEdge,
  membersOf, nodeId, scopeFilter, type GroupSpace, type NodeId,
} from '@zodal/groups-core';

import type { Analysis } from './analysis.js';
import type { Group } from './structure.js';

export type Axis = Group['axis'];

/**
 * Node ids are namespaced inside the space, because a group and an alternative
 * may share an id in a document and the library keys everything on one id
 * space. Nothing outside this module ever sees a namespaced id.
 */
const G = 'g:';
const E = 'e:';
const groupNode = (id: string): NodeId => nodeId(`${G}${id}`);
const entityNode = (id: string): NodeId => nodeId(`${E}${id}`);
const plain = (n: NodeId): string => n.slice(2);
const isGroupNode = (n: NodeId): boolean => n.startsWith(G);

/** A membership or nesting the document declares and the space could not hold. */
export interface RefusedMembership {
  /** `nesting` for a `parentId`, `membership` for an entry in `groupIds`. */
  kind: 'nesting' | 'membership';
  childId: string;
  groupId: string;
  /** The library's violation codes, e.g. `cycle`. */
  codes: string[];
}

/** One axis's groups as a `@zodal/groups-core` space, plus what did not fit. */
export interface AxisGroups {
  axis: Axis;
  space: GroupSpace;
  refused: RefusedMembership[];
}

/**
 * Build the group space for one axis from the document.
 *
 * Only groups declared for this axis take part; a reference to an unknown group
 * or to the other axis's group is skipped here (validation reports it). A
 * document with a nesting cycle still yields a usable space: the library
 * refuses the edge that would close the cycle, it is listed in `refused`, and
 * the build does not throw.
 */
export function axisGroups(a: Analysis, axis: Axis): AxisGroups {
  const groups = a.groups.filter((g) => g.axis === axis);
  const known = new Set(groups.map((g) => g.id));
  const entities = axis === 'alternatives' ? a.alternatives : a.criteria;

  let space = createGroupSpace({
    profile: 'labels',
    nodes: [
      ...groups.map((g) => ({ id: groupNode(g.id), label: g.label })),
      ...entities.map((e) => ({ id: entityNode(e.id), label: e.label })),
    ],
  });
  const refused: RefusedMembership[] = [];

  // All edges in one write when the document is sound; one at a time only when
  // the batch is refused, so the edge at fault can be named and the rest kept.
  // (Each write copies the space, so edge-at-a-time is quadratic.)
  type Pending = { kind: RefusedMembership['kind']; childId: string; groupId: string; order?: string };
  const pending: Pending[] = [];
  for (const g of groups) {
    if (g.parentId !== undefined && known.has(g.parentId)) {
      pending.push({ kind: 'nesting', childId: g.id, groupId: g.parentId });
    }
  }
  // Derived within-group rank: axis order. See the module docstring.
  const membersByGroup = new Map<string, string[]>();
  for (const e of entities) {
    for (const gid of new Set(e.groupIds)) {
      if (!known.has(gid)) continue;
      const list = membersByGroup.get(gid) ?? [];
      list.push(e.id);
      membersByGroup.set(gid, list);
    }
  }
  for (const [gid, members] of membersByGroup) {
    const ranks = initialOrders(members.length);
    members.forEach((eid, i) => pending.push({ kind: 'membership', childId: eid, groupId: gid, order: ranks[i]! }));
  }
  const nodeOf = (p: Pending) => (p.kind === 'nesting' ? groupNode(p.childId) : entityNode(p.childId));
  const edgeOf = (p: Pending) =>
    makeEdge(groupNode(p.groupId), nodeOf(p), p.order === undefined ? {} : { order: p.order });

  const batch = applyDelta(space, { added: pending.map(edgeOf) });
  if (batch.ok) {
    space = batch.value;
  } else {
    for (const p of pending) {
      const r = addTo(space, nodeOf(p), groupNode(p.groupId), p.order === undefined ? {} : { order: p.order });
      if (r.ok) space = r.value;
      else refused.push({ kind: p.kind, childId: p.childId, groupId: p.groupId, codes: r.violations.map((v) => v.code) });
    }
  }
  return { axis, space, refused };
}

/**
 * The groups an alternative or criterion is in.
 *
 * `closure` (the default) includes every ancestor of every direct group: a row
 * tagged `g-berlin` under `g-germany` under `g-europe` is in all three.
 */
export function groupsOf(
  ag: AxisGroups,
  entityId: string,
  { expand = 'closure' }: { expand?: 'direct' | 'closure' } = {},
): string[] {
  return [...groupsOfItem(ag.space, entityNode(entityId), expand)].filter(isGroupNode).map(plain);
}

/**
 * The alternatives or criteria in a group.
 *
 * `closure` (the default) includes the members of every sub-group, each listed
 * once, in axis order. `direct` lists only the group's own members, in their
 * within-group rank (the fractional index on each membership edge, compared by
 * code unit). Ranks from different groups are not comparable, which is why the
 * closure falls back to axis order rather than merging them.
 */
export function membersOfGroup(
  ag: AxisGroups,
  groupId: string,
  { expand = 'closure' }: { expand?: 'direct' | 'closure' } = {},
): string[] {
  const g = groupNode(groupId);
  const members = membersOf(ag.space, g, { expand }).filter((n) => !isGroupNode(n));
  if (expand === 'direct') {
    const rankOf = new Map(edgesOf(ag.space, g).map((e) => [e.child, e.order]));
    return members.sort((x, y) => compareOrder(rankOf.get(x), rankOf.get(y))).map(plain);
  }
  const position = new Map([...ag.space.nodes.keys()].map((n, i) => [n, i]));
  return members.sort((x, y) => position.get(x)! - position.get(y)!).map(plain);
}

/**
 * The filter that selects a group's rows from a store, by their stored `groupIds`.
 *
 * The library's `scopeFilter`, with the namespacing stripped: `value` is the
 * group and (under `closure`) every sub-group, as the plain ids a document
 * stores, so `arrayContainsAny` against `groupIds` finds every member.
 */
export function groupScopeFilter(
  ag: AxisGroups,
  groupId: string,
  { field = 'groupIds', expand = 'closure' }: { field?: string; expand?: 'direct' | 'closure' } = {},
): { field: string; operator: 'arrayContainsAny'; value: string[] } {
  const f = scopeFilter(ag.space, groupNode(groupId), { field, expand });
  return { field: f.field, operator: f.operator, value: f.value.map(plain) };
}

/**
 * Group-pair inapplicability, prepared once per analysis. **Ours, not the
 * library's** (ADR-0008): a relation between the two axes' spaces.
 *
 * Returns a predicate: is the cell (alternative, criterion) inside a declared
 * inapplicable block? Membership is by closure on both axes, so a block on a
 * group covers its sub-groups' members too.
 *
 * Prepared rather than recomputed per cell because whole-matrix walks --
 * completeness, dominance -- ask this for every cell.
 */
export function makeInapplicability(a: Analysis): (alternativeId: string, criterionId: string) => boolean {
  if (a.inapplicable.length === 0) return () => false;
  const alts = axisGroups(a, 'alternatives');
  const crits = axisGroups(a, 'criteria');
  const altCache = new Map<string, Set<string>>();
  const critCache = new Map<string, Set<string>>();
  const memo = (cache: Map<string, Set<string>>, ag: AxisGroups, id: string) => {
    let s = cache.get(id);
    if (!s) cache.set(id, (s = new Set(groupsOf(ag, id))));
    return s;
  };
  return (alternativeId, criterionId) => {
    const ag = memo(altCache, alts, alternativeId);
    if (ag.size === 0) return false;
    const cg = memo(critCache, crits, criterionId);
    return a.inapplicable.some((b) => ag.has(b.alternativeGroupId) && cg.has(b.criterionGroupId));
  };
}
