/**
 * Which alternatives an analysis compares: one resolver shared by dominance, Pugh and seriation (#239).
 */
import type { Analysis } from '../schema/analysis.js';
import { axisGroups, membersOfGroup } from '../schema/groups.js';

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
  const live = new Set(a.alternatives.filter((x) => !x.tombstoned).map((x) => x.id));
  return membersOfGroup(ag, opts.groupId).filter((id) => live.has(id));
}
