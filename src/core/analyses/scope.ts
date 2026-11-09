/**
 * Which alternatives an analysis compares: one resolver shared by dominance, Pugh and seriation (#239);
 * and which groups a reader can pick, one answer for the scatter's scope and the matrix's group controls (#342).
 */
import type { Analysis } from '../schema/analysis.js';
import { axisGroups, membersOfGroup, type Axis } from '../schema/groups.js';
import type { Group } from '../schema/structure.js';

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

/**
 * A group a reader can pick, with its live members, sub-groups' included, in
 * document order: the scope `groupId` resolves to, and what picking it selects
 * or hides. The matrix's group controls and layout offer these (#342), and the
 * scatter's scope picker builds on them (`scopeGroups`).
 */
export type PickableGroup = Group & { members: string[] };

/**
 * The groups a reader can pick on an axis: every live one, in document order,
 * with a live member. A group with none is not offered: scoping to it would
 * draw nothing, banding by it would draw no band, and selecting or hiding it
 * would change nothing. `topLevel` keeps only the groups with no parent: the
 * matrix renders one nesting level (ADR-0008).
 */
export function pickableGroups(a: Analysis, axis: Axis = 'alternatives', { topLevel = false } = {}): PickableGroup[] {
  const ag = axisGroups(a, axis);
  return a.groups.flatMap((g) => {
    if (g.axis !== axis || g.tombstoned || (topLevel && g.parentId !== undefined)) return [];
    const members = membersOfGroup(ag, g.id);
    return members.length ? [{ ...g, members }] : [];
  });
}

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
 */
export function scopeGroups(a: Analysis, { shownAlternatives }: { shownAlternatives?: readonly string[] | undefined } = {}): ScopeGroup[] {
  const labelOf = new Map(a.groups.filter((g) => g.axis === 'alternatives' && !g.tombstoned).map((g) => [g.id, g.label]));
  const showing = shownAlternatives === undefined ? undefined : new Set(shownAlternatives);
  return pickableGroups(a).flatMap(({ id, label, parentId, members }) => {
    const shown = showing === undefined ? members.length : members.filter((m) => showing.has(m)).length;
    return shown > 0 ? [{ id, label, parentLabel: parentId === undefined ? undefined : labelOf.get(parentId), members, shown }] : [];
  });
}
