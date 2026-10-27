/**
 * Adding an alternative or criterion to a group (#279): the document write
 * behind the move menu's "Group with…" (ADR-0027). Groups are data, so this
 * writes the entity's `groupIds`; the view state's `grouping` only chooses
 * which groups to band by.
 *
 * Pure. It refuses what would be ignored or wrong: a tombstoned or unknown
 * entity, a tombstoned or unknown group, a group of the other axis
 * (`tombstonedGroupProblems` says why a tombstoned group cannot gain members).
 * Joining a group the entity is already in changes nothing.
 */
import type { Analysis } from './schema/analysis.js';
import type { Axis } from './schema/groups.js';

export function joinGroup(a: Analysis, axis: Axis, id: string, groupId: string): Analysis {
  const entities = axis === 'alternatives' ? a.alternatives : a.criteria;
  const entity = entities.find((e) => e.id === id && !e.tombstoned);
  if (!entity) throw new Error(`"${id}" is not a live ${axis === 'alternatives' ? 'alternative' : 'criterion'} of this analysis.`);
  const group = a.groups.find((g) => g.id === groupId);
  if (!group || group.axis !== axis) throw new Error(`"${groupId}" is not a group of ${axis} in this analysis.`);
  if (group.tombstoned) throw new Error(`"${group.label}" is tombstoned: a tombstoned group groups nothing.`);
  if (entity.groupIds.includes(groupId)) return a;
  const joined = entities.map((e) => (e === entity ? { ...e, groupIds: [...e.groupIds, groupId] } : e));
  return axis === 'alternatives' ? { ...a, alternatives: joined as Analysis['alternatives'] } : { ...a, criteria: joined as Analysis['criteria'] };
}
