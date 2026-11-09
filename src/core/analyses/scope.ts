/**
 * Which alternatives an analysis compares: one resolver shared by dominance, Pugh and seriation (#239);
 * and which groups a reader can pick, one answer for the scatter's scope and the matrix's group controls (#342).
 */
import type { Analysis } from '../schema/analysis.js';
import { axisGroups, membersOfGroup, pickableGroups } from '../schema/groups.js';

/** The options every analysis that can be scoped to a set of alternatives accepts. */
export interface AlternativeScopeOptions {
  alternativeIds?: readonly string[];
  /** Compare only the live members of this alternatives group. Exclusive with `alternativeIds`. */
  groupId?: string;
}

/**
 * The alternatives a call compares: `alternativeIds` as given, the live members
 * of `groupId`, or every live alternative. Throws on an unknown group, or when
 * both `alternativeIds` and `groupId` are given.
 */
export function alternativeScope(a: Analysis, opts: AlternativeScopeOptions): string[] {
  if (opts.groupId === undefined) {
    return (opts.alternativeIds ?? a.alternatives.filter((x) => !x.tombstoned).map((x) => x.id)).slice();
  }
  if (opts.alternativeIds) throw new Error('pass alternativeIds or groupId, not both');
  const ag = axisGroups(a, 'alternatives');
  if (!a.groups.some((g) => g.id === opts.groupId && g.axis === 'alternatives' && !g.tombstoned)) {
    throw new Error(`"${opts.groupId}" is not a live alternatives group`);
  }
  // Live members only: a tombstoned alternative is in no group (axisGroups, #284).
  return membersOfGroup(ag, opts.groupId);
}

// The groups a reader can pick live with the other group helpers; the scope picker builds on them.
export { pickableGroups, type PickableGroup } from '../schema/groups.js';

/** An alternatives group a comparison can be scoped to, as a picker offers it. */
export interface ScopeGroup {
  id: string;
  label: string;
  /** The parent group's label, for a sub-group: two groups may share a label under different parents. */
  parentLabel: string | undefined;
  /** Its live members, sub-groups' included, in document order: the scope `groupId` resolves to. */
  members: string[];
  /** How many of them the reader shows; every member, without an arrangement. */
  shown: number;
}

/**
 * The alternatives groups a comparison can be scoped to: the pickable ones
 * (`pickableGroups`) that have a member the reader shows (`shownAlternatives`,
 * the matrix's arrangement; absent, every live member counts as shown). A group
 * whose members are all hidden is not offered: scoping to it would draw nothing.
 * The matrix's group controls, which read `pickableGroups` directly, still offer
 * it: there a hidden group can be selected, and its members shown again.
 */
export function scopeGroups(a: Analysis, { shownAlternatives }: { shownAlternatives?: readonly string[] | undefined } = {}): ScopeGroup[] {
  const groups = pickableGroups(a);
  // A live parent of a pickable sub-group is pickable itself: its members include the sub-group's.
  const labelOf = new Map(groups.map((g) => [g.id, g.label]));
  const showing = shownAlternatives === undefined ? undefined : new Set(shownAlternatives);
  return groups.flatMap(({ id, label, parentId, members }) => {
    const shown = showing === undefined ? members.length : members.filter((m) => showing.has(m)).length;
    return shown > 0 ? [{ id, label, parentLabel: parentId === undefined ? undefined : labelOf.get(parentId), members, shown }] : [];
  });
}
